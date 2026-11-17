"""``/api/chat``: the Pace agent, for the web UI.

The engine is the terminal spike's, vendored unchanged under ``app/pace`` — one
implementation, so the UI and the terminal can't drift into disagreeing about what the
agent does.

**The conversation lives in Postgres, not in this process.** A serverless request can
land on a cold worker, so every turn loads the history from `chat_sessions.messages`,
runs, and writes it back. An in-process cache is kept only to skip that round trip when
the same worker happens to serve the next request.

Business state (projects, tasks, proposals) lives in Postgres too, as one JSONB
document **per visitor** (`app/services/state_store.py`). The engine still mutates a
plain dict in place exactly as it does on a laptop; this layer just loads it before the
turn and writes it back after.

Every route is scoped to the caller's visitor id (`app/core/visitor.py`), so two people
on the review link get their own world and their own conversation instead of sharing
one. Within a visitor it is still last-write-wins: two tabs of the same browser can
clobber each other.

**A turn takes seconds, and the engine is blocking.** The opening check-in is two API
calls and about 7s of generation; `/stream` sends what the agent is doing as it happens
so the wait is visible, and every route runs the engine in a worker thread so one turn
can't freeze the rest of the API (`/state`, `/log`) behind it.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator
from functools import partial
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import iterate_in_threadpool

from app.core.config import Settings, get_settings
from app.core.gate import require_access_code
from app.core.security import get_current_user
from app.core.visitor import Visitor
from app.pace import store
from app.pace.agent import Agent, opening, session_meta
from app.pace.logger import Logger
from app.schemas.chat import (
    MessageSend,
    Project,
    RatingSend,
    Reply,
    ResetRequest,
    StateRead,
    StreamSend,
    Task,
)
from app.services import chat_log, state_store
from app.sources.postgres.session import get_session, session_scope

logger = logging.getLogger(__name__)

# Mounted under /api in main.py. Every route needs a token AND the shared code.
router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(get_current_user), Depends(require_access_code)],
)

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]

# Live agents, keyed by visitor. Only a shortcut: every turn can be rebuilt from
# Postgres, so losing this costs a round trip and nothing else. It used to be keyed by
# session id and cleared on every miss, which with more than one visitor meant each
# request evicted the other person's agent.
_CACHE: dict[str, Agent] = {}

#: Keep the cache from growing without bound on a long-lived worker. Dropping the lot is
#: fine (see above) and simpler than tracking what was used least recently.
_CACHE_MAX = 32


def _require_key(settings: Settings) -> str:
    if not settings.anthropic_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ANTHROPIC_API_KEY is not set, so the agent can't be reached.",
        )
    return settings.anthropic_api_key


def _resumed_turn_count(stored: list[dict]) -> int:
    """How many turns the founder has actually taken, from the stored history.

    Ratings are keyed on (session_id, turn), so this has to land on the same number the
    live agent would have reached — otherwise a verdict given after a cold start points
    at a reply nobody gave.

    Only count what was typed. A `tool_result` is appended with role "user" too, because
    the Messages API has no third role, so counting every user message inflated the
    number by one per tool call: two real turns and three tool results came back as
    turn 5 on the deployed app. A typed turn is the string form; tool results are always
    a list of content blocks. See tests/test_resume_turns.py.
    """
    return sum(1 for m in stored if m.get("role") == "user" and isinstance(m.get("content"), str))


async def _agent(
    db: AsyncSession, settings: Settings, visitor: str, *, resume: bool = True
) -> Agent:
    """This visitor's live conversation, resumed from Postgres on a cold worker."""
    key = _require_key(settings)
    state = await state_store.load(db, visitor, settings.pace_seed)
    seed = state.get("seed", "example")

    sid = await chat_log.latest_session_id(db, seed, visitor) if resume else None
    cached = _CACHE.get(visitor)
    # Only reuse it for the session we actually mean to resume. A /reset writes a new
    # session row, and serving the cached agent then would carry the old conversation
    # (and its turn numbers) into it.
    if sid and cached is not None and cached.log.session == sid:
        cached.state = state
        return cached

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
        visitor=visitor,
        sim_today=state["clock"]["today"],
        founder=state["founder"],
    )
    if sid:
        stored = await chat_log.load_messages(db, sid)
        if stored:
            agent.messages = stored
            agent.turn = _resumed_turn_count(stored)
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.clear()
    _CACHE[visitor] = agent
    return agent


async def _reply(
    db: AsyncSession, agent: Agent, visitor: str, text: str, *, hidden: bool, proactive: bool
) -> Reply:
    # agent.send blocks for seconds on the Anthropic API. On one uvicorn worker that
    # would stall every other request, /state and /log included, until the turn landed.
    out = await anyio.to_thread.run_sync(
        partial(agent.send, text, hidden=hidden, proactive=proactive)
    )
    # The business state is NOT best-effort: losing it means losing the user's work, so
    # a failure here should surface rather than be swallowed.
    await state_store.save(db, visitor, agent.state)
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


def _resumed(agent: Agent) -> Reply | None:
    """The last thing the agent said, when this is a conversation already under way.

    A reopened session must not greet twice, and replaying costs no API call — which is
    why relaunching the app is instant and only a fresh session waits for the model.
    """
    if not agent.messages:
        return None
    last = next((m for m in reversed(agent.messages) if m.get("role") == "assistant"), None)
    if not last:
        return None
    text = "".join(b.get("text", "") for b in last["content"] if b.get("type") == "text").strip()
    if not text:
        return None
    return Reply(
        text=text,
        session_id=agent.log.session,
        turn=agent.turn,
        proactive=True,
        tool_calls=[],
        cap_hit=False,
    )


async def _check_in(db: AsyncSession, agent: Agent, visitor: str) -> str:
    """The hidden opening message, and the clock catch-up that goes with it."""
    gap = store.sync_clock(agent.state)
    if gap:
        await state_store.save(db, visitor, agent.state)
        agent.log.clock("elapsed", gap, "", agent.state["clock"]["today"])
    return opening(agent.state, gap)


@router.post("/open", response_model=Reply)
async def open_session(db: SessionDep, settings: SettingsDep, visitor: Visitor) -> Reply:
    """The proactive check-in: the agent speaks before the founder types anything."""
    agent = await _agent(db, settings, visitor)
    resumed = _resumed(agent)
    if resumed:
        return resumed
    return await _reply(
        db, agent, visitor, await _check_in(db, agent, visitor), hidden=True, proactive=True
    )


@router.post("/message", response_model=Reply)
async def send_message(
    payload: MessageSend, db: SessionDep, settings: SettingsDep, visitor: Visitor
) -> Reply:
    agent = await _agent(db, settings, visitor)
    return await _reply(db, agent, visitor, payload.text, hidden=False, proactive=False)


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/stream")
async def stream_turn(
    payload: StreamSend, settings: SettingsDep, visitor: Visitor
) -> StreamingResponse:
    """The same turn as ``/open`` and ``/message``, sent as it happens.

    Events: ``tool`` each time the agent reaches for something, ``text`` as it writes,
    ``done`` with the finished Reply, ``error`` if the turn fell over.

    This does not make a turn shorter — the time is the model generating, and that was
    measured: caching the 3.9k-token tools-and-prompt prefix and cutting a round trip
    both came out inside the noise. What it changes is that the founder can see the turn
    happening from about three seconds in, instead of watching nothing for seven.

    Pace's replies are short on purpose, and a short reply arrives from the API in one
    burst once it is finished, so the per-word effect only shows on a long one. The
    reliable signal is the tool events.

    The session is this handler's own: FastAPI closes a `Depends` session before a
    streaming body is finished, and this one is still writing state and log after the
    last event.
    """
    _require_key(settings)

    async def events() -> AsyncIterator[str]:
        async with session_scope() as db:
            agent = await _agent(db, settings, visitor)
            proactive = payload.text is None
            if proactive:
                resumed = _resumed(agent)
                if resumed:
                    yield _sse("done", resumed.model_dump())
                    return
                text = await _check_in(db, agent, visitor)
            else:
                text = payload.text or ""

            reply = ""
            turn = agent.stream(text, hidden=proactive, proactive=proactive)
            try:
                # iterate_in_threadpool runs each next() on a worker thread, so the
                # blocking engine never sits on the event loop.
                async for kind, data in iterate_in_threadpool(turn):
                    if kind == "done":
                        reply = data
                    elif kind == "text":
                        yield _sse("text", {"delta": data})
                    else:
                        yield _sse("tool", data)
            except Exception as e:  # the stream has to report its own failure
                logger.exception("The turn failed mid-stream.")
                yield _sse("error", {"message": f"{type(e).__name__}: {e}"})
                return

            # Same order as /message: state is not best-effort, the log is.
            await state_store.save(db, visitor, agent.state)
            try:
                await chat_log.add_events(db, agent.log.session, agent.log.drain())
                await chat_log.save_messages(db, agent.log.session, agent.messages)
            except Exception:
                logger.warning(
                    "Could not persist the chat log; the reply still stands.", exc_info=True
                )

            yield _sse(
                "done",
                Reply(
                    text=reply,
                    session_id=agent.log.session,
                    turn=agent.turn,
                    proactive=proactive,
                    tool_calls=[
                        {"name": c["name"], "input": c["input"]}
                        for c in getattr(agent, "last_tool_calls", [])
                    ],
                    cap_hit=getattr(agent, "last_cap_hit", False),
                ).model_dump(),
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # Caddy and Azure App Proxy sit in front of this; without these a proxy can hold
        # the whole body back and undo the point of streaming.
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


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
async def reset(payload: ResetRequest, db: SessionDep, visitor: Visitor) -> StateRead:
    """Reload a seed and start a new conversation, for this visitor only.

    The old session's log is kept — resetting your own world must not delete evidence,
    and it has never been able to touch anyone else's.
    """
    try:
        state = await state_store.reset(db, visitor, payload.seed)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    _CACHE.pop(visitor, None)
    # A fresh session row, so the next /open greets instead of resuming.
    model, prompt_version = session_meta()
    await chat_log.ensure_session(
        db,
        id=uuid.uuid4().hex[:8],
        model=model,
        prompt_version=prompt_version,
        seed=state.get("seed", "example"),
        visitor=visitor,
        sim_today=state["clock"]["today"],
        founder=state["founder"],
    )
    return _state_read(state)


@router.get("/state", response_model=StateRead)
async def read_state(db: SessionDep, settings: SettingsDep, visitor: Visitor) -> StateRead:
    state = await state_store.load(db, visitor, settings.pace_seed)
    if store.sync_clock(state):
        await state_store.save(db, visitor, state)  # a real-time seed's clock moved
    return _state_read(state)


@router.get("/ping")
async def ping() -> dict[str, bool]:
    """Is the reviewer's access code right? Nothing else.

    `AccessGate` in the SPA needs one cheap gated endpoint to probe, and it used to probe
    `/log/stats`. That stopped being the same question when the log moved behind its own
    viewer code: a reviewer with a perfectly good access code would have been told their
    code was wrong. This route carries the router's own dependencies and no body worth
    reading, so it answers exactly the question asked and costs no model call, no state
    read and no write.
    """
    return {"ok": True}


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
