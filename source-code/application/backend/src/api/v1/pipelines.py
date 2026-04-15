from typing import List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from src.services.k8s_service import K8sService
from src.services.vastdb_service import VastDBService
from src.services.s3_service import S3Service
from src.config import settings
from datetime import datetime, timezone

router = APIRouter()
k8s = K8sService()
vastdb = VastDBService()
s3 = S3Service()

class SubmitRequest(BaseModel):
    sample_id: str
    patient_id: str
    fastq_path: str
    mock: bool = False

@router.post("/submit")
async def submit_job(req: SubmitRequest):
    try:
        job_name = k8s.submit_job(
            sample_id=req.sample_id,
            patient_id=req.patient_id,
            fastq_path=req.fastq_path,
            mock=req.mock
        )
        
        vastdb.insert_job({
            "job_id": job_name,
            "sample_id": req.sample_id,
            "patient_id": req.patient_id,
            "fastq_path": req.fastq_path,
            "status": "running",
            "processing_mode": "mock" if req.mock else "gpu",
            "started_at": datetime.now(timezone.utc)
        })

        vastdb.update_sample_status(
            sample_id=req.sample_id,
            status="processing",
            workflow_id=job_name
        )

        return {"status": "success", "job_name": job_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("")
async def list_pipelines():
    db_jobs = vastdb.get_all_jobs()
    samples = {s["sample_id"]: s for s in vastdb.get_all_pipelines()}
    
    enriched = []
    for job in db_jobs:
        job_name = job.get("job_id", "")
        phase = job.get("status", "Unknown").capitalize()
        sample_id = job.get("sample_id")
        sample_record = samples.get(sample_id, {})
        
        if phase.lower() == "running":
            job_status = k8s.get_job_status(job_name)
            if job_status.get("phase") in ["Failed", "Succeeded"]:
                 phase = job_status.get("phase")
                 
        enriched.append({
            **job,
            "variant_count": sample_record.get("variant_count"),
            "registered_at": sample_record.get("registered_at"),
            "argo_workflow_id": job_name,
            "argo_phase": phase,
            "argo_started_at": job.get("started_at", ""),
            "argo_finished_at": job.get("completed_at", ""),
        })

    enriched.sort(key=lambda x: x.get("started_at") or "", reverse=True)

    return {"total": len(enriched), "pipelines": enriched}


@router.get("/{workflow_name}")
async def get_pipeline(workflow_name: str):
    job = vastdb.get_job(workflow_name)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_status = k8s.get_job_status(workflow_name)
    phase = job.get("status").capitalize()
    if phase.lower() == "running":
        phase = job_status.get("phase", "Running")

    sample_record = vastdb.get_sample(job.get("sample_id"))
    sample_status = sample_record.get("status") if sample_record else job.get("status")

    dag_nodes = [
        {
            "id": f"{workflow_name}-1",
            "name": "FASTQ Upload",
            "type": "Step",
            "phase": "Succeeded"
        },
        {
            "id": workflow_name,
            "name": "AI/ML Analysis",
            "type": "Pod",
            "phase": phase
        },
        {
            "id": f"{workflow_name}-3",
            "name": "VCF Upload",
            "type": "Step",
            "phase": "Succeeded" if (phase in ("Succeeded", "Completed")) else ("Running" if phase == "Running" else "Pending")
        },
        {
            "id": f"{workflow_name}-4",
            "name": "Variant Processing",
            "type": "Step",
            "phase": (
                "Succeeded" if sample_status == "completed"
                else "Failed"  if sample_status == "failed"
                else "Running" if phase in ("Succeeded", "Completed")
                else "Pending"
            )
        }
    ]
    
    detail = {
        "name": workflow_name,
        "phase": phase,
        "mock": job.get("processing_mode") == "mock",
        "dag_nodes": dag_nodes,
        "raw_status": job_status,
        "sample_id": job.get("sample_id"),
        "patient_id": job.get("patient_id"),
        "sample": sample_record if sample_record else job
    }

    return detail


@router.get("/{workflow_name}/logs")
async def get_pipeline_logs(workflow_name: str, pod: str = None):
    job = vastdb.get_job(workflow_name)
    if job and job.get("logs_path"):
        try:
            log_key = job["logs_path"].replace(f"s3://{settings.s3.vcf_bucket}/", "")
            resp = s3.client.get_object(Bucket=settings.s3.vcf_bucket, Key=log_key)
            content = resp['Body'].read().decode('utf-8')
            logs = [{"content": line} for line in content.splitlines()]
            return {"workflow": workflow_name, "logs": logs}
        except Exception:
            pass

    logs = k8s.get_job_logs(workflow_name)
    return {"workflow": workflow_name, "logs": logs}
