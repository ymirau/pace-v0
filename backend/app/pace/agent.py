"""The hand-written tool-use loop. No framework, by design (CLAUDE.md §3.2).

Three things about claude-sonnet-5-5 shape this file:
  - History is append-only. The whole response.content goes back on the wire,
    thinking blocks included; earlier messages are never edited or removed.
  - stop_reason can be "refusal", so it is checked before content is read. The
    server-side fallback is on so a classifier false positive doesn't kill a run.
  - No temperature and no budget_tokens (both rejected). Depth is set with effort.
    Measured on the opening check-in: medium 7.9s, low 4.7s, and low with thinking
    off (between_tools) 13.2s AND it applied a proposal without asking. So: low
    effort, thinking left on.
"""

import os
import time
from pathlib import Path

import anthropic

from . import store, tools

ROOT = Path(__file__).resolve().parent
PROMPTS = ROOT / "prompts"
MAX_TOOL_CALLS = 10
GREY, RESET = "\033[90m", "\033[0m"


def latest_prompt():
    """Highest system_vN.md. Versions are never edited in place (§8.1)."""
    files = sorted(PROMPTS.glob("system_v*.md"), key=lambda p: int(p.stem.split("_v")[1]))
    if not files:
        raise SystemExit("No prompts/system_v*.md found.")
    return files[-1]


def session_meta():
    """Model and prompt version, resolvable before the Agent exists — the transcript's
    first line must carry them, or a session can't be traced to its prompt."""
    return (os.environ.get("PACE_MODEL", "claude-sonnet-5-5"), latest_prompt().stem.split("_")[-1])


def default_seed():
    return os.environ.get("PACE_SEED", "example")


class Agent:
    def __init__(self, state, logger, api_key=None, model=None):
        self.state = state
        self.log = logger
        self.model, self.prompt_version = session_meta()
        if model:
            self.model = model
        # The web app reads config through pydantic-settings, which doesn't populate
        # os.environ, so the key is passed in rather than discovered.
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()
        self.prompt_file = latest_prompt()
        self.messages = []
        self.turn = 0
        self.tool_calls = 0

    def system(self):
        """Fill the prompt from the state. A blank field becomes an explicit "not told
        yet" rather than an empty string, so the model never greets a nameless founder
        or reads "goal: " as a goal."""
        f = self.state["founder"]

        def known(key, empty="(not told yet)"):
            v = f.get(key)
            return v if v not in (None, "", 0) else empty

        return self.prompt_file.read_text().format(
            founder=known("name"),
            business=known("business"),
            goal=known("goal"),
            goal_date=known("goal_date", "(no date set)"),
            weekly_hours=known("weekly_hours"),
            today=self.state["clock"]["today"],
        )

    def _call(self):
        # client.beta.messages: `betas`/`fallbacks` only exist on the beta endpoint.
        return self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            system=self.system(),
            messages=self.messages,
            tools=tools.SCHEMAS,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )

    def send(self, text, hidden=False, proactive=False):
        """One user turn: model -> tools -> model, until it answers in plain text."""
        self.turn += 1
        self.log.user(text, hidden=hidden)
        self.messages.append({"role": "user", "content": text})

        calls, cap_hit, t0 = 0, False, time.time()
        self.last_tool_calls = []  # what the UI shows as "it looked at…"
        tok_in = tok_out = 0

        while True:
            r = self._call()
            tok_in += r.usage.input_tokens
            tok_out += r.usage.output_tokens

            if r.stop_reason == "refusal":
                reply = "[the model declined this turn]"
                self.log.write(
                    "refusal", turn=self.turn, detail=str(getattr(r, "stop_details", None))
                )
                self.messages.append({"role": "assistant", "content": r.content})
                break

            # Append-only: the whole content block list, thinking included.
            self.messages.append({"role": "assistant", "content": r.content})

            if r.stop_reason == "pause_turn":
                continue

            uses = [b for b in r.content if b.type == "tool_use"]
            if not uses:
                reply = "".join(b.text for b in r.content if b.type == "text").strip()
                break

            if calls + len(uses) > MAX_TOOL_CALLS:
                cap_hit = True
                self.messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": u.id,
                                "is_error": True,
                                "content": f"Tool-call cap ({MAX_TOOL_CALLS}) hit for this turn. "
                                "Stop calling tools and answer with what you have.",
                            }
                            for u in uses
                        ],
                    }
                )
                continue

            results = []
            for u in uses:
                calls += 1
                self.tool_calls += 1
                self.log.tool_call(u.name, u.input)
                self.last_tool_calls.append({"name": u.name, "input": u.input})
                t1 = time.time()
                out = tools.run(u.name, u.input, self.state, self.log.session)
                ms = int((time.time() - t1) * 1000)
                self.log.tool_result(u.name, out, ms)
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": out})
            store.save(self.state)
            self.messages.append({"role": "user", "content": results})

        store.save(self.state)
        self.log.assistant(
            reply, self.turn, proactive, (tok_in, tok_out), int((time.time() - t0) * 1000), cap_hit
        )
        self.last_calls = calls
        self.last_cap_hit = cap_hit
        return reply


def _fmt(d):
    if not d:
        return ""
    out = []
    for k, v in d.items():
        s = str(v)
        out.append(f"{k}={s[:40] + '…' if len(s) > 40 else s}")
    return ", ".join(out)
