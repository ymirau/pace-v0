"""Response schemas for the SQL Server-backed reports example."""

import datetime

from pydantic import BaseModel


class ServerInfo(BaseModel):
    """What the app reached on SQL Server: the version banner, database and clock."""

    version: str
    database_name: str
    server_time: datetime.datetime
