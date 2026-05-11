import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

import pyarrow as pa

import vastdb
from ibis import _

from src.config import settings

try:
    import adbc_driver_manager
    import adbc_driver_manager.dbapi
    ADBC_AVAILABLE = True
except ImportError:
    ADBC_AVAILABLE = False

logger = logging.getLogger(__name__)

PATIENTS_SCHEMA = pa.schema([
    ("patient_id", pa.utf8()),
    ("age", pa.int32()),
    ("sex", pa.utf8()),
    ("ethnicity", pa.utf8()),
    ("weight_kg", pa.float64()),
    ("height_cm", pa.float64()),
    ("notes", pa.utf8()),
    ("created_at", pa.timestamp("ns")),
    ("updated_at", pa.timestamp("ns")),
])

SAMPLES_SCHEMA = pa.schema([
    ("sample_id", pa.utf8()),
    ("patient_id", pa.utf8()),
    ("fastq_path", pa.utf8()),
    ("vcf_path", pa.utf8()),
    ("argo_workflow_id", pa.utf8()),
    ("status", pa.utf8()),
    ("variant_count", pa.uint32()),
    ("processing_mode", pa.utf8()),
    ("registered_at", pa.timestamp("ns")),
    ("completed_at", pa.timestamp("ns")),
])

JOBS_SCHEMA = pa.schema([
    ("job_id", pa.utf8()),
    ("sample_id", pa.utf8()),
    ("patient_id", pa.utf8()),
    ("fastq_path", pa.utf8()),
    ("vcf_path", pa.utf8()),
    ("logs_path", pa.utf8()),
    ("status", pa.utf8()),
    ("processing_mode", pa.utf8()),
    ("started_at", pa.timestamp("ns")),
    ("completed_at", pa.timestamp("ns")),
])

MOLECULES_SCHEMA = pa.schema([
    ("molecule_id", pa.utf8()),
    ("seed_smiles", pa.utf8()),
    ("seed_drug_name", pa.utf8()),
    ("generated_smiles", pa.utf8()),
    ("tanimoto_score", pa.float64()),
    ("gene", pa.utf8()),
    ("variant_id", pa.utf8()),
    ("docking_pdb_id", pa.utf8()),
    ("docking_score", pa.float64()),
    ("docking_poses_sdf", pa.utf8()),
    ("docking_poses_json", pa.utf8()),
    ("protein_pdb_content", pa.utf8()),
    ("status", pa.utf8()),
    ("annotations", pa.utf8()),
    ("created_at", pa.timestamp("ns")),
    ("updated_at", pa.timestamp("ns")),
])


def _find_adbc_driver() -> Optional[str]:
    for path in (
        "/opt/adbc-driver/libadbc_driver_vastdb.so",
        os.path.join(os.path.dirname(os.path.abspath(vastdb.__file__)), "libadbc_driver_vastdb.so"),
    ):
        if os.path.isfile(path):
            return path
    return None


ADBC_DRIVER_PATH = _find_adbc_driver()

if ADBC_AVAILABLE and ADBC_DRIVER_PATH:
    logger.info(f"ADBC driver found at {ADBC_DRIVER_PATH} -- server-side vector search enabled")
else:
    logger.warning("ADBC driver not found -- falling back to client-side vector search")


# Monkey-patch vastdb SDK to handle vector (fixed_size_list) columns in select()
# Without this, SDK selects fail on tables that contain vector columns.
# Pattern from VSS blueprint: filter out unsupported field types before building query.
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
    logger.info("VastDB SDK patched for vector column compatibility")
except Exception as e:
    logger.warning(f"Could not patch vastdb SDK for vector columns: {e}")


class VastDBService:
    def __init__(self):
        self.cfg = settings.vdb
        self.creds = settings.vast
        self.embedding_dims = settings.embedding.dimensions
        self._stored_vector_dim = None

        endpoint = self.cfg.endpoint
        if not endpoint.startswith(("http://", "https://")):
            endpoint = f"http://{endpoint}"
        self.endpoint = endpoint

        self._adbc_connection = {
            "driver_path": ADBC_DRIVER_PATH,
            "endpoint": endpoint,
            "access_key": self.creds.access_key,
            "secret_key": self.creds.secret_key,
            "bucket": self.cfg.bucket,
            "schema": self.cfg.schema_name,
        }

    def _get_stored_vector_dim(self) -> int:
        if self._stored_vector_dim is not None:
            return self._stored_vector_dim
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "variants")
                if table:
                    for field in table.arrow_schema:
                        if field.name == "vectors" and "fixed_size_list" in str(field.type):
                            self._stored_vector_dim = field.type.list_size
                            logger.info(f"Detected stored vector dimension: {self._stored_vector_dim}")
                            return self._stored_vector_dim
        except Exception as e:
            logger.warning(f"Could not detect stored vector dimension: {e}")
        self._stored_vector_dim = self.embedding_dims
        return self._stored_vector_dim

    def _connect(self):
        return vastdb.connect(
            endpoint=self.endpoint,
            access=self.creds.access_key,
            secret=self.creds.secret_key,
            ssl_verify=False,
        )

    def _get_table(self, tx, table_name: str):
        bucket = tx.bucket(self.cfg.bucket)
        schema = bucket.schema(self.cfg.schema_name, fail_if_missing=False)
        if schema is None:
            return None
        return schema.table(table_name, fail_if_missing=False)

    def _ensure_table(self, tx, table_name: str, arrow_schema: pa.Schema):
        bucket = tx.bucket(self.cfg.bucket)
        schema = bucket.schema(self.cfg.schema_name, fail_if_missing=False)
        if schema is None:
            schema = bucket.create_schema(self.cfg.schema_name, fail_if_exists=False)
        table = schema.table(table_name, fail_if_missing=False)
        if table is None:
            try:
                table = schema.create_table(table_name, columns=arrow_schema)
            except Exception as e:
                if "409" in str(e) or "already exists" in str(e).lower():
                    table = schema.table(table_name)
                else:
                    raise
        return table

    def _table_ref(self, table_name: str) -> str:
        return f'"{self.cfg.bucket}/{self.cfg.schema_name}"."{table_name}"'

    # --- Patient operations (vastdb SDK) ---

    def upsert_patient(self, patient_data: Dict[str, Any]) -> bool:
        patient_id = patient_data["patient_id"]
        now = datetime.now(timezone.utc)

        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._ensure_table(tx, "patients", PATIENTS_SCHEMA)

                reader = table.select(
                    predicate=_.patient_id == patient_id,
                    columns=["patient_id"],
                    internal_row_id=True,
                )
                existing = reader.read_all()

                if len(existing) > 0:
                    row_ids = existing.column("$row_id")
                    update_arrays = {"$row_id": row_ids}
                    type_map = {
                        "age": pa.int32(),
                        "sex": pa.utf8(),
                        "ethnicity": pa.utf8(),
                        "weight_kg": pa.float64(),
                        "height_cm": pa.float64(),
                        "notes": pa.utf8(),
                    }
                    for key, arrow_type in type_map.items():
                        if key in patient_data and patient_data[key] is not None:
                            update_arrays[key] = pa.array([patient_data[key]], type=arrow_type)
                    update_arrays["updated_at"] = pa.array([now], type=pa.timestamp("ns"))
                    table.update(pa.table(update_arrays))
                else:
                    record = pa.table({
                        "patient_id": [patient_id],
                        "age": pa.array([patient_data.get("age", 0)], type=pa.int32()),
                        "sex": [patient_data.get("sex", "")],
                        "ethnicity": [patient_data.get("ethnicity", "")],
                        "weight_kg": [patient_data.get("weight_kg", 0.0)],
                        "height_cm": [patient_data.get("height_cm", 0.0)],
                        "notes": [patient_data.get("notes", "")],
                        "created_at": pa.array([now], type=pa.timestamp("ns")),
                        "updated_at": pa.array([now], type=pa.timestamp("ns")),
                    })
                    table.insert(record)
            return True
        except Exception as e:
            logger.error(f"Patient upsert failed: {e}")
            return False

    def get_patient(self, patient_id: str) -> Optional[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "patients")
                if table is None:
                    return None
                reader = table.select(predicate=_.patient_id == patient_id)
                result = reader.read_all()
                if len(result) > 0:
                    return result.to_pylist()[0]
                return None
        except Exception as e:
            logger.error(f"Patient lookup failed: {e}")
            return None

    def get_all_patients(self) -> List[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "patients")
                if table is None:
                    return []
                reader = table.select()
                result = reader.read_all()
                return result.to_pylist()
        except Exception as e:
            logger.error(f"Get all patients failed: {e}")
            return []

    # --- Sample operations (vastdb SDK) ---

    def register_sample(
        self,
        sample_id: str,
        patient_id: str,
        fastq_path: str,
        processing_mode: str,
    ) -> bool:
        now = datetime.now(timezone.utc)

        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._ensure_table(tx, "samples", SAMPLES_SCHEMA)

                reader = table.select(
                    predicate=_.sample_id == sample_id,
                    columns=["sample_id"],
                    internal_row_id=True,
                )
                existing = reader.read_all()

                if len(existing) > 0:
                    row_ids = existing.column("$row_id")
                    table.update(pa.table({
                        "$row_id": row_ids,
                        "fastq_path": [fastq_path],
                        "vcf_path": [""],
                        "argo_workflow_id": [""],
                        "status": ["pending"],
                        "variant_count": pa.array([0], type=pa.uint32()),
                        "processing_mode": [processing_mode],
                        "registered_at": pa.array([now], type=pa.timestamp("ns")),
                        "completed_at": pa.array([None], type=pa.timestamp("ns")),
                    }))
                else:
                    table.insert(pa.table({
                        "sample_id": [sample_id],
                        "patient_id": [patient_id],
                        "fastq_path": [fastq_path],
                        "vcf_path": [""],
                        "argo_workflow_id": [""],
                        "status": ["pending"],
                        "variant_count": pa.array([0], type=pa.uint32()),
                        "processing_mode": [processing_mode],
                        "registered_at": pa.array([now], type=pa.timestamp("ns")),
                        "completed_at": pa.array([None], type=pa.timestamp("ns")),
                    }))
            return True
        except Exception as e:
            logger.error(f"Sample registration failed: {e}")
            return False

    def get_sample(self, sample_id: str) -> Optional[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "samples")
                if table is None:
                    return None
                reader = table.select(predicate=_.sample_id == sample_id)
                result = reader.read_all()
                if len(result) > 0:
                    return result.to_pylist()[0]
                return None
        except Exception as e:
            logger.error(f"Sample lookup failed: {e}")
            return None

    def update_sample_status(self, sample_id: str, status: str, workflow_id: str = "") -> bool:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._ensure_table(tx, "samples", SAMPLES_SCHEMA)
                reader = table.select(
                    predicate=_.sample_id == sample_id,
                    columns=["sample_id"],
                    internal_row_id=True,
                )
                existing = reader.read_all()
                if len(existing) == 0:
                    return False

                row_ids = existing.column("$row_id")
                update_fields = {
                    "$row_id": row_ids,
                    "status": pa.array([status], type=pa.utf8())
                }
                if workflow_id:
                    update_fields["argo_workflow_id"] = pa.array([workflow_id], type=pa.utf8())
                
                table.update(pa.table(update_fields))
            return True
        except Exception as e:
            logger.error(f"Sample status update failed: {e}")
            return False

    def get_patient_samples(self, patient_id: str) -> List[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "samples")
                if table is None:
                    return []
                reader = table.select(predicate=_.patient_id == patient_id)
                result = reader.read_all()
                return result.to_pylist()
        except Exception as e:
            logger.error(f"Patient query failed: {e}")
            return []

    def get_all_pipelines(self) -> List[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "samples")
                if table is None:
                    return []
                reader = table.select()
                result = reader.read_all()
                rows = result.to_pylist()
                rows.sort(key=lambda r: r.get("registered_at") or "", reverse=True)
                return rows
        except Exception as e:
            logger.error(f"Pipeline query failed: {e}")
            return []

    # --- Variant search (ADBC with Python fallback) ---

    def search_variants(
        self,
        query_embedding: List[float],
        limit: int = 20,
        gene_filter: Optional[str] = None,
        quality_filter: Optional[str] = None,
        patient_filter: Optional[str] = None,
        significance_filter: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        if ADBC_AVAILABLE and ADBC_DRIVER_PATH:
            return self._search_variants_adbc(
                query_embedding, limit, gene_filter, quality_filter, patient_filter, significance_filter
            )
        return self._search_variants_python(
            query_embedding, limit, gene_filter, quality_filter, patient_filter, significance_filter
        )

    def _search_variants_adbc(
        self,
        query_embedding: List[float],
        limit: int,
        gene_filter: Optional[str],
        quality_filter: Optional[str],
        patient_filter: Optional[str],
        significance_filter: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        stored_dim = self._get_stored_vector_dim()
        table_ref = self._table_ref("variants")

        embedding = list(query_embedding)
        if len(embedding) < stored_dim:
            logger.warning(
                f"Query embedding dim ({len(embedding)}) < stored vectors ({stored_dim}), padding with zeros"
            )
            embedding.extend([0.0] * (stored_dim - len(embedding)))
        elif len(embedding) > stored_dim:
            logger.warning(
                f"Query embedding dim ({len(embedding)}) > stored vectors ({stored_dim}), truncating"
            )
            embedding = embedding[:stored_dim]

        vec_sql = ",".join(f"{v:.10f}" for v in embedding)

        where_clauses = []
        if gene_filter:
            where_clauses.append(f"gene = '{gene_filter}'")
        if quality_filter:
            try:
                q_val = float(quality_filter)
                where_clauses.append(f"quality >= {q_val}")
            except ValueError:
                pass
        if patient_filter:
            where_clauses.append(f"patient_id = '{patient_filter}'")
        if significance_filter:
            sigs_lower = sorted({s.replace("'", "''").lower() for s in significance_filter})
            sigs_str = "', '".join(sigs_lower)
            where_clauses.append(f"LOWER(clinical_significance) IN ('{sigs_str}')")

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        sql_query = f"""
            SELECT
                variant_id, sample_id, patient_id, chromosome, position,
                ref_allele, alt_allele, gene, variant_type, quality,
                filter_status, clinical_significance, variant_description,
                embedding_model, pipeline_run_id, timestamp, cache_hits_count,
                array_cosine_distance(vectors::FLOAT[{stored_dim}], ARRAY[{vec_sql}]::FLOAT[{stored_dim}]) as distance
            FROM {table_ref}
            {where_sql}
            ORDER BY distance
            LIMIT {limit}
        """

        try:
            with adbc_driver_manager.dbapi.connect(
                driver=self._adbc_connection["driver_path"],
                db_kwargs={
                    "vast.db.endpoint": self._adbc_connection["endpoint"],
                    "vast.db.access_key": self._adbc_connection["access_key"],
                    "vast.db.secret_key": self._adbc_connection["secret_key"],
                },
            ) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(sql_query)
                    arrow_table = cursor.fetch_arrow_table()
        except Exception as e:
            logger.error(f"ADBC vector search failed, falling back to Python: {e}")
            return self._search_variants_python(
                query_embedding, limit, gene_filter, quality_filter, patient_filter, significance_filter,
            )

        rows = arrow_table.to_pylist()
        for row in rows:
            dist_val = row.pop("distance", None)
            try:
                row["similarity_score"] = round(max(0.0, 1.0 - float(dist_val)), 4) if dist_val is not None else 0.0
            except (TypeError, ValueError):
                row["similarity_score"] = 0.0

        return rows

    def _search_variants_python(
        self,
        query_embedding: List[float],
        limit: int,
        gene_filter: Optional[str],
        quality_filter: Optional[str],
        patient_filter: Optional[str],
        significance_filter: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        select_columns = [
            "variant_id", "sample_id", "patient_id", "chromosome", "position",
            "ref_allele", "alt_allele", "gene", "variant_type", "quality",
            "filter_status", "clinical_significance", "variant_description",
            "embedding_model", "pipeline_run_id", "timestamp", "cache_hits_count",
        ]

        try:
            predicate = None
            if gene_filter:
                predicate = _.gene == gene_filter
            if quality_filter:
                try:
                    q_val = float(quality_filter)
                    p = _.quality >= q_val
                    predicate = predicate & p if predicate is not None else p
                except ValueError:
                    pass
            if patient_filter:
                p = _.patient_id == patient_filter
                predicate = predicate & p if predicate is not None else p
            if significance_filter:
                sigs = set()
                for s in significance_filter:
                    sigs.add(s)
                    sigs.add(s.lower())
                    sigs.add(s.upper())
                    sigs.add(s.capitalize())
                    sigs.add(s.title())
                p = _.clinical_significance.isin(list(sigs))
                predicate = predicate & p if predicate is not None else p

            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "variants")
                if table is None:
                    return []
                kwargs = {"columns": select_columns}
                if predicate is not None:
                    kwargs["predicate"] = predicate
                reader = table.select(**kwargs)
                result = reader.read_all()

            rows = result.to_pylist()
            if not rows:
                return []

            logger.warning(
                f"Python fallback: returning {len(rows)} variants without similarity scores "
                f"(SDK monkey-patch strips vector columns). ADBC required for vector search."
            )
            for row in rows:
                row["similarity_score"] = 0.0

            return rows[:limit]

        except Exception as e:
            logger.error(f"Variant search failed: {e}")
            return []

    def get_variant_by_id(self, variant_id: str) -> Optional[Dict[str, Any]]:
        select_columns = [
            "variant_id", "sample_id", "patient_id", "chromosome", "position",
            "ref_allele", "alt_allele", "gene", "variant_type", "quality",
            "filter_status", "clinical_significance", "variant_description",
            "embedding_model", "pipeline_run_id", "timestamp", "cache_hits_count",
        ]
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "variants")
                if table is None:
                    return None
                reader = table.select(
                    columns=select_columns,
                    predicate=_.variant_id == variant_id,
                )
                result = reader.read_all()
            rows = result.to_pylist()
            if rows:
                rows[0]["similarity_score"] = 1.0
                return rows[0]
            return None
        except Exception as e:
            logger.error(f"Get variant by ID failed: {e}")
            return None

    # --- Patient variant queries (vastdb SDK) ---

    def get_patient_variants(
        self,
        patient_id: str,
        gene_filter: Optional[str] = None,
        chromosome_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        select_columns = [
            "variant_id", "sample_id", "patient_id", "chromosome", "position",
            "ref_allele", "alt_allele", "gene", "variant_type", "quality",
            "filter_status", "clinical_significance", "variant_description",
            "embedding_model", "pipeline_run_id", "timestamp", "cache_hits_count"
        ]

        try:
            predicate = _.patient_id == patient_id
            if gene_filter:
                predicate = predicate & (_.gene == gene_filter)
            if chromosome_filter:
                predicate = predicate & (_.chromosome == chromosome_filter)

            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "variants")
                if table is None:
                    return []
                reader = table.select(columns=select_columns, predicate=predicate)
                result = reader.read_all()
                return result.to_pylist()
        except Exception as e:
            logger.error(f"Variant query failed: {e}")
            return []

    # --- Job operations (vastdb SDK) ---

    def insert_job(self, job_data: Dict[str, Any]) -> bool:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._ensure_table(tx, "jobs", JOBS_SCHEMA)
                
                record = pa.table({
                    "job_id": [job_data["job_id"]],
                    "sample_id": [job_data.get("sample_id", "")],
                    "patient_id": [job_data.get("patient_id", "")],
                    "fastq_path": [job_data.get("fastq_path", "")],
                    "vcf_path": [job_data.get("vcf_path", "")],
                    "logs_path": [job_data.get("logs_path", "")],
                    "status": [job_data.get("status", "running")],
                    "processing_mode": [job_data.get("processing_mode", "mock")],
                    "started_at": pa.array([job_data.get("started_at", datetime.now(timezone.utc))], type=pa.timestamp("ns")),
                    "completed_at": pa.array([None], type=pa.timestamp("ns")),
                })
                table.insert(record)
            return True
        except Exception as e:
            logger.error(f"Job insert failed: {e}")
            return False

    def update_job(self, job_id: str, update_data: Dict[str, Any]) -> bool:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._ensure_table(tx, "jobs", JOBS_SCHEMA)

                reader = table.select(
                    predicate=_.job_id == job_id,
                    columns=["job_id"],
                    internal_row_id=True,
                )
                existing = reader.read_all()

                if len(existing) == 0:
                    logger.warning(f"Job {job_id} not found for update")
                    return False

                row_ids = existing.column("$row_id")
                update_arrays = {"$row_id": row_ids}
                
                if "status" in update_data:
                    update_arrays["status"] = pa.array([update_data["status"]], type=pa.utf8())
                if "vcf_path" in update_data:
                    update_arrays["vcf_path"] = pa.array([update_data["vcf_path"]], type=pa.utf8())
                if "logs_path" in update_data:
                    update_arrays["logs_path"] = pa.array([update_data["logs_path"]], type=pa.utf8())
                if "completed_at" in update_data:
                    update_arrays["completed_at"] = pa.array([update_data["completed_at"]], type=pa.timestamp("ns"))

                table.update(pa.table(update_arrays))
            return True
        except Exception as e:
            logger.error(f"Job update failed: {e}")
            return False

    def get_all_jobs(self) -> List[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "jobs")
                if table is None:
                    return []
                reader = table.select()
                result = reader.read_all()
                return result.to_pylist()
        except Exception as e:
            logger.error(f"Get all jobs failed: {e}")
            return []

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "jobs")
                if table is None:
                    return None
                reader = table.select(predicate=_.job_id == job_id)
                result = reader.read_all()
                rows = result.to_pylist()
                return rows[0] if rows else None
        except Exception as e:
            logger.error(f"Get job {job_id} failed: {e}")
            return None

    # --- Molecule operations (vastdb SDK) ---

    @staticmethod
    def _molecule_id(seed_smiles: str, generated_smiles: str) -> str:
        return hashlib.md5(f"{seed_smiles}:{generated_smiles}".encode()).hexdigest()

    def save_molecules(
        self,
        seed_smiles: str,
        seed_drug_name: Optional[str],
        molecules: List[Dict[str, Any]],
        gene: str,
        variant_id: str,
    ) -> int:
        now = datetime.now(timezone.utc)
        records = []
        for mol in molecules:
            gen_smiles = mol.get("sample", mol.get("smiles", ""))
            if not gen_smiles:
                continue
            records.append({
                "molecule_id": self._molecule_id(seed_smiles, gen_smiles),
                "seed_smiles": seed_smiles,
                "seed_drug_name": seed_drug_name or "",
                "generated_smiles": gen_smiles,
                "tanimoto_score": float(mol.get("score", 0.0)),
                "gene": gene,
                "variant_id": variant_id,
                "docking_pdb_id": "",
                "docking_score": 0.0,
                "docking_poses_sdf": "",
                "docking_poses_json": "",
                "protein_pdb_content": "",
                "status": "generated",
                "annotations": "[]",
                "created_at": now,
                "updated_at": now,
            })

        if not records:
            return 0

        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._ensure_table(tx, "molecules", MOLECULES_SCHEMA)
                arrow_table = pa.Table.from_pylist(records, schema=MOLECULES_SCHEMA)
                table.insert(arrow_table)
            return len(records)
        except Exception as e:
            logger.error(f"Save molecules failed: {e}")
            return 0

    def get_molecules_for_seed(self, seed_smiles: str) -> List[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "molecules")
                if table is None:
                    return []
                reader = table.select(predicate=_.seed_smiles == seed_smiles)
                result = reader.read_all()
                return result.to_pylist()
        except Exception as e:
            logger.error(f"Get molecules for seed failed: {e}")
            return []

    def get_all_molecules(self) -> List[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "molecules")
                if table is None:
                    return []
                reader = table.select()
                result = reader.read_all()
                return result.to_pylist()
        except Exception as e:
            logger.error(f"Get all molecules failed: {e}")
            return []

    def get_molecules_for_variant(self, variant_id: str) -> List[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "molecules")
                if table is None:
                    return []
                reader = table.select(predicate=_.variant_id == variant_id)
                result = reader.read_all()
                return result.to_pylist()
        except Exception as e:
            logger.error(f"Get molecules for variant failed: {e}")
            return []

    def get_molecule(self, molecule_id: str) -> Optional[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "molecules")
                if table is None:
                    return None
                reader = table.select(predicate=_.molecule_id == molecule_id)
                result = reader.read_all()
                rows = result.to_pylist()
                return rows[0] if rows else None
        except Exception as e:
            logger.error(f"Get molecule {molecule_id} failed: {e}")
            return None

    def get_docking_result(self, generated_smiles: str, pdb_id: str) -> Optional[Dict[str, Any]]:
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._get_table(tx, "molecules")
                if table is None:
                    return None
                predicate = (_.generated_smiles == generated_smiles) & (_.docking_pdb_id == pdb_id)
                reader = table.select(predicate=predicate)
                result = reader.read_all()
                rows = result.to_pylist()
                if rows and rows[0].get("docking_pdb_id"):
                    return rows[0]
                return None
        except Exception as e:
            logger.error(f"Get docking result failed: {e}")
            return None

    def save_docking_result(
        self,
        molecule_id: str,
        pdb_id: str,
        score: float,
        poses_sdf_uri: str,
        poses_json: str,
        protein_pdb_uri: str,
    ) -> None:
        now = datetime.now(timezone.utc)
        session = self._connect()
        with session.transaction() as tx:
            table = self._ensure_table(tx, "molecules", MOLECULES_SCHEMA)
            reader = table.select(
                predicate=_.molecule_id == molecule_id,
                columns=["molecule_id"],
                internal_row_id=True,
            )
            existing = reader.read_all()
            if len(existing) == 0:
                raise LookupError(f"Molecule {molecule_id} not found in VastDB")

            row_ids = existing.column("$row_id")
            table.update(pa.table({
                "$row_id": row_ids,
                "docking_pdb_id": pa.array([pdb_id], type=pa.utf8()),
                "docking_score": pa.array([score], type=pa.float64()),
                "docking_poses_sdf": pa.array([poses_sdf_uri], type=pa.utf8()),
                "docking_poses_json": pa.array([poses_json], type=pa.utf8()),
                "protein_pdb_content": pa.array([protein_pdb_uri], type=pa.utf8()),
                "status": pa.array(["docked"], type=pa.utf8()),
                "updated_at": pa.array([now], type=pa.timestamp("ns")),
            }))

    def drop_tables(self, tables: List[str]) -> Dict[str, Any]:
        result: Dict[str, Any] = {"tables": {}, "dropped": 0, "failed": 0}
        try:
            session = self._connect()
            with session.transaction() as tx:
                bucket = tx.bucket(self.cfg.bucket)
                schema = bucket.schema(self.cfg.schema_name, fail_if_missing=False)
                if schema is None:
                    result["note"] = "schema absent"
                    return result
                for name in tables:
                    table = schema.table(name, fail_if_missing=False)
                    if table is None:
                        result["tables"][name] = {"existed": False}
                        continue
                    try:
                        table.drop()
                        result["tables"][name] = {"existed": True, "dropped": True}
                        result["dropped"] += 1
                    except Exception as exc:
                        logger.warning(f"Drop table {name} failed: {exc}")
                        result["tables"][name] = {"existed": True, "error": str(exc)}
                        result["failed"] += 1
        except Exception as exc:
            logger.error(f"drop_tables failed: {exc}")
            result["error"] = str(exc)
        return result

    def append_annotation(self, molecule_id: str, annotation: Dict[str, Any]) -> bool:
        now = datetime.now(timezone.utc)
        try:
            session = self._connect()
            with session.transaction() as tx:
                table = self._ensure_table(tx, "molecules", MOLECULES_SCHEMA)
                reader = table.select(
                    predicate=_.molecule_id == molecule_id,
                    columns=["molecule_id", "annotations", "status"],
                    internal_row_id=True,
                )
                existing = reader.read_all()
                if len(existing) == 0:
                    return False

                row = existing.to_pylist()[0]
                row_ids = existing.column("$row_id")

                current_annotations = json.loads(row.get("annotations") or "[]")
                current_annotations.append(annotation)

                update_fields = {
                    "$row_id": row_ids,
                    "annotations": pa.array([json.dumps(current_annotations)], type=pa.utf8()),
                    "updated_at": pa.array([now], type=pa.timestamp("ns")),
                }

                new_status = annotation.get("new_status")
                if new_status:
                    update_fields["status"] = pa.array([new_status], type=pa.utf8())

                table.update(pa.table(update_fields))
            return True
        except Exception as e:
            logger.error(f"Append annotation failed: {e}")
            return False
