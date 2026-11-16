from collections.abc import AsyncIterator

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.core.config import get_settings


@pytest_asyncio.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    # Tests run against POSTGRES_URL and roll back every change (see db_session),
    # so they never persist. In CI that URL points at a throwaway Postgres service
    # that exists only for the job (see .github/workflows/ci.yml); locally, point it at a
    # disposable dev database.
    eng = create_async_engine(get_settings().postgres_url, pool_pre_ping=True, future=True)
    try:
        yield eng
    finally:
        await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as connection:
        outer_trans = await connection.begin()
        session = AsyncSession(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        try:
            yield session
        finally:
            await session.close()
            if outer_trans.is_active:
                await outer_trans.rollback()
