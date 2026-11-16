"""Report endpoints backed by SQL Server.

SQL Server is optional: with no SQLSERVER_HOST configured, or no ODBC driver on the
machine, these endpoints return 503 and the rest of the app is unaffected.
Connection/query failures and timeouts map to 502 so a flaky upstream never
surfaces as a 500.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.schemas.reports import ServerInfo
from app.services.reports import get_server_info
from app.sources.sqlserver.session import (
    SqlServerDriverUnavailableError,
    SqlServerNotConfiguredError,
    get_sqlserver_session,
    init_engine,
)


async def sqlserver_session() -> AsyncIterator[AsyncSession]:
    """The SQL Server session, with setup errors turned into a 503.

    They're raised while FastAPI resolves dependencies, before the handler's own
    try/except runs, so they're mapped here."""
    try:
        init_engine()
    except (SqlServerNotConfiguredError, SqlServerDriverUnavailableError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    async for session in get_sqlserver_session():
        yield session


SqlServerSessionDep = Annotated[AsyncSession, Depends(sqlserver_session)]

# Auth-guarded like the rest of the API. Mounted under /api in main.py.
router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(get_current_user)])


@router.get("/server-info", response_model=ServerInfo)
async def server_info(session: SqlServerSessionDep) -> ServerInfo:
    """Which SQL Server and database the app reached: a connectivity check."""
    try:
        return await get_server_info(session)
    except Exception as exc:  # connection/query failure or timeout → bad gateway, not a 500
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=f"SQL Server query failed: {exc}"
        ) from exc
