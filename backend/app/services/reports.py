"""Report queries against SQL Server.

This is the example to copy when adding a SQL Server-backed read: load the query
from `sql/sqlserver/`, run it with `text()` on the injected session, and shape the
row into a Pydantic response. Keeping the SQL in `sql/sqlserver/*.sql` mirrors how
the Postgres DDL lives in `sql/postgres/`.

Writes use the same session. Bind every value as a parameter (never format it into
the SQL string), then commit; an exception before the commit rolls it back:

    await session.execute(
        text("UPDATE dbo.wells SET status = :status WHERE well_id = :well_id"),
        {"status": status, "well_id": well_id},
    )
    await session.commit()
"""

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.reports import ServerInfo

# backend/app/services/reports.py -> backend/sql/sqlserver/
_SQL_DIR = Path(__file__).resolve().parents[2] / "sql" / "sqlserver"
_SERVER_INFO_SQL = (_SQL_DIR / "server_info.sql").read_text()


async def get_server_info(session: AsyncSession) -> ServerInfo:
    """Run the server-info query: one row naming the server, database and time."""
    result = await session.execute(text(_SERVER_INFO_SQL))
    return ServerInfo.model_validate(dict(result.mappings().one()))
