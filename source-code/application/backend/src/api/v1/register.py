import posixpath
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.config import settings
from src.services.s3_service import S3Service
from src.services.vastdb_service import VastDBService

router = APIRouter()
s3 = S3Service()
vastdb = VastDBService()


class RegisterRequest(BaseModel):
    source_path: str
    patient_id: str
    sample_id: Optional[str] = None
    age: int
    sex: str
    ethnicity: str
    weight_kg: float
    height_cm: float
    notes: Optional[str] = None


class RegisterResponse(BaseModel):
    sample_id: str
    patient_id: str
    fastq_path: str
    status: str


@router.get("/config")
async def get_config():
    return {"processing_mode": settings.processing_mode}

@router.post("/register", response_model=RegisterResponse)
async def register_sample(req: RegisterRequest):
    src_bucket, src_key = s3.parse_s3_uri(req.source_path)
    if not src_bucket or not src_key:
        raise HTTPException(status_code=400, detail="Invalid S3 source path. Expected s3://bucket/key")

    if not s3.head_object(src_bucket, src_key):
        raise HTTPException(status_code=404, detail=f"Source file not found: {req.source_path}")

    patient_data = {"patient_id": req.patient_id}
    for field in ("age", "sex", "ethnicity", "weight_kg", "height_cm", "notes"):
        val = getattr(req, field)
        if val is not None:
            patient_data[field] = val

    if not vastdb.upsert_patient(patient_data):
        raise HTTPException(status_code=500, detail="Failed to register patient in VastDB")

    sample_id = req.sample_id
    if not sample_id:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        sample_id = f"{req.patient_id}-{ts}"

    filename = posixpath.basename(src_key)
    controlled_key = s3.build_controlled_key(req.patient_id, sample_id, filename)
    fastq_path = f"s3://{settings.s3.fastq_bucket}/{controlled_key}"

    if not vastdb.register_sample(
        sample_id=sample_id,
        patient_id=req.patient_id,
        fastq_path=controlled_key,
        processing_mode=settings.processing_mode,
    ):
        raise HTTPException(status_code=500, detail="Failed to register sample in VastDB")

    try:
        s3.copy_fastq_to_controlled_path(req.source_path, req.patient_id, sample_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to copy file: {e}")

    return RegisterResponse(
        sample_id=sample_id,
        patient_id=req.patient_id,
        fastq_path=fastq_path,
        status="pending",
    )
