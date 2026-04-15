import asyncio
import logging
from datetime import datetime, timezone
from src.services.k8s_service import K8sService
from src.services.vastdb_service import VastDBService
from src.services.s3_service import S3Service
from src.config import settings

logger = logging.getLogger(__name__)

async def watch_jobs_loop():
    k8s = K8sService()
    vastdb = VastDBService()
    s3 = S3Service()
    
    while True:
        try:
            jobs = vastdb.get_all_jobs()
            for job in jobs:
                status = job.get("status")
                job_id = job.get("job_id")
                sample_id = job.get("sample_id")
                patient_id = job.get("patient_id")
                
                if status == "running" and job_id:
                    job_status = k8s.get_job_status(job_id)
                    phase = job_status.get("phase")
                    
                    if phase in ["Failed", "Succeeded", "Unknown"]:
                        final_phase = "failed" if phase == "Unknown" else phase.lower()
                        logger.info(f"Job {job_id} reached terminal state: {phase}")
                        
                        vcf_path = ""
                        logs_path = ""
                        completed_at = datetime.now(timezone.utc)
                        
                        try:
                            log_lines = k8s.get_job_logs(job_id)
                            log_text = "\n".join([line.get("content", "") for line in log_lines])
                            if log_text.strip() and "Pod not found for job" not in log_text:
                                log_key = f"{patient_id}/{sample_id}/pipeline.log"
                                s3.put_object(settings.s3.vcf_bucket, log_key, log_text)
                                logs_path = f"s3://{settings.s3.vcf_bucket}/{log_key}"
                                logger.info(f"Uploaded logs to {logs_path}")
                        except Exception as log_e:
                            logger.error(f"Failed to upload logs for {job_id}: {log_e}")

                        update_data = {
                            "status": final_phase,
                            "completed_at": completed_at,
                        }
                        if logs_path:
                            update_data["logs_path"] = logs_path

                        if final_phase == "succeeded":
                            vcf_path = f"s3://{settings.s3.vcf_bucket}/{patient_id}/{sample_id}/{sample_id}.vcf"
                            update_data["vcf_path"] = vcf_path
                        
                        vastdb.update_job(job_id, update_data)
                        
                        if final_phase == "failed":
                            vastdb.update_sample_status(sample_id, "failed")
                        
        except Exception as e:
            logger.error(f"Error in job watcher loop: {e}")
            
        await asyncio.sleep(10)
