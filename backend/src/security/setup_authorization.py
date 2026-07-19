from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from ipaddress import ip_address
from urllib.parse import urlparse

from core.config import Settings
from services.first_admin_provisioning import ProvisioningError


COOKIE_NAME = "operatoros_setup_authorization"
AUTHORIZATION_TTL_SECONDS = 300


def _token(configuration: Settings) -> bytes:
    token = configuration.ASTRYX_SETUP_TOKEN
    if not token:
        raise ProvisioningError("SETUP_AUTHORIZATION_UNAVAILABLE", "Initial setup authorization is unavailable.", 403)
    return token.encode()


def _local_origin(origin: str | None, configuration: Settings) -> bool:
    if not origin or origin not in configuration.cors_origins:
        return False
    parsed = urlparse(origin)
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"}


def issue_setup_authorization(*, configuration: Settings, client_host: str | None, origin: str | None, now: int | None = None) -> str:
    try:
        local_client = client_host is not None and ip_address(client_host).is_loopback
    except ValueError:
        local_client = False
    if not configuration.OPERATOROS_MANAGED_DEV_SETUP or not local_client or not _local_origin(origin, configuration):
        raise ProvisioningError("SETUP_AUTHORIZATION_UNAVAILABLE", "Initial setup authorization is unavailable.", 403)
    issued_at = int(time.time() if now is None else now)
    nonce = secrets.token_urlsafe(24)
    payload = f"{issued_at}.{nonce}"
    signature = hmac.new(_token(configuration), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def validate_setup_authorization(value: str | None, *, configuration: Settings, now: int | None = None) -> str:
    if not value:
        raise ProvisioningError("SETUP_AUTHORIZATION_REQUIRED", "Initial setup authorization is required.", 403)
    try:
        issued_text, nonce, supplied_signature = value.split(".", 2)
        issued_at = int(issued_text)
    except (TypeError, ValueError):
        raise ProvisioningError("SETUP_AUTHORIZATION_INVALID", "Initial setup authorization is invalid.", 403) from None
    current = int(time.time() if now is None else now)
    if issued_at > current + 30 or current - issued_at > AUTHORIZATION_TTL_SECONDS:
        raise ProvisioningError("SETUP_AUTHORIZATION_EXPIRED", "Initial setup authorization has expired.", 403)
    payload = f"{issued_at}.{nonce}"
    expected = hmac.new(_token(configuration), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(supplied_signature, expected):
        raise ProvisioningError("SETUP_AUTHORIZATION_INVALID", "Initial setup authorization is invalid.", 403)
    return configuration.ASTRYX_SETUP_TOKEN or ""
