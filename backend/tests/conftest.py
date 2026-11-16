from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import get_current_user
from app.sources.postgres.session import get_session
from main import app

pytest_plugins = [
    "tests.fixtures.postgres",
]


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def override_get_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    def override_get_current_user() -> dict:
        # Stand in for a validated Azure token so tests need no real credentials.
        return {"sub": "test-user", "preferred_username": "tester@example.com"}

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def unauthenticated_client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """Client with the DB overridden but auth left intact — for testing the auth guard."""

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    def override_get_settings() -> Settings:
        # Force auth ON regardless of a local AUTH_DISABLED so the guard is tested.
        return get_settings().model_copy(update={"auth_disabled": False})

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_settings] = override_get_settings
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()
