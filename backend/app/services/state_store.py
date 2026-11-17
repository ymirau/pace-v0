"""The business state, in Postgres — one document per visitor.

`app/pace/store.py` is the spike's engine and keeps the state in a JSON file. That works
on a laptop and not on a serverless host, where the filesystem is read-only and a
function can be recycled between requests — tasks would quietly disappear.

So the file becomes a cache and a row becomes the truth: load the document before a
turn, hand the same dict to the engine (which mutates it in place, exactly as before),
write it back after. One JSONB document per visitor, because the engine owns its shape
and normalising it would mean rewriting every tool.

**One row per visitor, not one row.** There used to be a single `'current'` document, so
everyone on the review link shared one world: the first person to clear an overdue task
decided what the second person was shown, and the planted problems were gone by the time
the second rating was given. Ratings across those two sessions were not comparable, and
nothing in the log said so. Each visitor now opens their own copy of the same seed, so
the app is identical for everybody at the start and nobody's save reaches anyone else.

Still last-write-wins **within** a visitor — two tabs of the same browser can clobber
each other. That is honest for one person looking at their own work and is not a
concurrency design.

`SOLO` deliberately keeps the old `'current'` key, so local dev, the terminal spike and
everything already stored carry on untouched; this is a widening, not a migration.
"""

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.visitor import SOLO
from app.pace import store
from app.sources.postgres.models.state import PaceState

logger = logging.getLogger(__name__)

#: The key the single pre-visitor document used. Kept, so no stored row has to move.
SOLO_KEY = "current"


def state_key(visitor: str) -> str:
    """The `pace_state.key` for a visitor.

    Namespaced with `v:` so a visitor id can never collide with `SOLO_KEY` (or with any
    other key this table grows later), however the client spells it.
    """
    return SOLO_KEY if visitor == SOLO else f"v:{visitor}"


async def load(db: AsyncSession, visitor: str, default_seed: str = "example") -> dict[str, Any]:
    """This visitor's state. Seeded from `default_seed` the first time they appear.

    A new visitor therefore gets a fresh world rather than a copy of someone else's
    half-finished one — the whole point of partitioning.
    """
    key = state_key(visitor)
    row = (
        await db.execute(select(PaceState.state).where(PaceState.key == key))
    ).scalar_one_or_none()
    if row:
        return dict(row)
    state = store.reset(default_seed)
    await save(db, visitor, state)
    return state


async def save(db: AsyncSession, visitor: str, state: dict[str, Any]) -> None:
    stmt = insert(PaceState).values(key=state_key(visitor), state=state)
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[PaceState.key],
            set_={"state": state, "updated_at": func.now()},
        )
    )
    await db.commit()


async def reset(db: AsyncSession, visitor: str, seed: str) -> dict[str, Any]:
    """Rebuild this visitor's state from a seed file. Touches nobody else's."""
    state = store.reset(seed)
    await save(db, visitor, state)
    return state
