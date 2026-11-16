"""``/api/user-roles``: list, grant, change and revoke roles (the Admin page's Users tab).

Admins only (``require_role("admin")`` on the router). Emails are stored
lowercased (``normalize_email``). Two lockout guards, both a 409 with a readable
reason, so an environment can never be left without an admin:

* **Self:** an admin can't change or remove their own row - another admin must.
* **Last admin:** the only remaining ``admin`` row can't be removed or demoted.
  The ``AUTH_DISABLED`` dev user has no row, so it never counts.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.roles import normalize_email, require_role
from app.core.security import CurrentUser, principal_email
from app.schemas.user_role import UserRoleCreate, UserRoleRead, UserRoleUpdate
from app.sources.postgres.models.user_role import UserRole
from app.sources.postgres.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# Mounted under /api in main.py. require_role also checks the token (it depends on
# get_current_user), which test_auth_guard.py accepts as the router's auth.
router = APIRouter(
    prefix="/user-roles", tags=["user-roles"], dependencies=[Depends(require_role("admin"))]
)

SELF = "You can't change your own role. Ask another admin."
LAST_ADMIN = "This is the last admin; add another admin first."
GONE = "That user's role was already removed."


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def _row(session: AsyncSession, row_id: int) -> UserRole:
    row = await session.get(UserRole, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=GONE)
    return row


async def _check_guards(session: AsyncSession, row: UserRole, user: dict) -> None:
    """Refuse a change to the caller's own row or to the last admin."""
    if row.email == normalize_email(principal_email(user)):
        raise _conflict(SELF)
    if row.role == "admin":
        admins = await session.scalar(
            select(func.count()).select_from(UserRole).where(UserRole.role == "admin")
        )
        if (admins or 0) <= 1:
            raise _conflict(LAST_ADMIN)


@router.get("", response_model=list[UserRoleRead])
async def list_user_roles(session: SessionDep) -> list[UserRole]:
    result = await session.execute(select(UserRole).order_by(UserRole.email))
    return list(result.scalars())


@router.post("", response_model=UserRoleRead, status_code=status.HTTP_201_CREATED)
async def create_user_role(payload: UserRoleCreate, session: SessionDep) -> UserRole:
    email = normalize_email(payload.email)
    if "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Enter an email address."
        )
    duplicate = f"{email} already has a role."
    if await session.scalar(select(UserRole.id).where(UserRole.email == email)):
        raise _conflict(duplicate)
    row = UserRole(email=email, display_name=payload.display_name, role=payload.role)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError as exc:  # a concurrent add of the same email
        await session.rollback()
        raise _conflict(duplicate) from exc
    await session.refresh(row)
    return row


@router.patch("/{row_id}", response_model=UserRoleRead)
async def update_user_role(
    row_id: int, payload: UserRoleUpdate, session: SessionDep, user: CurrentUser
) -> UserRole:
    row = await _row(session, row_id)
    if payload.role != row.role:
        await _check_guards(session, row, user)
        row.role = payload.role
        row.updated_at = func.now()  # type: ignore[assignment]
        await session.commit()
        await session.refresh(row)
    return row


@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_role(row_id: int, session: SessionDep, user: CurrentUser) -> Response:
    row = await _row(session, row_id)
    await _check_guards(session, row, user)
    await session.delete(row)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
