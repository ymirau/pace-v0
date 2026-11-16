"""Tests for the SQL Server-backed reports endpoint.

No SQL Server (and possibly no ODBC driver) is available in CI, so these cover the
503/502 mapping and use a stand-in session for the success case. Settings are
patched rather than read from the environment, so a local backend/.env that points
at a real SQL Server doesn't change the outcome. Auth is covered for every route by
test_auth_guard.py.
"""

import datetime
import sys
from collections.abc import AsyncIterator, Iterator
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.routers.reports import sqlserver_session
from app.sources.sqlserver import session as sqlserver
from main import app


@pytest.fixture(autouse=True)
def _no_cached_engine() -> Iterator[None]:
    # The engine is a lazy module-level singleton; start and end each test without one.
    sqlserver._engine = None
    sqlserver._session_factory = None
    yield
    sqlserver._engine = None
    sqlserver._session_factory = None


def _use_settings(monkeypatch: pytest.MonkeyPatch, **values: object) -> None:
    settings = get_settings().model_copy(update=values)
    monkeypatch.setattr(sqlserver, "get_settings", lambda: settings)


def _override_session(session: object) -> None:
    async def fake_session() -> AsyncIterator[object]:
        yield session

    app.dependency_overrides[sqlserver_session] = fake_session


async def test_server_info_503_when_unconfigured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_settings(monkeypatch, sqlserver_host="")
    response = await client.get("/api/reports/server-info")
    assert response.status_code == 503
    assert "SQLSERVER_HOST" in response.json()["detail"]


async def test_server_info_503_when_driver_missing(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_settings(monkeypatch, sqlserver_host="sql.example", sqlserver_database="db")
    # A None entry makes `import pyodbc` raise ImportError, as a missing libodbc.so does.
    monkeypatch.setitem(sys.modules, "pyodbc", None)
    response = await client.get("/api/reports/server-info")
    assert response.status_code == 503
    assert "pyodbc could not be imported" in response.json()["detail"]


async def test_server_info_502_when_query_fails(client: AsyncClient) -> None:
    session = MagicMock()
    session.execute = AsyncMock(side_effect=RuntimeError("Login timeout expired"))
    _override_session(session)
    response = await client.get("/api/reports/server-info")
    assert response.status_code == 502
    assert "Login timeout expired" in response.json()["detail"]


async def test_server_info_returns_the_row(client: AsyncClient) -> None:
    row = {
        "version": "Microsoft SQL Server 2022 (RTM) - 16.0.1000.6",
        "database_name": "res",
        "server_time": datetime.datetime(2026, 10, 28, 9, 30, 0),
    }
    result = MagicMock()
    result.mappings.return_value.one.return_value = row
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    _override_session(session)

    response = await client.get("/api/reports/server-info")
    assert response.status_code == 200
    assert response.json() == {
        "version": row["version"],
        "database_name": "res",
        "server_time": "2026-10-28T09:30:00",
    }


async def test_status_needs_a_database_too(client: AsyncClient) -> None:
    # The Home page's status check: a host alone isn't enough for SQL Server.
    settings = get_settings().model_copy(
        update={"sqlserver_host": "sql.example", "sqlserver_database": ""}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    response = await client.get("/api/sources/status")
    assert {s["key"]: s["configured"] for s in response.json()}["sqlserver"] is False
