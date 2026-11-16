"""Settings guards: AUTH_DISABLED is refused on a deployed env.

Pure settings construction — no HTTP, no database.
"""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("AUTH_DISABLED", "ENV_NAME"):
        monkeypatch.delenv(name, raising=False)


def _settings(**values: object) -> Settings:
    # _env_file=None: ignore the developer's backend/.env.
    return Settings(_env_file=None, POSTGRES_URL="postgresql+asyncpg://u@/db", **values)


def test_auth_disabled_allowed_locally() -> None:
    assert _settings(AUTH_DISABLED=True).auth_disabled is True


def test_deployed_env_with_auth_on_is_fine() -> None:
    assert _settings(ENV_NAME="pace-prod").auth_disabled is False


def test_auth_disabled_refused_on_deployed_env() -> None:
    with pytest.raises(ValidationError, match="local development only"):
        _settings(AUTH_DISABLED=True, ENV_NAME="pace-prod")


def test_auth_disabled_refused_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    # How it arrives on a host: systemd's EnvironmentFile sets ENV_NAME, a stray
    # .env (or variable) sets AUTH_DISABLED.
    monkeypatch.setenv("ENV_NAME", "pace-sbx")
    monkeypatch.setenv("AUTH_DISABLED", "true")
    with pytest.raises(ValidationError, match="ENV_NAME=pace-sbx"):
        Settings(_env_file=None, POSTGRES_URL="postgresql+asyncpg://u@/db")
