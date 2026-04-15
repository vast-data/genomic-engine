import logging
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
import vastdb
import pyarrow as pa
from ibis import _

# Monkey-patch vastdb SDK to handle vector (fixed_size_list) columns in select()
try:
    from vastdb import _internal
    _original_build_query_data_request = _internal.build_query_data_request

    def _patched_build_query_data_request(schema, predicate, field_names):
        supported_fields = []
        unsupported_field_names = set()
        for field in schema:
            if "fixed_size_list" in str(field.type):
                unsupported_field_names.add(field.name)
            else:
                supported_fields.append(field)
        filtered_schema = pa.schema(supported_fields)
        filtered_field_names = (
            [f for f in field_names if f not in unsupported_field_names]
            if field_names else field_names
        )
        return _original_build_query_data_request(filtered_schema, predicate, filtered_field_names)

    _internal.build_query_data_request = _patched_build_query_data_request
    logging.info("VastDB SDK patched for vector column compatibility")
except Exception as e:
    logging.warning(f"Could not patch vastdb SDK for vector columns: {e}")

class VastDBVariantsClient:
    def __init__(self, settings):
        self.bucket_name = settings.vdbbucket
        self.schema_name = settings.vdbschema
        self.table_name = "variants"

        endpoint = settings.vdbendpoint
        if not endpoint.startswith(("http://", "https://")):
            endpoint = f"http://{endpoint}"

        self.session = vastdb.connect(
            endpoint=endpoint,
            access=settings.vast_access_key,
            secret=settings.vast_secret_key,
            ssl_verify=False,
        )

    def update_sample_failure(self, sample_id: str, patient_id: str) -> bool:
        now = datetime.now(timezone.utc)
        try:
            with self.session.transaction() as tx:
                bucket = tx.bucket(self.bucket_name)
                schema = bucket.schema(self.schema_name, fail_if_missing=False)
                if not schema:
                    return False
                table = schema.table("samples", fail_if_missing=False)
                if not table:
                    return False

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

    def get_cached_variants(self, variants: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Attempts to fetch already known variants from the database to reuse their clinical significance
        and descriptions (which might contain expensive LLM summaries).
        Returns a dictionary mapping a unique variant key to the cached data.
        """
        cached = {}
        try:
            with self.session.transaction() as tx:
                bucket = tx.bucket(self.bucket_name)
                schema = bucket.schema(self.schema_name, fail_if_missing=False)
                if not schema:
                    return cached
                table = schema.table(self.table_name, fail_if_missing=False)
                if not table:
                    return cached

                # For efficiency in a small cohort, we can do individual queries.
                # If the list is huge, we might want to fetch all and filter locally,
                # but for typical VCFs, let's query the specific chromosomes we need.
                unique_chroms = list(set(v["chromosome"] for v in variants))
                
                # Fetch all variants for the chromosomes present in the VCF
                # (This is a balance between too many queries and fetching the whole DB)
                from ibis import _
                for chrom in unique_chroms:
                    try:
                        reader = table.select(
                            columns=["chromosome", "position", "ref_allele", "alt_allele", "gene", "clinical_significance", "variant_description", "vectors", "cache_hits_count"],
                            predicate=_.chromosome == chrom
                        )
                        results = reader.read_all().to_pylist()
                        for r in results:
                            key = f"{r['chromosome']}:{r['position']}:{r['ref_allele']}>{r['alt_allele']}"
                            # Keep the one with the highest cache hit count if multiple found, or just the first
                            if key not in cached or r.get("cache_hits_count", 0) > cached[key].get("cache_hits_count", 0):
                                cached[key] = {
                                    "gene": r.get("gene", "UNKNOWN"),
                                    "clinical_significance": r["clinical_significance"],
                                    "variant_description": r["variant_description"],
                                    "vectors": r.get("vectors"),
                                    "cache_hits_count": r.get("cache_hits_count", 0)
                                }
                    except Exception as e:
                        logging.warning(f"Failed to fetch cached variants for {chrom}: {e}")

        except Exception as e:
            logging.error(f"VastDB cache lookup failed: {e}")
        
        return cached
