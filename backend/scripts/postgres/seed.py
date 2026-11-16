"""Seed the pace.items table with a couple of example rows.

Idempotent: skips insertion if any items already exist.

Run with:  uv run python -m scripts.postgres.seed

An app with nothing to seed can delete this file: /syn-init-local-postgres-db and
the deploy guide's verify step skip the seed when it's missing.
"""

import asyncio
import datetime
from decimal import Decimal

from sqlalchemy import func, select

from app.sources.postgres.models.item import Item
from app.sources.postgres.session import dispose_engine, get_session, init_engine

SEED_ITEMS = [
    {
        "name": "Example item",
        "description": "Seeded so the list isn't empty on first run.",
        "category": "widgets",
        "amount": Decimal("19.99"),
        "date": datetime.date(2024, 1, 15),
    },
    {
        "name": "Another item",
        "description": None,
        "category": "gadgets",
        "amount": Decimal("4.50"),
        "date": datetime.date(2024, 3, 2),
    },
    {
        "name": "Third item",
        "description": "Same category as the first, to make grouping/aggregation interesting.",
        "category": "widgets",
        "amount": Decimal("125.00"),
        "date": datetime.date(2024, 6, 20),
    },
]


async def main() -> None:
    init_engine()
    try:
        async for session in get_session():
            existing = await session.scalar(select(func.count()).select_from(Item))
            if existing:
                print(f"Items already present ({existing}); skipping seed.")
                return
            session.add_all([Item(**i) for i in SEED_ITEMS])
            await session.commit()
            print(f"Seeded {len(SEED_ITEMS)} items.")
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
