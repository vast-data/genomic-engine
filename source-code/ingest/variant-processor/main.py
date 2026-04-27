from vast_runtime.vast_event import VastEvent  # type: ignore

from common.models import Settings
from common.handler_utils import is_skip_event, parse_variant_event, validate_variants
from common.embedding_client import EmbeddingClient
from common.vastdb_client import VastDBVariantsClient


def init(ctx):
    with ctx.tracer.start_as_current_span("Variant Processor Initialization"):
        settings = Settings.from_ctx_secrets(ctx.secrets)
        ctx.embedding_client = EmbeddingClient(settings)
        ctx.vastdb_client = VastDBVariantsClient(settings)
        ctx.settings = settings


def handler(ctx, event: VastEvent):
    with ctx.tracer.start_as_current_span("Variant Processor Handler") as span:
        sample_id = None
        patient_id = None
        try:
            data = event.get_data()

            if is_skip_event(data):
                reason = data.get("reason", "upstream skipped")
                ctx.logger.info(f"[SKIP] upstream event has no variants | reason={reason}")
                return {"status": "skipped", "reason": reason}

            variant_event = parse_variant_event(data)

            variants = variant_event["variants"]
            sample_id = variant_event["sample_id"]
            patient_id = variant_event["patient_id"]
            source = variant_event["source"]

            ctx.logger.info(f"[INPUT] {sample_id} | {len(variants)} variants to process")

            if not validate_variants(variants):
                ctx.logger.info(f"[SKIP] {sample_id} | no valid variants")
                return {"status": "skipped", "reason": "No valid variants"}

            descriptions = []
            for v in variants:
                if "vectors" in v and v["vectors"]:
                    descriptions.append("")
                else:
                    descriptions.append(v["variant_description"])

            batch_size = 50
            texts_to_embed = [d for d in descriptions if d]
            embedded_vectors = []

            if texts_to_embed:
                for i in range(0, len(texts_to_embed), batch_size):
                    batch = texts_to_embed[i : i + batch_size]
                    ctx.logger.info(f"[EMBED] Batch {i // batch_size + 1} | {len(batch)} texts")
                    embeddings = ctx.embedding_client.get_embeddings(batch)
                    embedded_vectors.extend(embeddings)

            embed_idx = 0
            for i, variant in enumerate(variants):
                if descriptions[i]:
                    variant["embedding"] = embedded_vectors[embed_idx]
                    embed_idx += 1
                else:
                    variant["embedding"] = variant["vectors"]
                variant["embedding_model"] = ctx.settings.embeddingmodel
                variant["embedding_dimensions"] = len(variant["embedding"])

            ctx.logger.info(f"[EMBEDDED] {sample_id} | {len(embedded_vectors)} new embeddings generated, {len(variants) - len(embedded_vectors)} reused from cache")

            stored = ctx.vastdb_client.store_variants(variants, pipeline_run_id=source)
            ctx.logger.info(f"[STORED] {sample_id} | {stored}/{len(variants)} variants written to VastDB")

            if stored != len(variants):
                raise RuntimeError(
                    f"Partial write for {sample_id}: stored {stored}/{len(variants)} variants"
                )

            updated = ctx.vastdb_client.update_sample_completion(
                sample_id=sample_id,
                patient_id=patient_id,
                variant_count=stored,
            )
            if updated:
                ctx.logger.info(f"[COMPLETE] {sample_id} | sample status set to completed, vcf_path set")
            else:
                ctx.logger.warning(f"[WARN] {sample_id} | failed to update sample completion status")

            return {
                "status": "success",
                "source": source,
                "sample_id": sample_id,
                "patient_id": patient_id,
                "variants_embedded": len(embedded_vectors),
                "variants_stored": stored,
                "variants_total": len(variants),
            }

        except Exception as e:
            span.set_attribute("error", True)
            span.record_exception(e)
            ctx.logger.error(f"Variant processing failed: {e}")
            if sample_id:
                marked = ctx.vastdb_client.update_sample_failure(sample_id, patient_id)
                ctx.logger.info(f"[FAILED] {sample_id} | sample marked as failed={marked}")
            return {"status": "error", "error": str(e)}
