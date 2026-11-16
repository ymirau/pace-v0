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

# Vercel copies the repo without installing it, so the backend must be importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from main import app  # noqa: E402

# Vercel's Python runtime looks for a module-level ASGI app named `app`.
__all__ = ["app"]
