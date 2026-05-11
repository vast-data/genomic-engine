import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.config import settings
from src.services.k8s_service import K8sService
from src.services.s3_service import S3Service
from src.services.vastdb_service import VastDBService

logger = logging.getLogger(__name__)

router = APIRouter()
s3 = S3Service()
vastdb = VastDBService()
k8s = K8sService()

DEFAULT_TABLES = ("patients", "samples", "jobs", "variants", "molecules")


class ResetRequest(BaseModel):
    confirm: bool = False


class ResetResponse(BaseModel):
    s3: Dict[str, Any]
    vastdb: Dict[str, Any]
    k8s: Dict[str, Any]
    raw_bucket_protected: str


def _wipe_managed_buckets(buckets: List[str]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"buckets": {}, "total_deleted": 0, "total_failed": 0}
    for bucket in buckets:
        per_bucket = s3.wipe_bucket(bucket)
        summary["buckets"][bucket] = per_bucket
        summary["total_deleted"] += per_bucket.get("deleted", 0)
        summary["total_failed"] += per_bucket.get("failed", 0)
    return summary


@router.post("/reset", response_model=ResetResponse)
def reset_demo(req: ResetRequest):
    if not req.confirm:
        raise HTTPException(
            status_code=400,
            detail=(
                "Refusing to reset without confirm=true. This wipes the controlled S3 buckets, "
                "drops the genomics VastDB tables, and deletes all genomic-engine K8s Jobs."
            ),
        )

    raw_bucket = settings.s3.raw_bucket
    managed_buckets = [b for b in (settings.s3.fastq_bucket, settings.s3.vcf_bucket) if b and b != raw_bucket]

    s3_summary = _wipe_managed_buckets(managed_buckets)
    vdb_summary = vastdb.drop_tables(list(DEFAULT_TABLES))
    k8s_summary = k8s.delete_pipeline_jobs()

    logger.info(
        "[ADMIN] reset complete: s3_deleted=%d vastdb_dropped=%d jobs_deleted=%d (raw bucket %s preserved)",
        s3_summary.get("total_deleted", 0),
        vdb_summary.get("dropped", 0),
        k8s_summary.get("deleted", 0),
        raw_bucket,
    )

    return ResetResponse(
        s3=s3_summary,
        vastdb=vdb_summary,
        k8s=k8s_summary,
        raw_bucket_protected=raw_bucket,
    )
