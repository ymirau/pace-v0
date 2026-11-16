"""``/api/log``: the chat log, readable at any time.

v0's deliverable is evidence, not software — the transcripts and the ratings outlive the
code. This reads the Postgres copy (`sql/postgres/002_chat.sql`) so it works from any
machine and survives a redeploy, unlike the JSONL files on local disk.

Read-only by design: nothing here edits or deletes a log line. An append-only record is
only worth something if it cannot be tidied up after the fact.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.gate import require_access_code
from app.core.security import get_current_user
from app.schemas.log import Event, SessionDetail, SessionSummary, Stats
from app.sources.postgres.models.chat import ChatEvent, ChatRating, ChatSession
from app.sources.postgres.session import get_session

# Mounted under /api in main.py.
router = APIRouter(
    prefix="/log",
    tags=["log"],
    dependencies=[Depends(get_current_user), Depends(require_access_code)],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _summaries(db: AsyncSession, ids: list[str] | None = None) -> list[SessionSummary]:
    q = select(ChatSession).order_by(ChatSession.updated_at.desc())
    if ids is not None:
        q = q.where(ChatSession.id.in_(ids))
    sessions = (await db.execute(q)).scalars().all()
    if not sessions:
        return []
    keys = [s.id for s in sessions]

    counts = {
        (sid, t): n
        for sid, t, n in (
            await db.execute(
                select(ChatEvent.session_id, ChatEvent.type, func.count())
                .where(ChatEvent.session_id.in_(keys))
                .group_by(ChatEvent.session_id, ChatEvent.type)
            )
        ).all()
    }
    # avg() ignores NULLs, which is what we want: a feel-only rating has no cleanup
    # score and must not be averaged in as a zero.
    rated = {
        sid: (n, avg)
        for sid, n, avg in (
            await db.execute(
                select(ChatRating.session_id, func.count(), func.avg(ChatRating.score))
                .where(ChatRating.session_id.in_(keys))
                .group_by(ChatRating.session_id)
            )
        ).all()
    }
    by_feel = {
        (sid, feel): n
        for sid, feel, n in (
            await db.execute(
                select(ChatRating.session_id, ChatRating.feel, func.count())
                .where(ChatRating.session_id.in_(keys))
                .group_by(ChatRating.session_id, ChatRating.feel)
            )
        ).all()
    }
    out = []
    for s in sessions:
        n, avg = rated.get(s.id, (0, None))
        out.append(
            SessionSummary(
                id=s.id,
                started_at=s.started_at,
                updated_at=s.updated_at,
                model=s.model,
                prompt_version=s.prompt_version,
                seed=s.seed,
                sim_today=s.sim_today.isoformat() if s.sim_today else None,
                business=(s.founder or {}).get("business") or None,
                turns=counts.get((s.id, "assistant"), 0),
                tool_calls=counts.get((s.id, "tool_call"), 0),
                rated=n,
                magic=by_feel.get((s.id, "magic"), 0),
                annoying=by_feel.get((s.id, "annoying"), 0),
                avg_score=round(float(avg), 2) if avg is not None else None,
            )
        )
    return out


@router.get("/sessions", response_model=list[SessionSummary])
async def list_sessions(
    db: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[SessionSummary]:
    return (await _summaries(db))[:limit]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def read_session(session_id: str, db: SessionDep) -> SessionDetail:
    summaries = await _summaries(db, [session_id])
    if not summaries:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No session '{session_id}'.")
    events = (
        (
            await db.execute(
                select(ChatEvent).where(ChatEvent.session_id == session_id).order_by(ChatEvent.seq)
            )
        )
        .scalars()
        .all()
    )
    ratings = (
        (await db.execute(select(ChatRating).where(ChatRating.session_id == session_id)))
        .scalars()
        .all()
    )
    return SessionDetail(
        session=summaries[0],
        events=[
            Event(seq=e.seq, type=e.type, created_at=e.created_at, payload=e.payload or {})
            for e in events
        ],
        ratings={r.turn: {"score": r.score, "feel": r.feel, "note": r.note} for r in ratings},
    )


@router.get("/stats", response_model=Stats)
async def read_stats(db: SessionDep) -> Stats:
    """The numbers the v0 verdict needs, computed from the log rather than by hand."""
    sessions = (await db.execute(select(ChatSession))).scalars().all()
    events = (await db.execute(select(ChatEvent))).scalars().all()
    ratings = (await db.execute(select(ChatRating))).scalars().all()

    version_by_session = {s.id: s.prompt_version for s in sessions}
    assistant = [e for e in events if e.type == "assistant"]
    # A rating is a feel; the cleanup score is optional and often added later, so the
    # two are counted separately. Averaging over "every rating" would silently treat
    # a feel-only rating as a zero.
    scores = [r.score for r in ratings if r.score is not None]

    # Always all three keys, so the Log page can show "0 annoying" rather than nothing.
    feels: dict[str, int] = {"magic": 0, "meh": 0, "annoying": 0}
    for r in ratings:
        feels[r.feel] = feels.get(r.feel, 0) + 1

    proposals: dict[str, int] = {}
    for e in events:
        if e.type == "proposal":
            outcome = (e.payload or {}).get("outcome", "unknown")
            proposals[outcome] = proposals.get(outcome, 0) + 1
    # A proposal the agent made that was never resolved reads as ignored, which is a
    # real outcome: the thesis says the founder just says yes.
    made = sum(
        1
        for e in events
        if e.type == "tool_call" and (e.payload or {}).get("name") == "propose_plan"
    )
    applied = sum(
        1
        for e in events
        if e.type == "tool_call" and (e.payload or {}).get("name") == "apply_proposal"
    )
    rejected = sum(
        1
        for e in events
        if e.type == "tool_call" and (e.payload or {}).get("name") == "reject_proposal"
    )
    proposals.setdefault("proposed", made)
    proposals.setdefault("applied", applied)
    proposals.setdefault("rejected", rejected)
    proposals.setdefault("unresolved", max(made - applied - rejected, 0))

    def empty_version() -> dict:
        return {
            "turns": 0,
            "rated": 0,
            "magic": 0,
            "annoying": 0,
            "avg_score": None,
            "_sum": 0,
            "_n": 0,
        }

    by_version: dict[str, dict] = {}
    for e in assistant:
        v = version_by_session.get(e.session_id, "?")
        by_version.setdefault(v, empty_version())["turns"] += 1
    for r in ratings:
        v = version_by_session.get(r.session_id, "?")
        slot = by_version.setdefault(v, empty_version())
        slot["rated"] += 1
        if r.feel in ("magic", "annoying"):
            slot[r.feel] += 1
        if r.score is not None:
            slot["_sum"] += r.score
            slot["_n"] += 1
    for slot in by_version.values():
        slot["avg_score"] = round(slot["_sum"] / slot["_n"], 2) if slot["_n"] else None
        slot.pop("_sum")
        slot.pop("_n")

    return Stats(
        sessions=len(sessions),
        turns=len(assistant),
        proactive_turns=sum(1 for e in assistant if (e.payload or {}).get("proactive")),
        tool_calls=sum(1 for e in events if e.type == "tool_call"),
        cap_hits=sum(1 for e in assistant if (e.payload or {}).get("cap_hit")),
        rated=len(ratings),
        scored=len(scores),
        avg_score=round(sum(scores) / len(scores), 2) if scores else None,
        pct_rated_zero=(
            round(100 * sum(1 for s in scores if s == 0) / len(scores), 1) if scores else None
        ),
        feels=feels,
        proposals=proposals,
        by_prompt_version=by_version,
    )
