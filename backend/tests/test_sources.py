"""Tests for the optional sources' status endpoint (the Home page).

Settings are overridden rather than read from the environment, so a local
backend/.env doesn't change the outcome. Auth is covered by test_auth_guard.py.
Each optional source is one line in the two tables below, so /syn-init-webapp's
remove-sources.sh can drop a source by deleting its lines.
"""

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.core.config import Settings, get_settings
from main import app

# The settings that make each source count as configured.
_CONFIGURED_BY: dict[str, dict[str, str]] = {
    "sqlserver": {"sqlserver_host": "sql.example", "sqlserver_database": "res"},
}

_NOTHING_SET: dict[str, str] = {
    "sqlserver_host": "",
}


@pytest.fixture
def use_settings() -> Iterator[Callable[..., None]]:
    def _use(**values: object) -> None:
        settings = get_settings().model_copy(update={**_NOTHING_SET, **values})
        app.dependency_overrides[get_settings] = lambda: settings

    yield _use
    app.dependency_overrides.pop(get_settings, None)


async def test_nothing_configured(client: AsyncClient, use_settings: Callable[..., None]) -> None:
    use_settings()
    response = await client.get("/api/sources/status")
    assert response.status_code == 200
    assert response.json() == [{"key": key, "configured": False} for key in _CONFIGURED_BY]


@pytest.mark.parametrize("key", list(_CONFIGURED_BY))
async def test_reports_a_configured_source(
    client: AsyncClient, use_settings: Callable[..., None], key: str
) -> None:
    use_settings(**_CONFIGURED_BY[key])
    response = await client.get("/api/sources/status")
    assert {s["key"]: s["configured"] for s in response.json()} == {
        other: other == key for other in _CONFIGURED_BY
    }
    # Only booleans come back, never a setting's value.
    for value in _CONFIGURED_BY[key].values():
        assert value not in response.text


async def test_env_example_blanks_mean_not_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # backend/.env.example ships each kept source's settings uncommented but blank;
    # loading it as-is must work and count every source as not configured.
    # Exported shell variables would beat the file, so clear them for this test.
    for field in Settings.model_fields.values():
        if field.alias:
            monkeypatch.delenv(field.alias, raising=False)
    env_example = Path(__file__).resolve().parents[1] / ".env.example"
    settings = Settings(_env_file=env_example)  # type: ignore[call-arg]
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        response = await client.get("/api/sources/status")
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert response.json() == [{"key": key, "configured": False} for key in _CONFIGURED_BY]
