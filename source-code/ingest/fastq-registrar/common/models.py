from typing import Dict
from pydantic import BaseModel


class Settings(BaseModel):
    vast_access_key: str
    vast_secret_key: str
    s3endpoint: str
    vdbendpoint: str
    vdbbucket: str
    vdbschema: str = "genomics"
    backend_url: str = "http://backend.genomics.svc.cluster.local:8000"
    jwt_secret: str = ""
    processing_mode: str = "mock"

    @classmethod
    def from_ctx_secrets(cls, secrets: Dict[str, str]) -> "Settings":
        field_names = cls.model_fields.keys()
        config = {field: secrets["genomicsecret"].get(field, cls.model_fields[field].default) for field in field_names}
        return cls(**config)
