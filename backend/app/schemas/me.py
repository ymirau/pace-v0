"""Response schema for ``GET /api/me``: who the caller is and their real role."""

from typing import Literal

from pydantic import BaseModel


class MeRead(BaseModel):
    """The SPA's view of the caller. ``role`` is the REAL role; "View as user" is
    applied in the browser and never reaches the server."""

    email: str | None
    name: str
    role: Literal["admin", "user"]
