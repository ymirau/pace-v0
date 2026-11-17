"""``/api/log``: the whole chat log, across every visitor.

v0's deliverable is evidence, not software — the transcripts and the ratings outlive the
code. This reads the Postgres copy (`sql/postgres/002_chat.sql`) so it works from any
machine and survives a redeploy, unlike the JSONL files on local disk.

**This is the unscoped view**, served to the standalone viewer at `/viewer`, behind
`PACE_VIEWER_CODE`. Business state is partitioned per browser (`app/core/visitor.py`) so
reviewers don't rewrite each other's world, but the evidence is not: sessions carry a
`visitor` so two reviewers can be told apart, and the stats aggregate the lot.

A reviewer who wants to see what *they* rated uses `/api/my-log` instead, which is the
same reads scoped to their own sessions. Both go through `services/log_read.py`.

Read-only by design: nothing here edits or deletes a log line.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.gate import require_viewer_code
from app.core.security import get_current_user
from app.schemas.log import SessionDetail, SessionSummary, Stats
from app.services import log_read
from app.sources.postgres.session import get_session

# Mounted under /api in main.py.
router = APIRouter(
    prefix="/log",
    tags=["log"],
    # The VIEWER code, not the reviewer's. This view spans every visitor, so the code
    # that buys a conversation must not also read everyone else's.
    dependencies=[Depends(get_current_user), Depends(require_viewer_code)],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/sessions", response_model=list[SessionSummary])
async def list_sessions(
    db: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[SessionSummary]:
    return (await log_read.summaries(db))[:limit]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def read_session(session_id: str, db: SessionDep) -> SessionDetail:
    found = await log_read.detail(db, session_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No session '{session_id}'.")
    return found


@router.get("/stats", response_model=Stats)
async def read_stats(db: SessionDep) -> Stats:
    return await log_read.stats(db)
