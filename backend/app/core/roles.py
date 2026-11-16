"""In-app roles: resolve the caller's role and gate endpoints by it.

**Sparse by email.** ``pace.user_roles`` (models/user_role.py) holds a row only for
people with a role; the key is the caller's email (``principal_email``), lowercased.
A signed-in caller with no row is a plain ``user``, so a missing row never locks
anyone out: roles only gate admin features.

**Never widens access, never blocks the app.** A stored value that isn't a known
role, a token without an email, and a database error all resolve to ``user`` (the
last two logged). The backend is the source of truth; the SPA's hiding is UX only.

With ``AUTH_DISABLED`` (local dev) the fixed dev user is an admin, so the whole UI
is reachable without a token; the SPA's "View as user" shows the other side.
"""

import logging
from collections.abc import Callable, Coroutine
from contextlib import suppress
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, principal_email
from app.sources.postgres.models.user_role import UserRole
from app.sources.postgres.session import get_session

logger = logging.getLogger(__name__)

ROLES = ("admin", "user")
"""Mirrors the DDL's ``ck_user_roles_role`` and the SPA's ``Role`` (lib/role.ts)."""

# Higher rank satisfies a lower requirement (an admin passes a "user" guard).
_RANK = {"user": 0, "admin": 1}

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def normalize_email(value: str | None) -> str:
    """The key the table is stored under: trimmed and lowercased."""
    return (value or "").strip().lower()


def _coerce(stored: str | None) -> str:
    """A stored value as a known role: missing -> user; unknown -> user, logged."""
    if stored is None:
        return "user"
    if stored not in ROLES:
        logger.warning("Unrecognized stored role %r; treating caller as 'user'.", stored)
        return "user"
    return stored


async def resolve_role(user: dict, session: AsyncSession, settings: Settings) -> str:
    """The caller's role, from their token's email and ``user_roles``. Never raises."""
    if settings.auth_disabled:
        return "admin"
    email = normalize_email(principal_email(user))
    if not email:
        return "user"
    try:
        result = await session.execute(select(UserRole.role).where(UserRole.email == email))
        return _coerce(result.scalar_one_or_none())
    except Exception:
        # Table missing (004_user_roles.sql not applied yet), DB down, ...: everyone is
        # a user until it's back. Roll back so the request's later queries still work.
        logger.warning("Could not read user_roles; treating caller as 'user'.", exc_info=True)
        with suppress(Exception):
            await session.rollback()
        return "user"


async def get_current_role(user: CurrentUser, session: SessionDep, settings: SettingsDep) -> str:
    """FastAPI dependency: the current caller's resolved role."""
    return await resolve_role(user, session, settings)


CurrentRole = Annotated[str, Depends(get_current_role)]


def require_role(*roles: str) -> Callable[..., Coroutine[Any, Any, str]]:
    """Dependency factory: let the caller through only if their role satisfies one of
    ``roles`` (an admin satisfies ``"user"``); otherwise 403. Use it on a router
    (``dependencies=[Depends(require_role("admin"))]``) or a single route.
    """
    needed = min(_RANK[role] for role in roles)

    async def _guard(role: CurrentRole) -> str:
        if _RANK.get(role, 0) < needed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You need the {roles[0]} role for this.",
            )
        return role

    return _guard
