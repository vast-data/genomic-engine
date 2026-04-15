import logging
from typing import Dict

import vastdb
import pyarrow as pa
import requests


class VastDBSamplesClient:
    SCHEMA_COLUMNS = pa.schema([
        ("sample_id", pa.utf8()),
        ("patient_id", pa.utf8()),
        ("fastq_path", pa.utf8()),
        ("vcf_path", pa.utf8()),
        ("argo_workflow_id", pa.utf8()),
        ("status", pa.utf8()),
        ("variant_count", pa.uint32()),
        ("cache_hits", pa.uint32()),
        ("processing_mode", pa.utf8()),
        ("registered_at", pa.timestamp("ns")),
        ("completed_at", pa.timestamp("ns")),
    ])

    def __init__(self, settings):
        endpoint = settings.vdbendpoint
        if not endpoint.startswith(("http://", "https://")):
            endpoint = f"http://{endpoint}"

        self.session = vastdb.connect(
            endpoint=endpoint,
            access=settings.vast_access_key,
            secret=settings.vast_secret_key,
            ssl_verify=False,
        )
        self.bucket_name = settings.vdbbucket
        self.schema_name = settings.vdbschema
        self.table_name = "samples"

    def update_sample_status(self, sample_id: str, status: str, workflow_id: str = "") -> bool:
        from ibis import _

        try:
            with self.session.transaction() as tx:
                bucket = tx.bucket(self.bucket_name)
                schema = bucket.schema(self.schema_name)
                table = schema.table(self.table_name)

                reader = table.select(
                    predicate=_.sample_id == sample_id,
                    columns=["sample_id"],
                    internal_row_id=True,
                )
                existing = reader.read_all()

                if len(existing) == 0:
                    logging.warning(f"Sample {sample_id} not found for status update")
                    return False

                row_ids = existing.column("$row_id")
                update_fields = {"$row_id": row_ids, "status": [status]}
                if workflow_id:
                    update_fields["argo_workflow_id"] = [workflow_id]

                table.update(pa.table(update_fields))

            return True
        except Exception as e:
            logging.error(f"Failed to update sample status: {e}")
            return False


class BackendClient:
    def __init__(self, settings):
        self.endpoint = getattr(settings, "backend_url", "http://backend.genomics.svc.cluster.local:8000")
        self.jwt_secret = getattr(settings, "jwt_secret", "")

    def _generate_token(self) -> str:
        import jwt
        from datetime import datetime, timedelta, timezone
        
        payload = {
            "sub": "fastq-registrar",
            "role": "admin",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            "iat": datetime.now(timezone.utc),
        }
        return jwt.encode(payload, self.jwt_secret, algorithm="HS256")

    def submit_job(
        self,
        sample_id: str,
        patient_id: str,
        fastq_path: str,
        mock: bool = False,
        max_retries: int = 3,
    ) -> str:
        url = f"{self.endpoint}/api/v1/pipelines/submit"
        body = {
            "sample_id": sample_id,
            "patient_id": patient_id,
            "fastq_path": fastq_path,
            "mock": mock
        }

        headers = {
            "Authorization": f"Bearer {self._generate_token()}"
        }

        delay = 1.0
        for attempt in range(max_retries):
            try:
                response = requests.post(url, json=body, headers=headers, timeout=30)
                response.raise_for_status()
                return response.json().get("job_name", "")
            except (requests.RequestException, ConnectionError) as exc:
                if attempt == max_retries - 1:
                    raise
                logging.warning(f"Backend submit attempt {attempt + 1} failed: {exc}, retrying in {delay}s")
                import time
                time.sleep(delay)
                delay *= 2

        return ""
