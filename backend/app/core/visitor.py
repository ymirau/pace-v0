"""Which browser is asking — not who is asking.

The deployed app has no authentication (see `core/gate.py`): one shared code, no
identity. But every visitor still needs their own copy of the business state, or the
first reviewer to tidy an overdue task changes what the second reviewer is shown, and
the ratings stop being comparable.

So the browser mints a random id once and keeps it (`frontend/src/visitor.ts`). That is
enough to say "the same browser as last time" and it is **deliberately not** a claim
about a person: it is client-supplied, swappable by anyone who opens devtools, and must
never gate anything that matters. It partitions a demo world. That is all.

Two consequences worth stating plainly:

* **It is a database key that arrives from the client**, so it is validated against a
  strict charset and length here, before it reaches SQL or a dict key. An unvalidated
  value could be megabytes long or collide with the reserved default below.
* **A caller that sends nothing is `solo`.** The terminal spike, curl and local dev all
  do that, and `solo` maps to the state row that existed before visitors did
  (`services/state_store.py`), so this change moves no stored data.
"""

import re
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

#: The caller that sent no id: local dev, the terminal spike, anything pre-visitors.
SOLO = "solo"

# Deliberately narrower than the UUID the frontend sends. A visitor id ends up as a
# primary-key value and a cache key, so the accepted set is the one that cannot surprise
# either: no quotes, no whitespace, no path separators, bounded length.
_OK = re.compile(r"\A[A-Za-z0-9_-]{1,64}\Z")


async def current_visitor(x_pace_visitor: Annotated[str | None, Header()] = None) -> str:
    """The visitor id for this request, or `SOLO` when the caller sent none."""
    if x_pace_visitor is None or not x_pace_visitor.strip():
        return SOLO
    visitor = x_pace_visitor.strip()
    if not _OK.match(visitor):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "X-Pace-Visitor must be 1-64 characters of letters, digits, '-' or '_'.",
        )
    if visitor == SOLO:
        # Reserved, because `SOLO` maps to the state row that predates visitors
        # (`services/state_store.SOLO_KEY`) — the developer's own world. Letting a client
        # name it would make that world reachable by typing a guessable word into
        # devtools. The name is reserved rather than renamed so nothing already stored
        # under it has to move.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{SOLO}' is reserved for a caller that sends no visitor id.",
        )
    return visitor


Visitor = Annotated[str, Depends(current_visitor)]
