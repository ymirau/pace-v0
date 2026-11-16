"""Shapes for the Log page."""

from datetime import datetime

from pydantic import BaseModel


class SessionSummary(BaseModel):
    id: str
    started_at: datetime
    updated_at: datetime
    model: str
    prompt_version: str
    seed: str
    sim_today: str | None
    business: str | None
    turns: int
    tool_calls: int
    rated: int
    avg_score: float | None


class Event(BaseModel):
    seq: int
    type: str
    created_at: datetime
    payload: dict


class SessionDetail(BaseModel):
    session: SessionSummary
    events: list[Event]
    ratings: dict[int, dict]


class Stats(BaseModel):
    """The close-out numbers (the spike's CLAUDE.md §10.4)."""

    sessions: int
    turns: int
    proactive_turns: int
    tool_calls: int
    cap_hits: int
    rated: int
    avg_score: float | None
    pct_rated_zero: float | None
    feels: dict[str, int]
    proposals: dict[str, int]
    by_prompt_version: dict[str, dict]
