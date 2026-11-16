"""Transcript writer. One .jsonl per session, one object per line.

This is the actual product of v0 — the code gets deleted, these files don't.
Everything is flushed on write so a crashed session still leaves usable evidence.
"""

import json
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIR = ROOT / "transcripts"


def _ts():
    return datetime.now().isoformat(timespec="seconds")


class Logger:
    def __init__(self, model, prompt_version, sim_today, seed="example"):
        self.session = uuid.uuid4().hex[:4]
        self.path = DIR / f"{datetime.now():%Y-%m-%d_%H%M}_{self.session}.jsonl"
        # Every line is also kept in memory: a serverless host has a read-only
        # filesystem, so the file is a convenience and the durable copy is elsewhere.
        self.lines: list[dict] = []
        try:
            DIR.mkdir(exist_ok=True)
            self.fh = self.path.open("a", encoding="utf-8")
        except OSError:
            self.fh = None
        self.write(
            "session_start",
            model=model,
            prompt_version=prompt_version,
            seed=seed,
            sim_today=sim_today,
        )

    def drain(self):
        """Hand over the lines written since the last drain, for the durable store."""
        out, self.lines = self.lines, []
        return out

    def write(self, type, **kw):
        line = {"type": type, **kw, "ts": _ts()}
        self.lines.append(line)
        if self.fh:
            self.fh.write(json.dumps(line) + "\n")
            self.fh.flush()

    def clock(self, event, days, note, sim_today):
        self.write("clock", event=event, days=days, note=note, sim_today=sim_today)

    def user(self, text, hidden=False):
        self.write("user", text=text, hidden=hidden)

    def tool_call(self, name, input):
        self.write("tool_call", name=name, input=input)

    def tool_result(self, name, output, ms):
        self.write("tool_result", name=name, output=output, ms=ms)

    def assistant(self, text, turn, proactive, usage, ms, cap_hit):
        self.write(
            "assistant",
            text=text,
            turn=turn,
            proactive=proactive,
            input_tokens=usage[0],
            output_tokens=usage[1],
            ms=ms,
            cap_hit=cap_hit,
        )

    def proposal(self, id, outcome):
        self.write("proposal", id=id, outcome=outcome)

    def rating(self, turn, score, feel, note):
        self.write("rating", turn=turn, score=score, feel=feel, note=note)

    def session_end(self, turns, tool_calls, proposals):
        self.write("session_end", turns=turns, tool_calls=tool_calls, proposals=proposals)
        if self.fh:
            self.fh.close()
