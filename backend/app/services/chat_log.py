"""Durable chat log, in Postgres.

The spike's rule is that logging is the product: the code gets deleted, the evidence
doesn't. A serverless host has no durable disk, so Postgres is the copy that survives —
the JSONL files stay as a local mirror.

Two things live here:

* **The log** — one `chat_events` row per transcript line, plus ratings in their own
  table so a turn can be re-rated and the close-out stats can query them.
* **The conversation** — `chat_sessions.messages` holds the Messages API history, so a
  request that lands on a cold process can rebuild the agent instead of losing the
  thread. That is what makes the chat survive on Vercel.

The **events and ratings are global** — they are the deliverable, read across every
visitor by the viewer at `/viewer`. Only `chat_sessions` (and the state document) are
partitioned, so one reviewer's world cannot leak into another's while the evidence from
all of them still accumulates in one place.

Every write is best-effort: if the database is unreachable the chat must still work, so
failures are logged and swallowed. A lost log line is bad; a chat that 500s because the
log was down is worse.
"""

import logging
from datetime import date
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.sources.postgres.models.chat import ChatEvent, ChatRating, ChatSession

logger = logging.getLogger(__name__)


async def ensure_session(
    session: AsyncSession,
    *,
    id: str,
    model: str,
    prompt_version: str,
    seed: str,
    visitor: str,
    sim_today: str | None,
    founder: dict[str, Any],
) -> None:
    # sim_today arrives as the store's ISO string; the column is a DATE.
    sim = date.fromisoformat(sim_today) if sim_today else None
    stmt = insert(ChatSession).values(
        id=id,
        model=model,
        prompt_version=prompt_version,
        seed=seed,
        visitor=visitor,
        sim_today=sim,
        founder=founder,
        messages=[],
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[ChatSession.id],
            set_={"founder": founder, "sim_today": sim, "updated_at": func.now()},
        )
    )
    await session.commit()


async def save_messages(session: AsyncSession, session_id: str, messages: list[Any]) -> None:
    await session.execute(
        ChatSession.__table__.update()
        .where(ChatSession.id == session_id)
        .values(messages=messages, updated_at=func.now())
    )
    await session.commit()


async def load_messages(session: AsyncSession, session_id: str) -> list[Any] | None:
    row = await session.get(ChatSession, session_id)
    return list(row.messages) if row else None


async def latest_session_id(session: AsyncSession, seed: str, visitor: str) -> str | None:
    """The most recently touched session for this seed AND this visitor.

    `visitor` is not optional on purpose. Without it this returned the newest session
    across everybody, so a second person on the review link was dropped into the first
    person's conversation mid-thread — they saw replies to questions they had not asked,
    and their rating of "turn 6" landed on somebody else's turn 6.
    """
    return (
        await session.execute(
            select(ChatSession.id)
            .where(ChatSession.seed == seed, ChatSession.visitor == visitor)
            .order_by(ChatSession.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def add_events(session: AsyncSession, session_id: str, lines: list[dict[str, Any]]) -> None:
    """Append transcript lines. `seq` continues from whatever is already stored."""
    if not lines:
        return
    start = (
        await session.execute(
            select(func.coalesce(func.max(ChatEvent.seq), -1)).where(
                ChatEvent.session_id == session_id
            )
        )
    ).scalar_one() + 1
    session.add_all(
        [
            ChatEvent(
                session_id=session_id,
                seq=start + i,
                type=line.get("type", "unknown"),
                payload={k: v for k, v in line.items() if k != "type"},
            )
            for i, line in enumerate(lines)
        ]
    )
    await session.commit()


async def rate(
    session: AsyncSession, session_id: str, turn: int, score: int | None, feel: str, note: str
) -> None:
    """Rate a turn. Re-rating the same turn replaces the old row rather than stacking.

    `score` may be None: `feel` alone is a complete rating (see 004_rating_feel_only.sql).
    """
    stmt = insert(ChatRating).values(
        session_id=session_id, turn=turn, score=score, feel=feel, note=note
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[ChatRating.session_id, ChatRating.turn],
            set_={"score": score, "feel": feel, "note": note, "created_at": func.now()},
        )
    )
    await session.commit()


async def clear_session(session: AsyncSession, session_id: str) -> None:
    await session.execute(delete(ChatSession).where(ChatSession.id == session_id))
    await session.commit()
