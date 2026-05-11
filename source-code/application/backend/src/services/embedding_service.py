import logging
import time
from typing import List

import requests

from src.config import settings
from src.services.retry import call_with_retry

NVIDIA_API_CATALOG_URL = "https://integrate.api.nvidia.com/v1"

logger = logging.getLogger(__name__)


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

        t0 = time.perf_counter()
        try:
            response = call_with_retry(
                lambda: requests.post(
                    f"{self.base_url}/embeddings",
                    json=payload,
                    headers=headers,
                    timeout=60,
                ),
                operation=f"EMBED:{input_type}",
            )
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            logger.error(
                "[EMBED] request failed elapsed_ms=%d input_type=%s n=%d err=%s",
                elapsed_ms, input_type, len(texts), e,
            )
            raise

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        if response.status_code != 200:
            logger.error(
                "[EMBED] http=%d elapsed_ms=%d input_type=%s n=%d body=%s",
                response.status_code, elapsed_ms, input_type, len(texts), response.text[:300],
            )

        response.raise_for_status()
        result = response.json()
        embeddings = [item["embedding"] for item in result["data"]]
        logger.info(
            "[EMBED] ok http=%d elapsed_ms=%d input_type=%s n=%d dims=%d",
            response.status_code, elapsed_ms, input_type, len(texts),
            len(embeddings[0]) if embeddings else 0,
        )
        return embeddings
