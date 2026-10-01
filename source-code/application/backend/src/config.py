from pathlib import Path

import yaml
from pydantic import BaseModel

SECRET_PATH = Path("/etc/secrets/config.yaml")


class VastCredentials(BaseModel):
    access_key: str = ""
    secret_key: str = ""

class AuthSettings(BaseModel):
    vms_host: str = ""
    tenant_name: str = "default"
    jwt_secret: str = ""


class VastDBSettings(BaseModel):
    endpoint: str = "http://localhost:9090"
    bucket: str = "genomics-data"
    schema_name: str = "genomics"


class S3Settings(BaseModel):
    endpoint: str = "http://localhost:9000"
    raw_bucket: str = "genomics-raw-data"
    fastq_bucket: str = "genomics-fastq-files"
    vcf_bucket: str = "genomics-vcf-outputs"


class NvidiaSettings(BaseModel):
    use_api_catalog: bool = False
    api_key: str = ""


class BioNeMoSettings(BaseModel):
    molmim_url: str = "https://health.api.nvidia.com/v1/biology/nvidia/molmim/generate"
    diffdock_url: str = "https://health.api.nvidia.com/v1/biology/mit/diffdock"


class EmbeddingSettings(BaseModel):
    host: str = "localhost"
    port: str = "8080"
    model: str
    dimensions: int = 2048


class LLMSettings(BaseModel):
    host: str = "localhost"
    port: str = "8081"
    model: str
    system_prompt: str = ""
    disable_reasoning: bool = True


class JobResources(BaseModel):
    requests: dict = {"cpu": "1", "memory": "2Gi"}
    limits: dict = {"cpu": "2", "memory": "4Gi"}

class JobConfig(BaseModel):
    image: str = "nvcr.io/nvidia/clara/clara-parabricks:4.7.0-1"
    timeout_seconds: int = 3600
    resources: JobResources = JobResources()
    nodeSelector: dict = {}
    tolerations: list = []

class JobsSettings(BaseModel):
    gpu: JobConfig = JobConfig()
    mock: JobConfig = JobConfig()

class Settings(BaseModel):
    vast: VastCredentials
    auth: AuthSettings
    vdb: VastDBSettings
    s3: S3Settings
    nvidia: NvidiaSettings
    bionemo: BioNeMoSettings = BioNeMoSettings()
    embedding: EmbeddingSettings
    llm: LLMSettings
    job: JobsSettings
    processing_mode: str = "mock"
    network: str = ""


def load_settings() -> Settings:
    if SECRET_PATH.exists():
        raw = yaml.safe_load(SECRET_PATH.read_text())
        return Settings(**raw)
    return Settings()


settings = load_settings()
