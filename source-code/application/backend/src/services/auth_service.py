import requests
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import jwt

from src.config import settings

logger = logging.getLogger(__name__)

class AuthService:
    def __init__(self):
        self.vms_host = settings.auth.vms_host
        if self.vms_host and not self.vms_host.startswith(("http://", "https://")):
            self.vms_host = f"https://{self.vms_host}"
            
        self.tenant_name = settings.auth.tenant_name
        self.jwt_secret = settings.auth.jwt_secret

    def authenticate_user(self, username: str, password: str) -> Optional[str]:
        """
        Attempts to log into VMS with the provided username and password.
        If successful, returns a signed JWT.
        """
        if not self.vms_host:
            logger.warning("VMS Host is not configured, bypassing authentication.")
            return self._create_jwt(username, {})
            
        try:
            # First try direct password login. For tenant users, appending the tenant name to the URL path 
            # (e.g. /api/token/default/) allows them to log in without needing complex payloads.
            login_url = f"{self.vms_host}/api/token/{self.tenant_name}/"
            login_response = requests.post(
                login_url,
                json={"username": username, "password": password},
                verify=False,
                timeout=10
            )
            
            # If it's the default tenant and we failed, fallback to /api/token/
            if login_response.status_code != 200 and self.tenant_name.lower() == "default":
                logger.info(f"Failed login on {login_url} ({login_response.status_code}), attempting fallback to /api/token/ for default tenant")
                login_response = requests.post(
                    f"{self.vms_host}/api/token/",
                    json={"username": username, "password": password},
                    verify=False,
                    timeout=10
                )
            
            if login_response.status_code == 200:
                logger.info(f"Successfully authenticated {username} via VMS password")
                return self._create_jwt(username, {"role": "user"})
            
            logger.warning(f"Failed VMS password login for {username}: {login_response.status_code} - {login_response.text}")
            return None
            
        except Exception as e:
            logger.error(f"Error communicating with VMS: {e}")
            return None

    def _create_jwt(self, username: str, extra_claims: Dict[str, Any] = None) -> str:
        payload = {
            "sub": username,
            "exp": datetime.utcnow() + timedelta(days=1),
            "iat": datetime.utcnow(),
        }
        if extra_claims:
            payload.update(extra_claims)
            
        return jwt.encode(payload, self.jwt_secret, algorithm="HS256")
