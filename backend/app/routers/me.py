"""``GET /api/me``: the caller's email, display name and role, for the SPA.

The SPA hides admin-only UI from this answer; the API's own guards
(``require_role``) are what actually enforce it.
"""

from fastapi import APIRouter, Depends

from app.core.roles import CurrentRole
from app.core.security import CurrentUser, get_current_user, principal_email, principal_identity
from app.schemas.me import MeRead

# Mounted under /api in main.py.
router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=MeRead)
async def read_me(user: CurrentUser, role: CurrentRole) -> MeRead:
    _, name = principal_identity(user)
    return MeRead(email=principal_email(user), name=name, role=role)  # type: ignore[arg-type]
