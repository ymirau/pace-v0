"""``/api/my-log``: the caller's own log, for the Log page inside the app.

Same reads as `/api/log`, scoped to the visitor making the request. It exists so somebody
using the app can see what they themselves said and rated — which is useful and harmless
— without being handed every other reviewer's transcript and the notes written about the
agent's replies.

So the gate here is the ordinary reviewer code, the one everybody with the link holds,
and the **scope is taken from the request, never from a parameter.** There is deliberately
no `?visitor=` : a caller cannot ask for someone else's log, because there is nothing to
ask with. Guessing an 8-character session id doesn't help either — `log_read.detail`
applies the same filter, so a session that isn't yours is reported as missing.

A visitor id is not a credential (`app/core/visitor.py`): anyone can edit theirs in
devtools and read the log of a browser whose id they know. That is acceptable here and
would not be for anything that mattered. The protection that counts is `PACE_VIEWER_CODE`
on `/api/log`, which no amount of header-editing gets past.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.gate import require_access_code
from app.core.security import get_current_user
from app.core.visitor import Visitor
from app.schemas.log import SessionDetail, SessionSummary, Stats
from app.services import log_read
from app.sources.postgres.session import get_session

# Mounted under /api in main.py.
router = APIRouter(
    prefix="/my-log",
    tags=["log"],
    dependencies=[Depends(get_current_user), Depends(require_access_code)],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/sessions", response_model=list[SessionSummary])
async def list_sessions(
    db: SessionDep, visitor: Visitor, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[SessionSummary]:
    return (await log_read.summaries(db, visitor=visitor))[:limit]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def read_session(session_id: str, db: SessionDep, visitor: Visitor) -> SessionDetail:
    found = await log_read.detail(db, session_id, visitor=visitor)
    if not found:
        # Deliberately the same 404 as a session that does not exist: "yours" and
        # "exists" must not be distinguishable from the outside.
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No session '{session_id}'.")
    return found


@router.get("/stats", response_model=Stats)
async def read_stats(db: SessionDep, visitor: Visitor) -> Stats:
    return await log_read.stats(db, visitor=visitor)
