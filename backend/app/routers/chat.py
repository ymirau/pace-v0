"""``/api/chat``: the Pace agent, for the web UI.

The engine is the terminal spike's, vendored unchanged under ``app/pace`` — one
implementation, so the UI and the terminal can't drift into disagreeing about what the
agent does.

**The conversation lives in Postgres, not in this process.** A serverless request can
land on a cold worker, so every turn loads the history from `chat_sessions.messages`,
runs, and writes it back. An in-process cache is kept only to skip that round trip when
the same worker happens to serve the next request.

Business state (projects, tasks, proposals) lives in Postgres too, as one JSONB
document (`app/services/state_store.py`). The engine still mutates a plain dict in place
exactly as it does on a laptop; this layer just loads it before the turn and writes it
back after. Last write wins — honest for one founder, not a multi-user design.
"""

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.gate import require_access_code
from app.core.security import get_current_user
from app.pace import store
from app.pace.agent import Agent, session_meta
from app.pace.logger import Logger
from app.schemas.chat import (
    MessageSend,
    Project,
    RatingSend,
    Reply,
    ResetRequest,
    StateRead,
    Task,
)
from app.services import chat_log, state_store
from app.sources.postgres.session import get_session

logger = logging.getLogger(__name__)

# Mounted under /api in main.py. Every route needs a token AND the shared code.
router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(get_current_user), Depends(require_access_code)],
)

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]

_CACHE: dict[str, Agent] = {}

OPEN = "[session_open: today is {}]"


def _require_key(settings: Settings) -> str:
    if not settings.anthropic_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ANTHROPIC_API_KEY is not set, so the agent can't be reached.",
        )
    return settings.anthropic_api_key


async def _agent(db: AsyncSession, settings: Settings, *, resume: bool = True) -> Agent:
    """The live conversation. Resumed from Postgres when this worker has never seen it."""
    key = _require_key(settings)
    state = await state_store.load(db, settings.pace_seed)
    seed = state.get("seed", "example")

    sid = await chat_log.latest_session_id(db, seed) if resume else None
    if sid and sid in _CACHE:
        agent = _CACHE[sid]
        agent.state = state
        return agent

    model, prompt_version = session_meta()
    log = Logger(model, prompt_version, state["clock"]["today"], seed)
    if sid:
        log.session = sid  # keep logging into the session we are resuming
    agent = Agent(state, log, api_key=key, model=settings.pace_model)

    await chat_log.ensure_session(
        db,
        id=log.session,
        model=model,
        prompt_version=prompt_version,
        seed=seed,
        sim_today=state["clock"]["today"],
        founder=state["founder"],
    )
    if sid:
        stored = await chat_log.load_messages(db, sid)
        if stored:
            agent.messages = stored
            # Turn numbering continues from the stored history, so a rating made after
            # a cold start still points at the turn the reviewer actually read.
            agent.turn = sum(1 for m in stored if m.get("role") == "user")
    _CACHE.clear()
    _CACHE[log.session] = agent
    return agent


async def _reply(
    db: AsyncSession, agent: Agent, text: str, *, hidden: bool, proactive: bool
) -> Reply:
    out = agent.send(text, hidden=hidden, proactive=proactive)
    # The business state is NOT best-effort: losing it means losing the user's work, so
    # a failure here should surface rather than be swallowed.
    await state_store.save(db, agent.state)
    # The log is best-effort — a chat that 500s because logging was down is worse than
    # a lost line.
    try:
        await chat_log.add_events(db, agent.log.session, agent.log.drain())
        await chat_log.save_messages(db, agent.log.session, agent.messages)
    except Exception:
        logger.warning("Could not persist the chat log; the reply still stands.", exc_info=True)
    return Reply(
        text=out,
        session_id=agent.log.session,
        turn=agent.turn,
        proactive=proactive,
        tool_calls=[
            {"name": c["name"], "input": c["input"]} for c in getattr(agent, "last_tool_calls", [])
        ],
        cap_hit=getattr(agent, "last_cap_hit", False),
    )


@router.post("/open", response_model=Reply)
async def open_session(db: SessionDep, settings: SettingsDep) -> Reply:
    """The proactive check-in: the agent speaks before the founder types anything."""
    agent = await _agent(db, settings)
    if agent.messages:
        # Resumed conversation — don't make it greet twice. Replay the last thing it said.
        last = next(
            (m for m in reversed(agent.messages) if m.get("role") == "assistant"),
            None,
        )
        if last:
            text = "".join(
                b.get("text", "") for b in last["content"] if b.get("type") == "text"
            ).strip()
            if text:
                return Reply(
                    text=text,
                    session_id=agent.log.session,
                    turn=agent.turn,
                    proactive=True,
                    tool_calls=[],
                    cap_hit=False,
                )
    gap = store.sync_clock(agent.state)
    if gap:
        await state_store.save(db, agent.state)
    opening = OPEN.format(agent.state["clock"]["today"])
    if gap:
        agent.log.clock("elapsed", gap, "", agent.state["clock"]["today"])
        opening += f" [{gap} days since the founder last opened this]"
    return await _reply(db, agent, opening, hidden=True, proactive=True)


@router.post("/message", response_model=Reply)
async def send_message(payload: MessageSend, db: SessionDep, settings: SettingsDep) -> Reply:
    agent = await _agent(db, settings)
    return await _reply(db, agent, payload.text, hidden=False, proactive=False)


@router.post("/rate", status_code=status.HTTP_204_NO_CONTENT)
async def rate_turn(payload: RatingSend, db: SessionDep) -> None:
    """Score a turn: 0 used as-is, 1 light edits, 2 heavy edits, 3 redid it myself,
    plus how it felt. This is the evidence the v0 verdict is written from."""
    await chat_log.rate(
        db, payload.session_id, payload.turn, payload.score, payload.feel, payload.note
    )
    await chat_log.add_events(
        db,
        payload.session_id,
        [
            {
                "type": "rating",
                "turn": payload.turn,
                "score": payload.score,
                "feel": payload.feel,
                "note": payload.note,
            }
        ],
    )


@router.post("/reset", response_model=StateRead)
async def reset(payload: ResetRequest, db: SessionDep) -> StateRead:
    """Reload a seed and start a new conversation. The old session's log is kept."""
    try:
        state = await state_store.reset(db, payload.seed)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    _CACHE.clear()
    # A fresh session row, so the next /open greets instead of resuming.
    model, prompt_version = session_meta()
    await chat_log.ensure_session(
        db,
        id=uuid.uuid4().hex[:8],
        model=model,
        prompt_version=prompt_version,
        seed=state.get("seed", "example"),
        sim_today=state["clock"]["today"],
        founder=state["founder"],
    )
    return _state_read(state)


@router.get("/state", response_model=StateRead)
async def read_state(db: SessionDep, settings: SettingsDep) -> StateRead:
    state = await state_store.load(db, settings.pace_seed)
    if store.sync_clock(state):
        await state_store.save(db, state)  # a real-time seed's clock moved
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
