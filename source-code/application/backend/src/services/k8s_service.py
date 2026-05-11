import logging
import os
import json
from typing import Dict, Any, List, Optional
from datetime import datetime

from kubernetes import client, config

from src.config import settings

logger = logging.getLogger(__name__)

class K8sService:
    def __init__(self):
        self.namespace = os.environ.get("POD_NAMESPACE", "genomics")
        
        try:
            config.load_incluster_config()
        except config.ConfigException:
            try:
                config.load_kube_config()
            except Exception as e:
                logger.warning(f"Could not load kubernetes config: {e}")
                
        self.batch_v1 = client.BatchV1Api()
        self.core_v1 = client.CoreV1Api()
        
    def submit_job(self, sample_id: str, patient_id: str, fastq_path: str, mock: bool = False) -> str:
        timestamp = int(datetime.now().timestamp())
        job_name = f"parabricks-{sample_id.lower()}-{timestamp}"
        
        vcf_filename = f"{sample_id}.vcf"
        output_bucket = settings.s3.vcf_bucket
        dest_key = f"{patient_id}/{sample_id}/{vcf_filename}"

        init_download = client.V1Container(
            name="download-fastq",
            image="amazon/aws-cli:latest",
            image_pull_policy="Always",
            command=["bash", "-c"],
            args=[
                f"aws s3 cp {fastq_path} /workdir/input.fq.gz --endpoint-url $S3_ENDPOINT"
            ],
            env=[
                client.V1EnvVar(name="S3_ENDPOINT", value=settings.s3.endpoint),
                client.V1EnvVar(name="AWS_ACCESS_KEY_ID", value=settings.vast.access_key),
                client.V1EnvVar(name="AWS_SECRET_ACCESS_KEY", value=settings.vast.secret_key),
            ],
            volume_mounts=[client.V1VolumeMount(name="workdir", mount_path="/workdir")]
        )

        job_settings = settings.job.mock if mock else settings.job.gpu

        if mock:
            compute_container = client.V1Container(
                name="compute-parabricks",
                image=job_settings.image,
                image_pull_policy="Always",
                command=["python", "/app/mock_pbrun.py", "deepvariant_germline", "--out-variants", f"/workdir/{vcf_filename}"],
                resources=client.V1ResourceRequirements(
                    limits=job_settings.resources.limits,
                    requests=job_settings.resources.requests
                ),
                volume_mounts=[client.V1VolumeMount(name="workdir", mount_path="/workdir")]
            )
        else:
            compute_container = client.V1Container(
                name="compute-parabricks",
                image=job_settings.image,
                image_pull_policy="Always",
                command=["/bin/bash", "-c"],
                args=[
                    f"pbrun deepvariant_germline --ref /data/refs/hg38.fa --in-fq /workdir/input.fq.gz --out-bam /workdir/{sample_id}.bam --out-variants /workdir/{vcf_filename} --tmp-dir /workdir/tmp/"
                ],
                resources=client.V1ResourceRequirements(
                    limits=job_settings.resources.limits,
                    requests=job_settings.resources.requests
                ),
                volume_mounts=[
                    client.V1VolumeMount(name="workdir", mount_path="/workdir"),
                    client.V1VolumeMount(name="vast-data", mount_path="/data")
                ]
            )

        main_upload = client.V1Container(
            name="upload-vcf",
            image="amazon/aws-cli:latest",
            image_pull_policy="Always",
            command=["bash", "-c"],
            args=[
                f"aws s3 cp /workdir/{vcf_filename} s3://{output_bucket}/{dest_key} --endpoint-url $S3_ENDPOINT && echo 'Upload complete.'"
            ],
            env=[
                client.V1EnvVar(name="S3_ENDPOINT", value=settings.s3.endpoint),
                client.V1EnvVar(name="AWS_ACCESS_KEY_ID", value=settings.vast.access_key),
                client.V1EnvVar(name="AWS_SECRET_ACCESS_KEY", value=settings.vast.secret_key),
            ],
            volume_mounts=[client.V1VolumeMount(name="workdir", mount_path="/workdir")]
        )

        volumes = [
            client.V1Volume(name="workdir", empty_dir=client.V1EmptyDirVolumeSource(size_limit="10Gi"))
        ]
        if not mock:
            volumes.append(
                client.V1Volume(
                    name="vast-data", 
                    persistent_volume_claim=client.V1PersistentVolumeClaimVolumeSource(claim_name="vast-pvc-genomics")
                )
            )

        pod_spec = client.V1PodSpec(
            restart_policy="Never",
            init_containers=[init_download, compute_container],
            containers=[main_upload],
            volumes=volumes,
        )

        if job_settings.tolerations:
            pod_spec.tolerations = []
            for tol in job_settings.tolerations:
                pod_spec.tolerations.append(
                    client.V1Toleration(
                        key=tol.get("key"),
                        operator=tol.get("operator"),
                        value=tol.get("value"),
                        effect=tol.get("effect")
                    )
                )

        if job_settings.nodeSelector:
            pod_spec.node_selector = job_settings.nodeSelector

        job_spec = client.V1JobSpec(
            backoff_limit=0,
            active_deadline_seconds=job_settings.timeout_seconds,
            ttl_seconds_after_finished=3600,
            template=client.V1PodTemplateSpec(
                metadata=client.V1ObjectMeta(labels={"app": "genomic-engine", "job-name": job_name}),
                spec=pod_spec
            )
        )

        job = client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(name=job_name),
            spec=job_spec
        )

        try:
            self.batch_v1.create_namespaced_job(namespace=self.namespace, body=job)
            logger.info(f"Submitted K8s Job: {job_name}")
            return job_name
        except Exception as e:
            logger.error(f"Failed to submit K8s Job: {e}")
            raise e

    def get_job_status(self, job_name: str) -> Dict[str, Any]:
        try:
            job = self.batch_v1.read_namespaced_job(job_name, self.namespace)
            if job.status.succeeded:
                return {"phase": "Succeeded"}
            elif job.status.failed:
                return {"phase": "Failed"}
            else:
                return {"phase": "Running"}
        except Exception as e:
            logger.warning(f"Failed to read job status for {job_name}: {e}")
            return {"phase": "Unknown"}

    def delete_pipeline_jobs(self, label_selector: str = "app=genomic-engine") -> Dict[str, Any]:
        result: Dict[str, Any] = {"matched": 0, "deleted": 0, "failed": 0, "names": []}
        try:
            jobs = self.batch_v1.list_namespaced_job(
                namespace=self.namespace,
                label_selector=label_selector,
            )
        except Exception as e:
            logger.error(f"List jobs for delete failed: {e}")
            result["error"] = str(e)
            return result

        for job in jobs.items:
            name = job.metadata.name
            result["matched"] += 1
            result["names"].append(name)
            try:
                self.batch_v1.delete_namespaced_job(
                    name=name,
                    namespace=self.namespace,
                    body=client.V1DeleteOptions(propagation_policy="Background"),
                )
                result["deleted"] += 1
            except Exception as e:
                logger.warning(f"Delete job {name} failed: {e}")
                result["failed"] += 1
        return result

    def get_job_logs(self, job_name: str) -> List[Dict[str, str]]:
        try:
            pods = self.core_v1.list_namespaced_pod(
                self.namespace, 
                label_selector=f"job-name={job_name}"
            )
            if not pods.items:
                return [{"content": "Pod not found for job."}]
                
            pod = pods.items[0]
            pod_name = pod.metadata.name
            
            logs = []
            if pod.spec.init_containers:
                for c in pod.spec.init_containers:
                    try:
                        c_log = self.core_v1.read_namespaced_pod_log(pod_name, self.namespace, container=c.name)
                        if c_log:
                            logs.append({"content": f"--- Container: {c.name} ---"})
                            for line in c_log.splitlines():
                                logs.append({"content": line})
                    except Exception:
                        pass
                        
            if pod.spec.containers:
                for c in pod.spec.containers:
                    try:
                        c_log = self.core_v1.read_namespaced_pod_log(pod_name, self.namespace, container=c.name)
                        if c_log:
                            logs.append({"content": f"--- Container: {c.name} ---"})
                            for line in c_log.splitlines():
                                logs.append({"content": line})
                    except Exception:
                        pass

            if not logs:
                return [{"content": "No logs generated yet."}]
                
            return logs
        except Exception as e:
            return [{"content": f"Failed to fetch logs: {e}"}]