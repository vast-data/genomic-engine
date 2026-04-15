import boto3
from vast_runtime.vast_event import VastEvent  # type: ignore

from common.models import Settings
from common.s3_event import parse_s3_event
from common.handler_utils import should_process_event
from common.vcf_utils import parse_vcf_content
from common.vastdb_client import VastDBVariantsClient

def init(ctx):
    with ctx.tracer.start_as_current_span("VCF Parser Initialization"):
        settings = Settings.from_ctx_secrets(ctx.secrets)
        ctx.settings = settings
        ctx.s3_client = boto3.client(
            "s3",
            endpoint_url=settings.s3endpoint,
            aws_access_key_id=settings.vast_access_key,
            aws_secret_access_key=settings.vast_secret_key,
            verify=False,
        )
        try:
            ctx.vastdb_client = VastDBVariantsClient(settings)
        except Exception as e:
            ctx.logger.error(f"Failed to initialize VastDB client: {e}")
            ctx.vastdb_client = None


def handler(ctx, event: VastEvent):
    with ctx.tracer.start_as_current_span("VCF Parser Handler") as span:
        sample_id = None
        patient_id = None
        try:
            data = event.get_data()

            event_info = parse_s3_event(data)
            bucket = event_info["bucket"]
            key = event_info["key"]
            event_name = event_info["event_name"]
            ctx.logger.info(f"[INPUT] s3://{bucket}/{key} | event={event_name}")

            should_process, skip_reason = should_process_event(key, event_name)
            if not should_process:
                ctx.logger.info(f"[SKIP] {key} | reason={skip_reason}")
                return {"status": "skipped", "reason": skip_reason}

            parts = key.split("/")
            if len(parts) < 3:
                ctx.logger.error(f"[ERROR] Key does not match {{patient_id}}/{{sample_id}}/{{filename}} pattern: {key}")
                return {"status": "error", "error": f"Unexpected key format: {key}"}

            patient_id = parts[0]
            sample_id = parts[1]
            filename = parts[-1]

            response = ctx.s3_client.get_object(Bucket=bucket, Key=key)
            vcf_content = response["Body"].read().decode("utf-8")
            ctx.logger.info(f"[DOWNLOAD] {filename} | {len(vcf_content)} bytes")

            variants, stats = parse_vcf_content(
                vcf_content, 
                sample_id, 
                patient_id, 
                settings=ctx.settings, 
                vastdb_client=ctx.vastdb_client
            )
            ctx.logger.info(f"[PARSED] {filename} | {len(variants)} variants | Cache Hits: {stats['cache_hits']} | MyVariant API Calls: {stats['api_calls']}")

            return {
                "status": "success",
                "vcf_source": f"s3://{bucket}/{key}",
                "sample_id": sample_id,
                "patient_id": patient_id,
                "variant_count": len(variants),
                "variants": variants,
                "stats": stats,
            }

        except Exception as e:
            span.set_attribute("error", True)
            span.record_exception(e)
            ctx.logger.error(f"VCF parsing failed: {e}")
            if sample_id and ctx.vastdb_client:
                marked = ctx.vastdb_client.update_sample_failure(sample_id, patient_id)
                ctx.logger.info(f"[FAILED] {sample_id} | sample marked as failed={marked}")
            return {"status": "error", "error": str(e)}
