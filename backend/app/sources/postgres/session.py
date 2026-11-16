from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_engine() -> AsyncEngine:
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(settings.postgres_url, pool_pre_ping=True, future=True)
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _engine


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None


async def get_session() -> AsyncIterator[AsyncSession]:
    assert _session_factory is not None, "Engine not initialized — did lifespan run?"
    async with _session_factory() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """A session not tied to the request's dependency teardown.

    FastAPI closes a `Depends(get_session)` session before a streaming response has
    finished sending, so a handler that keeps working while it streams (see
    `app/routers/chat.py`) has to own its session.
    """
    assert _session_factory is not None, "Engine not initialized — did lifespan run?"
    async with _session_factory() as session:
        yield session
