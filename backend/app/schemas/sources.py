"""Response schema for the optional data sources' status (the Home page)."""

from pydantic import BaseModel


class SourceStatus(BaseModel):
    """Whether one optional source has the settings it needs. Never carries a secret."""

    key: str
    configured: bool
