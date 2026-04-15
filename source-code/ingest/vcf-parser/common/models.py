from typing import Dict
from pydantic import BaseModel


class Settings(BaseModel):
    vast_access_key: str
    vast_secret_key: str
    s3endpoint: str
    vdbendpoint: str
    vdbbucket: str
    vdbschema: str
    nvidia_api_key: str = ""
    use_api_catalog: bool = True
    llm_model: str
    llmhost: str = ""
    llmport: str = "8000"
    llmhttpscheme: str = "http"

    @classmethod
    def from_ctx_secrets(cls, secrets: Dict[str, str]) -> "Settings":
        secret_data = secrets["genomicsecret"]
        config = {
            field: secret_data[field]
            for field in cls.model_fields
            if field in secret_data
        }
        return cls(**config)
