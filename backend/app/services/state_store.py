"""The business state, in Postgres.

`app/pace/store.py` is the spike's engine and keeps the state in a JSON file. That works
on a laptop and not on a serverless host, where the filesystem is read-only and a
function can be recycled between requests — tasks would quietly disappear.

So the file becomes a cache and this row becomes the truth: load the document before a
turn, hand the same dict to the engine (which mutates it in place, exactly as before),
write it back after. One JSONB document, because the engine owns its shape and
normalising it would mean rewriting every tool.

Last write wins. Fine for one founder; not a multi-user design.
"""

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.pace import store
from app.sources.postgres.models.state import PaceState

logger = logging.getLogger(__name__)

KEY = "current"


async def load(db: AsyncSession, default_seed: str = "example") -> dict[str, Any]:
    """The live state. Seeds it on first run so a fresh deployment isn't empty."""
    row = (
        await db.execute(select(PaceState.state).where(PaceState.key == KEY))
    ).scalar_one_or_none()
    if row:
        return dict(row)
    state = store.reset(default_seed)
    await save(db, state)
    return state


async def save(db: AsyncSession, state: dict[str, Any]) -> None:
    stmt = insert(PaceState).values(key=KEY, state=state)
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[PaceState.key],
            set_={"state": state, "updated_at": func.now()},
        )
    )
    await db.commit()


async def reset(db: AsyncSession, seed: str) -> dict[str, Any]:
    """Rebuild from a seed file and make that the stored state."""
    state = store.reset(seed)
    await save(db, state)
    return state
