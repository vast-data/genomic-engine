import logging
import hashlib
import time
from datetime import datetime, timezone
from typing import Callable, Dict, List, Any

import vastdb
import vastdb.errors
import pyarrow as pa
import requests


_RETRYABLE_ERRORS = (
    vastdb.errors.ConnectionError,
    requests.exceptions.ConnectionError,
    ConnectionResetError,
    TimeoutError,
)


def _retry(operation: str, fn: Callable[[], Any], attempts: int = 3, base_delay: float = 1.0) -> Any:
    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except _RETRYABLE_ERRORS as e:
            last_err = e
            logging.warning(
                "[RETRY] %s attempt=%d/%d err=%s",
                operation, attempt, attempts, type(e).__name__,
            )
            if attempt < attempts:
                time.sleep(base_delay * attempt)
    raise last_err if last_err else RuntimeError(f"{operation} exhausted retries")


class VastDBVariantsClient:
    def __init__(self, settings):
        self.bucket_name = settings.vdbbucket
        self.schema_name = settings.vdbschema
        self.table_name = "variants"
        self.embedding_dims = settings.embeddingdimensions

        self.schema_columns = pa.schema([
            ("variant_id", pa.utf8()),
            ("sample_id", pa.utf8()),
            ("patient_id", pa.utf8()),
            ("chromosome", pa.utf8()),
            ("position", pa.uint64()),
            ("ref_allele", pa.utf8()),
            ("alt_allele", pa.utf8()),
            ("gene", pa.utf8()),
            ("variant_type", pa.utf8()),
            ("quality", pa.float64()),
            ("filter_status", pa.utf8()),
            ("clinical_significance", pa.utf8()),
            ("allele_frequency", pa.float64()),
            ("read_depth", pa.uint32()),
            ("variant_description", pa.utf8()),
            ("vectors", pa.list_(pa.field("item", pa.float32(), nullable=False), self.embedding_dims)),
            ("embedding_model", pa.utf8()),
            ("pipeline_run_id", pa.utf8()),
            ("cache_hits_count", pa.uint32()),
            ("timestamp", pa.timestamp("ns")),
        ])

        endpoint = settings.vdbendpoint
        if not endpoint.startswith(("http://", "https://")):
            endpoint = f"http://{endpoint}"

        self.session = vastdb.connect(
            endpoint=endpoint,
            access=settings.vast_access_key,
            secret=settings.vast_secret_key,
            ssl_verify=False,
        )

    def ensure_schema_and_table(self) -> None:
        def _do() -> None:
            with self.session.transaction() as tx:
                bucket = tx.bucket(self.bucket_name)
                schema = bucket.schema(self.schema_name, fail_if_missing=False)
                if schema is None:
                    schema = bucket.create_schema(self.schema_name, fail_if_exists=False)
                table = schema.table(self.table_name, fail_if_missing=False)
                if table is None:
                    schema.create_table(self.table_name, columns=self.schema_columns)

        _retry("ensure_schema_and_table", _do)

    def store_variants(self, variants: List[Dict[str, Any]], pipeline_run_id: str = "") -> int:
        self.ensure_schema_and_table()

        stored = 0
        records = []
        now = datetime.utcnow()
        for variant in variants:
            try:
                variant_id = hashlib.md5(
                    f"{variant['sample_id']}:{variant['chromosome']}:{variant['position']}:{variant['alt_allele']}".encode()
                ).hexdigest()

                records.append({
                    "variant_id": variant_id,
                    "sample_id": variant.get("sample_id", ""),
                    "patient_id": variant.get("patient_id", ""),
                    "chromosome": variant.get("chromosome", ""),
                    "position": variant.get("position", 0),
                    "ref_allele": variant.get("ref_allele", ""),
                    "alt_allele": variant.get("alt_allele", ""),
                    "gene": variant.get("gene", ""),
                    "variant_type": variant.get("variant_type", ""),
                    "quality": variant.get("quality", 0.0),
                    "filter_status": variant.get("filter_status", ""),
                    "clinical_significance": variant.get("clinical_significance", "unknown"),
                    "allele_frequency": variant.get("allele_frequency", 0.0),
                    "read_depth": variant.get("read_depth", 0),
                    "variant_description": variant.get("variant_description", ""),
                    "vectors": variant.get("embedding", []),
                    "embedding_model": variant.get("embedding_model", ""),
                    "pipeline_run_id": pipeline_run_id,
                    "cache_hits_count": variant.get("cache_hits_count", 0),
                    "timestamp": now,
                })
            except Exception as e:
                logging.error(f"Failed to prepare variant record: {e}")

        if not records:
            return 0

        batch_size = 1000
        for i in range(0, len(records), batch_size):
            batch_records = records[i:i + batch_size]
            arrow_table = pa.Table.from_pylist(batch_records, schema=self.schema_columns)

            def _insert() -> None:
                with self.session.transaction() as tx:
                    bucket = tx.bucket(self.bucket_name)
                    schema = bucket.schema(self.schema_name)
                    table = schema.table(self.table_name)
                    table.insert(arrow_table)

            _retry(f"insert_batch[{i}:{i+len(batch_records)}]", _insert)
            stored += len(batch_records)

        return stored

    def update_sample_failure(self, sample_id: str, patient_id: str) -> bool:
        from ibis import _

        now = datetime.now(timezone.utc)
        try:
            with self.session.transaction() as tx:
                bucket = tx.bucket(self.bucket_name)
                schema = bucket.schema(self.schema_name)
                table = schema.table("samples")

                reader = table.select(
                    predicate=_.sample_id == sample_id,
                    columns=["sample_id"],
                    internal_row_id=True,
                )
                existing = reader.read_all()
                if len(existing) == 0:
                    logging.warning(f"Sample {sample_id} not found — cannot mark as failed")
                    return False

                table.update(pa.table({
                    "$row_id": existing.column("$row_id"),
                    "status": ["failed"],
                    "completed_at": pa.array([now], type=pa.timestamp("ns")),
                }))
            return True
        except Exception as e:
            logging.error(f"Failed to mark sample {sample_id} as failed: {e}")
            return False

    def update_sample_completion(
        self,
        sample_id: str,
        patient_id: str,
        variant_count: int,
    ) -> bool:
        from ibis import _

        vcf_path = f"{patient_id}/{sample_id}/{sample_id}.vcf"
        now = datetime.now(timezone.utc)

        try:
            with self.session.transaction() as tx:
                bucket = tx.bucket(self.bucket_name)
                schema = bucket.schema(self.schema_name)
                table = schema.table("samples")

                reader = table.select(
                    predicate=_.sample_id == sample_id,
                    columns=["sample_id"],
                    internal_row_id=True,
                )
                existing = reader.read_all()
                if len(existing) == 0:
                    logging.warning(f"Sample {sample_id} not found in samples table")
                    return False

                row_ids = existing.column("$row_id")
                table.update(pa.table({
                    "$row_id": row_ids,
                    "vcf_path": [vcf_path],
                    "status": ["completed"],
                    "variant_count": pa.array([variant_count], type=pa.uint32()),
                    "completed_at": pa.array([now], type=pa.timestamp("ns")),
                }))

            return True
        except Exception as e:
            logging.error(f"Failed to update sample completion: {e}")
            return False
