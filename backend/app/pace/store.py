"""JSON store + the simulated clock.

Everything date-shaped in this spike is measured against state["clock"]["today"],
never datetime.now(). That is what lets /advance make work go stale and deadlines
slip inside one session. The real date is used in exactly one place: seeding.
"""

import json
from contextlib import suppress
from datetime import date, timedelta
from pathlib import Path

# Vendored from the terminal spike. Paths are package-relative here.
ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATE = DATA / "state.json"

# Short names for /reset.
#
# "startup" is the default demo: Alex / Tideline, a pre-launch B2B SaaS. "ceramics" is
# the original Maya / Kiln & Co fixture, kept under its own name rather than replaced —
# every scenario in scenarios.md assumes it, and transcripts recorded before the switch
# say seed="example", so repointing that name would quietly change what old evidence
# means. "example" therefore still resolves to the ceramics fixture.
#
# "mine" is your own business, copied from seed_blank.json.
SEEDS = {
    "startup": "seed_startup",
    "ceramics": "seed",
    "example": "seed",
    "blank": "seed_blank",
    "mine": "seed_mine",
}


def seed_path(name="seed"):
    return DATA / f"{SEEDS.get(name, name)}.json"


STALE_DAYS = 5


def _d(s):
    return date.fromisoformat(s)


def is_simulated(state):
    return state.get("time_mode", "simulated") == "simulated"


def today(state):
    """Today, as a date. Simulated seeds only move via /advance; a real seed tracks the
    actual date, so work goes stale because you genuinely didn't touch it."""
    return _d(state["clock"]["today"])


def sync_clock(state):
    """Real-time seeds only: catch the clock up to the actual date. Returns the number of
    days that passed since the last session — the unfaked version of /advance."""
    if is_simulated(state):
        return 0
    real = date.today()
    gap = (real - today(state)).days
    if gap > 0:
        state["clock"]["last_opened"] = state["clock"]["today"]
        state["clock"]["today"] = real.isoformat()
        save(state)
    return max(gap, 0)


def days_until(state, iso):
    """Days from the simulated today until `iso`. Negative = overdue."""
    return (_d(iso) - today(state)).days if iso else None


def days_since(state, iso):
    return (today(state) - _d(iso)).days if iso else None


def reset(name="example"):
    """Build a fresh state.json from a seed, resolving day-offsets to real dates.

    `name` is a short name from SEEDS or a bare filename under data/. The seed name is
    stored on the state and logged on session_start: transcripts from different seeds
    are not comparable, so the evidence has to say which one it came from.
    """
    path = seed_path(name)
    if not path.exists():
        raise FileNotFoundError(
            f"No seed at {path.relative_to(ROOT)}. "
            f"Known: {', '.join(sorted(SEEDS))}, or a filename under data/."
        )
    seed = json.loads(path.read_text())
    t0 = date.today()

    def shift(n):
        return (t0 + timedelta(days=n)).isoformat() if n is not None else None

    state = {
        "seed": name,
        "time_mode": seed.get("time_mode", "simulated"),
        "clock": {"today": t0.isoformat(), "started": t0.isoformat()},
        "founder": dict(seed["founder"], goal_date=shift(seed.get("goal_in_days"))),
        "people": [dict(p) for p in seed["people"]],
        "projects": [],
        "tasks": [],
        "proposals": [],
        "changelog": [],
    }
    for p in seed.get("projects", []):
        p = dict(p)
        p["due_date"] = shift(p.pop("due_in_days"))
        state["projects"].append(p)
    for t in seed.get("tasks", []):
        t = dict(t)
        t["due_date"] = shift(t.pop("due_in_days"))
        t["last_touched"] = shift(-t.pop("last_touched_days_ago"))
        state["tasks"].append(t)
    save(state)
    return state


def load():
    if not STATE.exists():
        return reset()
    return json.loads(STATE.read_text())


def save(state):
    """Best-effort. On a serverless host the filesystem is read-only and the durable
    copy lives in Postgres (app/services/state_store.py), so a failure here is not
    fatal; on a laptop this file IS the store."""
    with suppress(OSError):
        STATE.write_text(json.dumps(state, indent=2))


def advance(state, days):
    """Move the simulated clock forward. last_touched is deliberately untouched:
    doing nothing for three days is how work becomes stale."""
    if not is_simulated(state):
        raise ValueError("real-time seed")
    state["clock"]["today"] = (today(state) + timedelta(days=days)).isoformat()
    save(state)
    return state["clock"]["today"]


def log_change(state, session, tool, summary):
    state["changelog"].append(
        {"ts": state["clock"]["today"], "session": session, "tool": tool, "summary": summary}
    )


# --- lookups -----------------------------------------------------------------


def person(state, pid):
    return next((p for p in state["people"] if p["id"] == pid), None)


def person_name(state, pid):
    p = person(state, pid)
    return p["name"] if p else "unassigned"


def project(state, pid):
    for p in state["projects"]:
        if p["id"] == pid or p["name"].lower() == str(pid).lower():
            return p
    return None


def task(state, tid):
    return next((t for t in state["tasks"] if t["id"] == tid), None)


def open_tasks(state, project_id=None):
    return [
        t
        for t in state["tasks"]
        if t["status"] != "done" and (project_id is None or t["project_id"] == project_id)
    ]


def is_overdue(state, t):
    """bool, not a truthy value: a task with no due date must answer False, not None.
    Every seeded task has a date, so this only showed up once the agent created one
    without — and then the API's response model refused to serialise it."""
    return bool(t["status"] != "done" and t["due_date"] and days_until(state, t["due_date"]) < 0)


def is_stale(state, t):
    """Started-then-abandoned work. A `todo` task isn't stuck, it just hasn't begun —
    so staleness only counts for doing/blocked, or get_overview floods with noise."""
    return bool(
        t["status"] in ("doing", "blocked") and days_since(state, t["last_touched"]) >= STALE_DAYS
    )


def next_id(items, prefix):
    n = 0
    for i in items:
        with suppress(ValueError):
            n = max(n, int(str(i["id"]).lstrip(prefix)))
    return f"{prefix}{n + 1}"
