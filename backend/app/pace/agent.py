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

Where the opening turn's ~7.5s goes, measured call by call: 1.2s to call get_overview,
3.8s to draft a proposal, 2.5s to write the founder two paragraphs. Almost all of it is
generation, not waiting — so neither prompt caching nor cutting a round trip moves the
total much (both measured, both inside the noise at n=3). The two things that do:
`opening()`, which runs the overview here instead of spending a call on it, and
`stream()`, which lets the founder watch the turn happen instead of staring at eight
seconds of nothing.
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


def opening(state, gap=0, note=""):
    """The hidden first message of a session, with the overview already pasted into it.

    The prompt tells the agent to look at the real state before it speaks, and on a cold
    open that round trip buys nothing: `get_overview` is a pure read of a dict this
    process is already holding, so running it here hands the agent the exact bytes it
    would have asked for, one API call sooner.

    Measured over three openings on the example seed: bare 8.6s median and three API
    calls, this 7.3s and two, every run reaching for `propose_plan` and nothing else.
    The wording is firm on purpose — a softer version ("no need to call it again") left
    the agent spending the freed call on `find_tasks` and `check_timeline` instead, which
    gave the saving straight back.
    """
    lines = [f"[session_open: today is {state['clock']['today']}]"]
    if gap:
        lines.append(f"[{gap} days since the founder last opened this]")
    if note:
        lines.append(f"[{note}]")
    lines += [
        "[get_overview has already been run for this turn and its full output is below. "
        "It is everything the read tools would tell you about today: every overdue, "
        "stale, blocked and waiting item, and every deadline. Speak from it. Only call "
        "another read tool if something here is genuinely ambiguous — otherwise go "
        "straight to the one proposal that matters most.]",
        "",
        tools.get_overview(state),
    ]
    return "\n".join(lines)


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

    def _params(self):
        return {
            "model": self.model,
            "max_tokens": 16000,
            "system": self.system(),
            "messages": self.messages,
            "tools": tools.SCHEMAS,
            "output_config": {"effort": "low"},
            # client.beta.messages: `betas`/`fallbacks` only exist on the beta endpoint.
            "betas": ["server-side-fallback-2026-07-01"],
            "fallbacks": "default",
        }

    def stream(self, text, hidden=False, proactive=False):
        """One user turn, as it happens: ``("tool", {...})`` when it reaches for
        something, ``("text", delta)`` as it writes, ``("done", reply)`` at the end.

        Streaming does not make a turn shorter — the time is generation, not waiting. It
        makes the wait *visible*, which was the part that read as broken: until the last
        of the turn's three calls finished, the founder saw nothing at all.

        ``send()`` is this, drained, so the terminal and the web app run the same loop.
        """
        self.turn += 1
        self.log.user(text, hidden=hidden)
        self.messages.append({"role": "user", "content": text})

        calls, cap_hit, t0 = 0, False, time.time()
        self.last_tool_calls = []  # what the UI shows as "it looked at…"
        tok_in = tok_out = 0
        said = []  # every text block of the turn, in order

        while True:
            # A blank line between two separate things it said, so the founder reads
            # one message rather than two sentences run together.
            gap = bool(said)
            with self.client.beta.messages.stream(**self._params()) as s:
                for event in s:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        if gap:
                            yield ("text", "\n\n")
                            gap = False
                        yield ("text", event.delta.text)
                r = s.get_final_message()

            tok_in += r.usage.input_tokens
            tok_out += r.usage.output_tokens

            if r.stop_reason == "refusal":
                said = ["[the model declined this turn]"]
                self.log.write(
                    "refusal", turn=self.turn, detail=str(getattr(r, "stop_details", None))
                )
                self.messages.append(
                    {
                        "role": "assistant",
                        "content": [b.model_dump(mode="json") for b in r.content],
                    }
                )
                break

            # Append-only: the whole content block list, thinking included. Dumped to
            # plain JSON so the history can be stored and replayed verbatim on a cold
            # process — model_dump keeps every field, thinking signatures included.
            self.messages.append(
                {
                    "role": "assistant",
                    "content": [b.model_dump(mode="json") for b in r.content],
                }
            )

            spoke = "".join(b.text for b in r.content if b.type == "text").strip()
            if spoke:
                said.append(spoke)

            if r.stop_reason == "pause_turn":
                continue

            uses = [b for b in r.content if b.type == "tool_use"]
            if not uses:
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
                yield ("tool", {"name": u.name, "input": u.input})
                t1 = time.time()
                out = tools.run(u.name, u.input, self.state, self.log.session)
                ms = int((time.time() - t1) * 1000)
                self.log.tool_result(u.name, out, ms)
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": out})
            store.save(self.state)
            self.messages.append({"role": "user", "content": results})

        reply = "\n\n".join(said)
        store.save(self.state)
        self.log.assistant(
            reply, self.turn, proactive, (tok_in, tok_out), int((time.time() - t0) * 1000), cap_hit
        )
        self.last_calls = calls
        self.last_cap_hit = cap_hit
        yield ("done", reply)

    def send(self, text, hidden=False, proactive=False):
        """The whole turn, waited out. ``stream()`` is the same loop, event by event."""
        reply = ""
        for kind, data in self.stream(text, hidden=hidden, proactive=proactive):
            if kind == "done":
                reply = data
        return reply


def _fmt(d):
    if not d:
        return ""
    out = []
    for k, v in d.items():
        s = str(v)
        out.append(f"{k}={s[:40] + '…' if len(s) > 40 else s}")
    return ", ".join(out)
