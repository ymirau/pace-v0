"""Vercel Python entrypoint.

Vercel runs each request in a short-lived function, so nothing here may rely on
process memory or a writable disk:

* the conversation is loaded from and saved to Postgres each turn (see
  app/routers/chat.py), not held in a module-level dict;
* the JSONL transcript writer tolerates a read-only filesystem and the durable copy
  lives in `pace.chat_events`;
* the business state (projects, tasks, proposals) is one JSONB document in
  `pace.pace_state`, loaded before each turn and written back after, so work added
  through the chat survives a recycled function. `app/pace/store.py` still writes its
  JSON file as a cache and swallows the resulting OSError here.

`vercel.json` sets `includeFiles` for `backend/app/pace/**` because the engine reads two
things off disk that no import graph mentions: the versioned prompts under `prompts/`
and the seed fixtures under `data/`. Without them the first request dies in
`latest_prompt()`.
"""

import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

# Vercel copies the repo without installing it, so the backend must be importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from main import app as fastapi_app

PATH_PARAM = "__vercel_path"


class RestoreOriginalPath:
    """Put the request's real path back before FastAPI routes on it.

    A Vercel rewrite does not just *route* a request, it replaces the path: every
    `/api/...` URL is rewritten to `/api/index` so the platform can find this file, and
    the ASGI app is then handed `/api/index` — which matches no route, so the whole API
    answers `{"detail":"Not Found"}`. That is exactly what the first deploy did.

    There is no documented header carrying the original path, so `vercel.json` passes it
    explicitly as a query parameter and this puts it back, then strips the parameter so
    handlers never see it. Absent — local dev, the tests, uvicorn — this is a no-op, so
    there is only ever one code path to reason about.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            params = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
            original = next((v for k, v in params if k == PATH_PARAM), None)
            if original:
                scope = dict(scope)
                scope["path"] = original
                scope["raw_path"] = original.encode()
                scope["query_string"] = urlencode(
                    [(k, v) for k, v in params if k != PATH_PARAM]
                ).encode()
        await self.app(scope, receive, send)


# Vercel's Python runtime looks for a module-level ASGI app named `app`.
app = RestoreOriginalPath(fastapi_app)

__all__ = ["app"]
