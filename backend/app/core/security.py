"""Azure AD / Entra ID access-token validation.

Validates the bearer JWT a request carries: signature (against Entra's published
JWKS), issuer, and audience. Any authenticated caller gets full access — there is
no role check yet — but the verified claims are returned so callers can record who
acted. Read them through ``principal_identity`` (who acted, for audit columns) and
``principal_email`` (where to send mail), not by picking claims directly.

Set ``AUTH_DISABLED=true`` to skip validation for LOCAL DEVELOPMENT ONLY.
"""

import logging
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

# auto_error=False so the bypass can return a dev user even with no header.
_bearer = HTTPBearer(auto_error=False)

_DEV_USER = {"sub": "dev-user", "preferred_username": "dev@local"}

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


@lru_cache
def _jwks_client(jwks_uri: str) -> jwt.PyJWKClient:
    # PyJWKClient caches signing keys in-process and refreshes on unknown `kid`.
    return jwt.PyJWKClient(jwks_uri)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    if settings.auth_disabled:
        logger.warning("AUTH_DISABLED is set — skipping token validation (dev only).")
        return _DEV_USER

    if credentials is None:
        raise _UNAUTHENTICATED

    token = credentials.credentials
    try:
        signing_key = _jwks_client(settings.azure_jwks_uri).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.azure_api_audience,
            issuer=settings.azure_issuer,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return claims


CurrentUser = Annotated[dict, Depends(get_current_user)]


def principal_identity(user: dict) -> tuple[str, str]:
    """Reduce validated token claims to the ``(object_id, display_name)`` pair
    an audit column stores (e.g. ``created_by_id`` / ``created_by_name``).

    Entra puts the object id in ``oid`` on a v2 access token and mirrors it in
    ``sub`` only for single-tenant apps, so prefer ``oid`` and fall back. The
    display name is ``name`` when the profile scope was granted, otherwise the
    UPN. Routers call this instead of reading claims directly, so the fallback
    order is defined once.
    """
    user_id = user.get("oid") or user.get("sub") or ""
    display_name = user.get("name") or user.get("preferred_username") or user_id
    return user_id, display_name


def principal_email(user: dict) -> str | None:
    """The caller's email address, for notification emails.

    The ``email`` claim when the token carries one, else ``preferred_username``
    — the UPN, which at Synveon is the mail address. ``None`` when neither looks like
    an address, so a token without one simply means no email rather than a
    message sent to a GUID.
    """
    for claim in ("email", "preferred_username"):
        value = user.get(claim)
        if isinstance(value, str) and "@" in value:
            return value
    return None
