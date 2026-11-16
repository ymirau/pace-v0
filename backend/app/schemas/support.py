"""Response schemas for the support API (`/api/support`).

The request is multipart form fields, not a JSON body, so it has no schema
here: `routers/support.py` validates each field itself to give a readable 422.
"""

from typing import Literal

from pydantic import BaseModel


class SupportConfig(BaseModel):
    """Where the support form sends. ``configured`` is false when that is ``''``."""

    support_email: str
    configured: bool


class SupportSent(BaseModel):
    """``sent`` only once the relay has accepted the message; ``disabled`` when
    MAIL_ENABLED is off here and nothing went. ``recorded`` says whether the
    support_requests log row was written."""

    status: Literal["sent", "disabled"]
    recorded: bool
