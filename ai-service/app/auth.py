"""Bearer-token gate for the HF Space public URL."""
import hmac
from typing import Optional

from app.config import AI_SERVICE_AUTH_TOKEN


def check_bearer_token(header_value: Optional[str]) -> bool:
    """Constant-time compare of an Authorization header against the configured token.

    If no token is configured, all requests pass (local dev mode).
    """
    if not AI_SERVICE_AUTH_TOKEN:
        return True
    if not header_value or not header_value.startswith("Bearer "):
        return False
    presented = header_value[len("Bearer "):]
    return hmac.compare_digest(presented.encode(), AI_SERVICE_AUTH_TOKEN.encode())
