import logging
import time
import urllib3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
import requests

from src.config import settings

logger = logging.getLogger(__name__)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class AuthService:
    VMS_TIMEOUT_SECONDS = 15
    VMS_RETRY_ATTEMPTS = 2

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
        last_exc = None
        for attempt in range(self.VMS_RETRY_ATTEMPTS):
            t0 = time.perf_counter()
            try:
                resp = requests.post(
                    url,
                    json={"username": username, "password": password},
                    verify=False,
                    timeout=self.VMS_TIMEOUT_SECONDS,
                )
                elapsed_ms = int((time.perf_counter() - t0) * 1000)
                if resp.status_code == 200:
                    logger.info("[AUTH] vms ok url=%s elapsed_ms=%d", url, elapsed_ms)
                    return True, resp.status_code, ""
                if resp.status_code in (401, 403):
                    return False, resp.status_code, resp.text or ""
                logger.warning(
                    "[AUTH] vms transient http=%d elapsed_ms=%d attempt=%d body=%s",
                    resp.status_code, elapsed_ms, attempt + 1, (resp.text or "")[:160],
                )
                last_exc = None
            except requests.RequestException as e:
                elapsed_ms = int((time.perf_counter() - t0) * 1000)
                logger.warning(
                    "[AUTH] vms exception url=%s elapsed_ms=%d attempt=%d err=%s",
                    url, elapsed_ms, attempt + 1, e,
                )
                last_exc = e
            time.sleep(0.5 * (attempt + 1))

        return False, None, str(last_exc) if last_exc else "VMS unreachable"

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
