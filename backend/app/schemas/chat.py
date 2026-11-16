"""Chat request/response shapes for the Pace UI."""

from pydantic import BaseModel, Field


class MessageSend(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class StreamSend(BaseModel):
    """A streamed turn. `text` omitted means the proactive opening check-in."""

    text: str | None = Field(None, min_length=1, max_length=4000)


class ToolCall(BaseModel):
    name: str
    input: dict


class RatingSend(BaseModel):
    session_id: str
    turn: int = Field(ge=1)
    score: int = Field(ge=0, le=3, description="0 used as-is … 3 redid it myself")
    feel: str = Field(pattern="^(magic|annoying|meh)$")
    note: str = Field("", max_length=1000)


class Reply(BaseModel):
    text: str
    session_id: str
    turn: int
    proactive: bool
    tool_calls: list[ToolCall]
    cap_hit: bool


class ResetRequest(BaseModel):
    seed: str = "example"


class Person(BaseModel):
    id: str
    name: str
    role: str
    capacity_hrs_week: float
    open_hrs: float


class Task(BaseModel):
    id: str
    project_id: str
    title: str
    assignee_id: str | None
    assignee: str
    status: str
    priority: str
    due_date: str | None
    days_until: int | None
    estimate_hrs: float
    waiting_on: str | None
    waiting_on_name: str | None
    notes: str
    last_touched: str
    days_since_touched: int
    overdue: bool
    stale: bool


class Project(BaseModel):
    id: str
    name: str
    status: str
    due_date: str | None
    days_until: int | None
    why_it_matters: str
    open_hrs: float


class Proposal(BaseModel):
    id: str
    summary: str
    reason: str
    status: str
    created: str
    changes: list[dict]


class StateRead(BaseModel):
    seed: str
    time_mode: str
    today: str
    founder: dict
    people: list[Person]
    projects: list[Project]
    tasks: list[Task]
    proposals: list[Proposal]
    counts: dict
