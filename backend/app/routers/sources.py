"""Status of the template's optional data sources, for the Home page.

Decided from settings alone: nothing here connects to a source, and only a boolean
per source is returned, never a value. A source removed when the app was scaffolded
(`remove-sources.sh`) has its line deleted from `_CONFIGURED`, so it isn't listed.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.core.security import get_current_user
from app.schemas.sources import SourceStatus

# One line per optional source: the settings it can't work without.
_CONFIGURED: dict[str, Callable[[Settings], bool]] = {
    "sqlserver": lambda s: bool(s.sqlserver_host and s.sqlserver_database),
}

# Auth-guarded like the rest of the API. Mounted under /api in main.py.
router = APIRouter(prefix="/sources", tags=["sources"], dependencies=[Depends(get_current_user)])


@router.get("/status", response_model=list[SourceStatus])
async def source_status(
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[SourceStatus]:
    """Which optional sources are configured, judged from settings only."""
    return [SourceStatus(key=key, configured=check(settings)) for key, check in _CONFIGURED.items()]
