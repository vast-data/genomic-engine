import logging
from typing import List

import requests

from src.config import settings

NVIDIA_API_CATALOG_URL = "https://integrate.api.nvidia.com/v1"


class EmbeddingService:
    def __init__(self):
        cfg = settings.embedding
        nv = settings.nvidia
        self.model = cfg.model
        self.use_api_catalog = nv.use_api_catalog
        self.api_key = nv.api_key

        if self.use_api_catalog:
            self.base_url = NVIDIA_API_CATALOG_URL
        else:
            self.base_url = f"http://{cfg.host}:{cfg.port}/v1"

    def embed_query(self, text: str) -> List[float]:
        return self.get_embeddings([text], input_type="query")[0]

    def get_embeddings(self, texts: List[str], input_type: str = "query") -> List[List[float]]:
        headers = {"Content-Type": "application/json"}
        if self.use_api_catalog:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "input": texts,
            "input_type": input_type,
            "encoding_format": "float",
        }

        response = requests.post(
            f"{self.base_url}/embeddings",
            json=payload,
            headers=headers,
            timeout=60,
        )

        if response.status_code != 200:
            logging.error(f"Embedding API error {response.status_code}: {response.text}")

        response.raise_for_status()
        result = response.json()
        return [item["embedding"] for item in result["data"]]
