"""A shared access code, so a review link isn't an open tap on the Anthropic bill.

This is **not** authentication. It is one secret shared by everyone who has the link,
with no identity, no audit and no revocation beyond changing it. It exists because the
deployed app bypasses MSAL and every message spends real money, so the alternative is an
open endpoint anyone can run up a bill on.

With `PACE_ACCESS_CODE` empty the gate is open — which is right for local development
(where `AUTH_DISABLED=true` already means no token) and wrong anywhere else. Deployed
envs must set it.
"""

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.core.config import Settings, get_settings


async def require_access_code(
    settings: Annotated[Settings, Depends(get_settings)],
    x_pace_access_code: Annotated[str | None, Header()] = None,
) -> None:
    expected = settings.pace_access_code
    if not expected:
        return
    # compare_digest, not ==, so a wrong code can't be guessed a character at a time.
    if not x_pace_access_code or not hmac.compare_digest(x_pace_access_code, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong or missing access code.")


AccessCode = Annotated[None, Depends(require_access_code)]
