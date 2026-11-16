"""Vercel Python entrypoint.

Vercel runs each request in a short-lived function, so nothing here may rely on
process memory or a writable disk:

* the conversation is loaded from and saved to Postgres each turn (see
  app/routers/chat.py), not held in a module-level dict;
* the JSONL transcript writer tolerates a read-only filesystem and the durable copy
  lives in `pace.chat_events`.

The business state (projects, tasks, proposals) is still the spike's JSON file, which is
**ephemeral here** — see README.md → Deploying. That is the one thing a reviewer should
know before judging the deployed app.
"""

import sys
from pathlib import Path

# Vercel copies the repo without installing it, so the backend must be importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from main import app  # noqa: E402

# Vercel's Python runtime looks for a module-level ASGI app named `app`.
__all__ = ["app"]
