import logging
import time
import urllib3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
import requests

from src.config import settings
from src.services.retry import call_with_retry

logger = logging.getLogger(__name__)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class AuthService:
    VMS_TIMEOUT_SECONDS = 15

    def __init__(self) -> None:
        self.vms_host = settings.auth.vms_host
        if self.vms_host and not self.vms_host.startswith(("http://", "https://")):
            self.vms_host = f"https://{self.vms_host}"

        self.tenant_name = settings.auth.tenant_name or "default"
        self.jwt_secret = settings.auth.jwt_secret
        if not self.jwt_secret:
            raise RuntimeError("auth.jwt_secret is not configured -- refusing to start")

    def authenticate_user(self, username: str, password: str) -> Optional[str]:
        if not self.vms_host:
            logger.warning("[AUTH] vms_host not configured -- bypassing authentication for %s", username)
            return self._create_jwt(username, {})

        candidate_urls = []
        if self.tenant_name:
            candidate_urls.append(f"{self.vms_host}/api/token/{self.tenant_name}/")
        candidate_urls.append(f"{self.vms_host}/api/token/")

        last_status = None
        last_body = ""
        for url in candidate_urls:
            ok, status, body = self._post_token(url, username, password)
            last_status, last_body = status, body
            if ok:
                logger.info("[AUTH] login ok user=%s url=%s", username, url)
                return self._create_jwt(username, {"role": "user"})
            logger.info(
                "[AUTH] login attempt failed user=%s url=%s status=%s body=%s",
                username, url, status, body[:160],
            )

        logger.warning(
            "[AUTH] login failed user=%s status=%s body=%s",
            username, last_status, last_body[:200],
        )
        return None

    def _post_token(self, url: str, username: str, password: str) -> (bool, Optional[int], str):
        t0 = time.perf_counter()
        try:
            resp = call_with_retry(
                lambda: requests.post(
                    url,
                    json={"username": username, "password": password},
                    verify=False,
                    timeout=self.VMS_TIMEOUT_SECONDS,
                ),
                operation=f"AUTH:vms_token:{url}",
            )
        except requests.RequestException as e:
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            logger.warning(
                "[AUTH] vms exception url=%s elapsed_ms=%d err=%s",
                url, elapsed_ms, e,
            )
            return False, None, str(e)

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        if resp.status_code == 200:
            logger.info("[AUTH] vms ok url=%s elapsed_ms=%d", url, elapsed_ms)
            return True, resp.status_code, ""
        if resp.status_code in (401, 403):
            return False, resp.status_code, resp.text or ""
        logger.warning(
            "[AUTH] vms non-retryable http=%d elapsed_ms=%d body=%s",
            resp.status_code, elapsed_ms, (resp.text or "")[:160],
        )
        return False, resp.status_code, resp.text or ""

    def _create_jwt(self, username: str, extra_claims: Optional[Dict[str, Any]] = None) -> str:
        now = datetime.now(timezone.utc)
        payload: Dict[str, Any] = {
            "sub": username,
            "exp": now + timedelta(days=1),
            "iat": now,
        }
        if extra_claims:
            payload.update(extra_claims)
        return jwt.encode(payload, self.jwt_secret, algorithm="HS256")
