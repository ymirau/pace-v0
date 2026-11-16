"""``/api/chat``: the Pace agent, for the web UI.

The engine is the terminal spike's, vendored unchanged under ``app/pace`` — one
implementation, so the UI and the terminal can't drift into disagreeing about what the
agent does. State is the spike's JSON file, not Postgres: single user, one founder
looking at their own business.

Two consequences worth knowing. The conversation lives in memory, keyed by a session id,
so a backend restart starts a new conversation (the transcript on disk survives). And the
Anthropic SDK is synchronous, so every handler here is a plain ``def`` — FastAPI runs
those in a worker thread instead of blocking the event loop.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.security import get_current_user
from app.pace import store
from app.pace.agent import Agent, session_meta
from app.pace.logger import Logger
from app.schemas.chat import MessageSend, Project, Reply, ResetRequest, StateRead, Task

# Mounted under /api in main.py.
router = APIRouter(prefix="/chat", tags=["chat"], dependencies=[Depends(get_current_user)])

SettingsDep = Annotated[Settings, Depends(get_settings)]

# One conversation per process. A dict is the right size of machinery for a spike that
# one person looks at; it is explicitly not multi-user or restart-proof.
_SESSIONS: dict[str, Agent] = {}
_CURRENT: dict[str, str] = {}

OPEN = "[session_open: today is {}]"


def _require_key(settings: Settings) -> str:
    if not settings.anthropic_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ANTHROPIC_API_KEY is not set in backend/.env, so the agent can't be reached.",
        )
    return settings.anthropic_api_key


def _agent(settings: Settings) -> Agent:
    """The live conversation, created on first use."""
    key = _require_key(settings)
    sid = _CURRENT.get("id")
    if sid and sid in _SESSIONS:
        return _SESSIONS[sid]
    state = store.load()
    log = Logger(*session_meta(), state["clock"]["today"], state.get("seed", "example"))
    agent = Agent(state, log, api_key=key, model=settings.pace_model)
    sid = uuid.uuid4().hex[:8]
    _SESSIONS[sid] = agent
    _CURRENT["id"] = sid
    return agent


def _reply(agent: Agent, text: str, *, hidden: bool, proactive: bool) -> Reply:
    out = agent.send(text, hidden=hidden, proactive=proactive)
    calls = [
        {"name": c["name"], "input": c["input"]} for c in getattr(agent, "last_tool_calls", [])
    ]
    return Reply(
        text=out,
        turn=agent.turn,
        proactive=proactive,
        tool_calls=calls,
        cap_hit=getattr(agent, "last_cap_hit", False),
    )


@router.post("/open", response_model=Reply)
def open_session(settings: SettingsDep) -> Reply:
    """The proactive check-in. The agent speaks before the founder types anything —
    the whole point of the product, so the UI calls this on load."""
    agent = _agent(settings)
    gap = store.sync_clock(agent.state)
    opening = OPEN.format(agent.state["clock"]["today"])
    if gap:
        agent.log.clock("elapsed", gap, "", agent.state["clock"]["today"])
        opening += f" [{gap} days since the founder last opened this]"
    return _reply(agent, opening, hidden=True, proactive=True)


@router.post("/message", response_model=Reply)
def send_message(payload: MessageSend, settings: SettingsDep) -> Reply:
    return _reply(_agent(settings), payload.text, hidden=False, proactive=False)


@router.post("/reset", response_model=StateRead)
def reset(payload: ResetRequest) -> StateRead:
    """Reload a seed and drop the conversation, like the terminal's /reset."""
    try:
        state = store.reset(payload.seed)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    _SESSIONS.clear()
    _CURRENT.clear()
    return _state_read(state)


@router.get("/state", response_model=StateRead)
def read_state() -> StateRead:
    state = store.load()
    store.sync_clock(state)
    return _state_read(state)


def _state_read(state: dict) -> StateRead:
    tasks = [
        Task(
            id=t["id"],
            project_id=t["project_id"],
            title=t["title"],
            assignee_id=t["assignee_id"],
            assignee=store.person_name(state, t["assignee_id"]),
            status=t["status"],
            priority=t["priority"],
            due_date=t["due_date"],
            days_until=store.days_until(state, t["due_date"]),
            estimate_hrs=t["estimate_hrs"],
            waiting_on=t["waiting_on"],
            waiting_on_name=store.person_name(state, t["waiting_on"]) if t["waiting_on"] else None,
            notes=t["notes"] or "",
            last_touched=t["last_touched"],
            days_since_touched=store.days_since(state, t["last_touched"]),
            overdue=store.is_overdue(state, t),
            stale=store.is_stale(state, t),
        )
        for t in state["tasks"]
    ]
    open_by_person: dict[str, float] = {}
    for t in state["tasks"]:
        if t["status"] != "done" and t["assignee_id"]:
            open_by_person[t["assignee_id"]] = (
                open_by_person.get(t["assignee_id"], 0) + t["estimate_hrs"]
            )
    people = [{**p, "open_hrs": open_by_person.get(p["id"], 0)} for p in state["people"]]
    projects = [
        Project(
            id=p["id"],
            name=p["name"],
            status=p["status"],
            due_date=p["due_date"],
            days_until=store.days_until(state, p["due_date"]),
            why_it_matters=p.get("why_it_matters", ""),
            open_hrs=sum(t["estimate_hrs"] for t in store.open_tasks(state, p["id"])),
        )
        for p in state["projects"]
    ]
    opens = store.open_tasks(state)
    founder_id = next((p["id"] for p in state["people"] if p["role"] == "founder"), "p1")
    return StateRead(
        seed=state.get("seed", "example"),
        time_mode=state.get("time_mode", "simulated"),
        today=state["clock"]["today"],
        founder=state["founder"],
        people=people,  # type: ignore[arg-type]
        projects=projects,
        tasks=tasks,
        proposals=[p for p in state["proposals"]],  # type: ignore[misc]
        counts={
            "open": len(opens),
            "overdue": sum(1 for t in opens if store.is_overdue(state, t)),
            "stale": sum(1 for t in opens if store.is_stale(state, t)),
            "blocked": sum(1 for t in opens if t["status"] == "blocked"),
            "waiting_on_founder": sum(1 for t in opens if t["waiting_on"] == founder_id),
            "pending_proposals": sum(1 for p in state["proposals"] if p["status"] == "pending"),
        },
    )
