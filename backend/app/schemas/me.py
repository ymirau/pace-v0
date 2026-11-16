"""``GET /api/me`` response: who the caller is."""

from pydantic import BaseModel


class MeRead(BaseModel):
    email: str | None
    name: str
