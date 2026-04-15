from typing import Dict
from pydantic import BaseModel


class Settings(BaseModel):
    use_api_catalog: bool = False
    nvidia_api_key: str = ""

    embeddinghost: str = ""
    embeddingport: str = "8080"
    embeddinghttpscheme: str = "http"
    embeddingmodel: str
    embeddingdimensions: int = 2048

    vast_access_key: str
    vast_secret_key: str
    vdbendpoint: str
    vdbbucket: str
    vdbschema: str = "genomics"

    @classmethod
    def from_ctx_secrets(cls, secrets: Dict[str, str]) -> "Settings":
        secret_data = secrets["genomicsecret"]
        config = {
            field: secret_data[field]
            for field in cls.model_fields
            if field in secret_data
        }
        return cls(**config)
