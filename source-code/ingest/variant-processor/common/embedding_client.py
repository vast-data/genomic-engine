import logging
from typing import List

import requests

NVIDIA_API_CATALOG_URL = "https://integrate.api.nvidia.com/v1"


class EmbeddingClient:
    def __init__(self, settings):
        self.model = settings.embeddingmodel
        self.dimensions = settings.embeddingdimensions
        self.use_api_catalog = settings.use_api_catalog
        self.api_key = settings.nvidia_api_key

        if self.use_api_catalog:
            self.base_url = NVIDIA_API_CATALOG_URL
        else:
            self.base_url = f"{settings.embeddinghttpscheme}://{settings.embeddinghost}:{settings.embeddingport}/v1"

    def get_embeddings(self, texts: List[str], input_type: str = "passage") -> List[List[float]]:
        headers = {"Content-Type": "application/json"}
        if self.use_api_catalog:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "input": texts,
            "input_type": input_type,
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
