"""``GET /api/me``: the caller's email and display name, for the SPA's header.

Roles were removed with the template's admin module — Pace is one founder looking at
their own business, so there is nobody to be an admin over.
"""

from fastapi import APIRouter, Depends

from app.core.security import CurrentUser, get_current_user, principal_email, principal_identity
from app.schemas.me import MeRead

# Mounted under /api in main.py.
router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=MeRead)
async def read_me(user: CurrentUser) -> MeRead:
    _, name = principal_identity(user)
    return MeRead(email=principal_email(user), name=name)
