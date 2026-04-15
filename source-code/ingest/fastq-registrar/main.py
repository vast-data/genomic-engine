from vast_runtime.vast_event import VastEvent  # type: ignore

from common.models import Settings
from common.s3_event import parse_s3_event
from common.handler_utils import should_process_event
from common.clients import VastDBSamplesClient, BackendClient


def init(ctx):
    with ctx.tracer.start_as_current_span("FASTQ Registrar Initialization"):
        settings = Settings.from_ctx_secrets(ctx.secrets)
        ctx.vastdb_client = VastDBSamplesClient(settings)
        ctx.backend_client = BackendClient(settings)
        ctx.settings = settings


def handler(ctx, event: VastEvent):
    with ctx.tracer.start_as_current_span("FASTQ Registrar Handler") as span:
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
            fastq_path = f"s3://{bucket}/{key}"

            ctx.logger.info(f"[PARSED] patient={patient_id} sample={sample_id}")

            job_name = ctx.backend_client.submit_job(
                sample_id=sample_id,
                patient_id=patient_id,
                fastq_path=fastq_path,
                mock=(ctx.settings.processing_mode == "mock"),
            )

            ctx.logger.info(f"[BACKEND] Submitted K8s Job {job_name} for sample {sample_id}")

            ctx.vastdb_client.update_sample_status(
                sample_id=sample_id,
                status="processing",
                workflow_id=job_name,
            )

            return {
                "status": "success",
                "sample_id": sample_id,
                "patient_id": patient_id,
                "fastq_path": fastq_path,
                "job_name": job_name,
            }

        except Exception as e:
            span.set_attribute("error", True)
            span.record_exception(e)
            ctx.logger.error(f"FASTQ registration failed: {e}")
            return {"status": "error", "error": str(e)}
