"""Async SQL Server engine — an optional read/write source.

Deliberately **lazy**: the engine is built on the first
`get_sqlserver_session()` call rather than in the app lifespan, so the app still
boots when SQL Server is unconfigured or unreachable (the SQL Server-backed endpoints
just return 503/502 — see `routers/reports.py`). The lifespan only disposes it.

The laziness also covers the driver. `pyodbc` (under `aioodbc` and SQLAlchemy's
`mssql+aioodbc` dialect) needs unixODBC's `libodbc.so` just to be imported, and
Microsoft's ODBC Driver 18 to connect. Nothing here imports it at module level, so
CI and machines without the driver can import, lint and test the app.

Writes: the session never commits on its own. Call `await session.commit()` after
an insert/update/delete; an exception before that rolls the transaction back.
"""

from collections.abc import AsyncIterator

from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


class SqlServerNotConfiguredError(RuntimeError):
    """Raised when a SQL Server endpoint is called but SQLSERVER_HOST is unset."""


class SqlServerDriverUnavailableError(RuntimeError):
    """Raised when pyodbc can't be imported or the ODBC driver isn't registered."""


def _check_driver(driver: str) -> None:
    try:
        import pyodbc
    except ImportError as exc:  # usually a missing libodbc.so (unixODBC)
        raise SqlServerDriverUnavailableError(
            f"pyodbc could not be imported ({exc}); install unixODBC and {driver}."
        ) from exc
    if driver not in pyodbc.drivers():
        raise SqlServerDriverUnavailableError(
            f"ODBC driver '{driver}' is not installed (see `odbcinst -q -d`)."
        )


def init_engine() -> AsyncEngine:
    """Build the shared engine on first use. Raises SqlServerNotConfiguredError or
    SqlServerDriverUnavailableError so callers can surface a clean 503."""
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        if not settings.sqlserver_host:
            raise SqlServerNotConfiguredError(
                "SQL Server is not configured (SQLSERVER_HOST unset)."
            )
        _check_driver(settings.sqlserver_driver)

        url = URL.create(
            "mssql+aioodbc",
            username=settings.sqlserver_user or None,
            password=settings.sqlserver_password or None,
            host=settings.sqlserver_host,
            port=settings.sqlserver_port,
            database=settings.sqlserver_database or None,
            query={
                "driver": settings.sqlserver_driver,
                "Encrypt": settings.sqlserver_encrypt,
                "TrustServerCertificate": settings.sqlserver_trust_server_certificate,
            },
        )
        query_timeout = settings.sqlserver_query_timeout

        async def _set_query_timeout(conn) -> None:  # conn is the raw pyodbc connection
            conn.timeout = query_timeout

        _engine = create_async_engine(
            url,
            pool_pre_ping=True,
            # `timeout` is pyodbc's login timeout; `after_created` gets the raw pyodbc
            # connection, whose `timeout` bounds every query on it.
            connect_args={
                "timeout": settings.sqlserver_login_timeout,
                "after_created": _set_query_timeout,
            },
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _engine


async def dispose_engine() -> None:
    """Close the engine if it was created (called from the app lifespan)."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None


async def get_sqlserver_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: a session on the SQL Server engine, built on first use."""
    init_engine()
    assert _session_factory is not None
    async with _session_factory() as session:
        yield session
