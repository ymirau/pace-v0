"""The 7 tools. Every one returns short readable text plus IDs — never a state dump.

The propose/apply split is the thesis in code: anything the agent initiates must go
through propose_plan and wait for a yes. Only what the founder explicitly asked for
this turn may go straight through update_tasks / create_tasks.
"""

from . import store

FIELDS = ("status", "assignee_id", "due_date", "priority", "estimate_hrs", "notes", "waiting_on")

CHANGE = {
    "type": "object",
    "description": "One change. action=update_task needs task_id; create_task needs project_id and title.",
    "properties": {
        "action": {"type": "string", "enum": ["update_task", "create_task"]},
        "task_id": {"type": "string"},
        "project_id": {"type": "string"},
        "title": {"type": "string"},
        "status": {"type": "string", "enum": ["todo", "doing", "blocked", "done"]},
        "assignee_id": {"type": ["string", "null"]},
        "due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
        "priority": {"type": "string", "enum": ["low", "med", "high"]},
        "estimate_hrs": {"type": "number"},
        "notes": {"type": "string"},
        "waiting_on": {"type": ["string", "null"]},
    },
    "required": ["action"],
    "additionalProperties": False,
}

SCHEMAS = [
    {
        "name": "get_overview",
        "description": (
            "The manager's snapshot: progress against the goal date, overdue work, stale "
            "(started but untouched 5+ days), work waiting on the founder, blocked work, and "
            "each person's open hours against their weekly capacity. Call this first on a "
            "check-in."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "find_tasks",
        "description": "Filter tasks. Combine filters freely; all are optional.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project id or name"},
                "assignee": {"type": "string", "description": "Person id or name"},
                "status": {"type": "string", "enum": ["todo", "doing", "blocked", "done"]},
                "overdue": {"type": "boolean"},
                "stale": {"type": "boolean", "description": "Started but untouched 5+ days"},
                "waiting_on": {
                    "type": "string",
                    "description": "Person id or name being waited on",
                },
                "text": {"type": "string", "description": "Substring of the title or notes"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "check_timeline",
        "description": (
            "Will this project make its date? Sums the remaining estimates against each "
            "assignee's capacity between today and the due date, and reports the slack or "
            "shortfall per person. Plain arithmetic — it knows nothing about task order."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
            "required": ["project_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "propose_plan",
        "description": (
            "Package changes you are initiating into a pending proposal the founder can "
            "approve with one word. NOTHING changes until they say yes and you call "
            "apply_proposal. Use this for everything you came up with yourself. Keep it "
            "small enough to approve in 5 seconds."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One line, what this does"},
                "reason": {"type": "string", "description": "One line, why it matters now"},
                "changes": {"type": "array", "items": CHANGE},
            },
            "required": ["summary", "reason", "changes"],
            "additionalProperties": False,
        },
    },
    {
        "name": "apply_proposal",
        "description": (
            "Apply a pending proposal after the founder says yes. For a modified yes, pass "
            "approved_changes with just the indexes they agreed to (0-based). If they said no, "
            "call reject_proposal instead of this."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "proposal_id": {"type": "string"},
                "approved_changes": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "0-based indexes of the changes to apply. Omit to apply all.",
                },
            },
            "required": ["proposal_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "reject_proposal",
        "description": "Record that the founder declined a proposal, so it isn't counted as ignored.",
        "input_schema": {
            "type": "object",
            "properties": {
                "proposal_id": {"type": "string"},
                "note": {"type": "string", "description": "What they said, briefly"},
            },
            "required": ["proposal_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "create_tasks",
        "description": (
            "Add tasks, optionally in a new project. Only for what the founder explicitly "
            "asked for this turn — otherwise use propose_plan."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "new_project": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "due_date": {"type": ["string", "null"]},
                        "why_it_matters": {"type": "string"},
                    },
                    "required": ["name"],
                    "additionalProperties": False,
                },
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "assignee_id": {"type": ["string", "null"]},
                            "status": {
                                "type": "string",
                                "enum": ["todo", "doing", "blocked", "done"],
                            },
                            "priority": {"type": "string", "enum": ["low", "med", "high"]},
                            "due_date": {"type": ["string", "null"]},
                            "estimate_hrs": {"type": "number"},
                            "notes": {"type": "string"},
                        },
                        "required": ["title"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["tasks"],
            "additionalProperties": False,
        },
    },
    {
        "name": "update_tasks",
        "description": (
            "Small direct edits the founder explicitly asked for this turn. Anything you "
            "thought of yourself goes through propose_plan instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "updates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "task_id": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["todo", "doing", "blocked", "done"],
                            },
                            "assignee_id": {"type": ["string", "null"]},
                            "due_date": {"type": ["string", "null"]},
                            "priority": {"type": "string", "enum": ["low", "med", "high"]},
                            "estimate_hrs": {"type": "number"},
                            "notes": {"type": "string"},
                            "waiting_on": {"type": ["string", "null"]},
                        },
                        "required": ["task_id"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["updates"],
            "additionalProperties": False,
        },
    },
]


# --- formatting ---------------------------------------------------------------


def _line(state, t):
    bits = [f"{t['id']} {t['title']}", store.person_name(state, t["assignee_id"]), t["status"]]
    if t["due_date"]:
        d = store.days_until(state, t["due_date"])
        bits.append(
            f"due {t['due_date']} ({'overdue by ' + str(-d) + 'd' if d < 0 else str(d) + 'd'})"
        )
    bits.append(f"{t['estimate_hrs']}h")
    if t["waiting_on"]:
        bits.append(f"waiting on {store.person_name(state, t['waiting_on'])}")
    if store.is_stale(state, t):
        bits.append(f"untouched {store.days_since(state, t['last_touched'])}d")
    if t["status"] == "blocked" and t["notes"]:
        bits.append(f"why: {t['notes']}")
    return "  - " + " | ".join(str(b) for b in bits)


def _listing(state, tasks, empty="  (none)"):
    return "\n".join(_line(state, t) for t in tasks) if tasks else empty


def _resolve_person(state, ref):
    if not ref:
        return None
    for p in state["people"]:
        if p["id"] == ref or p["name"].lower() == str(ref).lower():
            return p["id"]
    return ref


# --- tools -------------------------------------------------------------------


def get_overview(state, **_):
    f = state["founder"]
    out = [
        f"{f['business']} — today is {state['clock']['today']}.",
        f"Goal: {f['goal']} by {f['goal_date']} "
        f"({store.days_until(state, f['goal_date'])} days out).",
        "",
    ]
    for p in state["projects"]:
        ts = store.open_tasks(state, p["id"])
        done = [t for t in state["tasks"] if t["project_id"] == p["id"] and t["status"] == "done"]
        hrs = sum(t["estimate_hrs"] for t in ts)
        d = store.days_until(state, p["due_date"])
        out.append(
            f"{p['id']} {p['name']} [{p['status']}] — due {p['due_date']} ({d}d), "
            f"{len(ts)} open / {len(done)} done, {hrs}h left"
        )
    overdue = [t for t in store.open_tasks(state) if store.is_overdue(state, t)]
    stale = [t for t in store.open_tasks(state) if store.is_stale(state, t)]
    blocked = [t for t in store.open_tasks(state) if t["status"] == "blocked"]
    on_founder = [
        t
        for t in store.open_tasks(state)
        if t["waiting_on"] and t["waiting_on"] == _founder_id(state)
    ]
    out += [
        "",
        f"OVERDUE ({len(overdue)}):",
        _listing(state, overdue),
        f"STALE — started, untouched {store.STALE_DAYS}+ days ({len(stale)}):",
        _listing(state, stale),
        f"WAITING ON {store.person_name(state, _founder_id(state)).upper()} ({len(on_founder)}):",
        _listing(state, on_founder),
        f"BLOCKED ({len(blocked)}):",
        _listing(state, blocked),
        "",
        "WORKLOAD (open hours vs weekly capacity):",
    ]
    for p in state["people"]:
        hrs = sum(t["estimate_hrs"] for t in store.open_tasks(state) if t["assignee_id"] == p["id"])
        wks = hrs / p["capacity_hrs_week"] if p["capacity_hrs_week"] else 0
        out.append(
            f"  - {p['name']} ({p['role']}): {hrs}h open vs {p['capacity_hrs_week']}h/wk "
            f"= {wks:.1f} weeks of work"
        )
    unassigned = [t for t in store.open_tasks(state) if not t["assignee_id"]]
    if unassigned:
        out += [f"UNASSIGNED ({len(unassigned)}):", _listing(state, unassigned)]
    pending = [p for p in state["proposals"] if p["status"] == "pending"]
    if pending:
        out += ["", "PENDING PROPOSALS (awaiting a yes):"]
        out += [f"  - {p['id']}: {p['summary']}" for p in pending]
    return "\n".join(out)


def _founder_id(state):
    p = next((p for p in state["people"] if p["role"] == "founder"), None)
    return p["id"] if p else "p1"


def find_tasks(
    state,
    project=None,
    assignee=None,
    status=None,
    overdue=None,
    stale=None,
    waiting_on=None,
    text=None,
    **_,
):
    ts = state["tasks"]
    if project:
        pr = store.project(state, project)
        if not pr:
            return f"No project matching '{project}'. Projects: " + ", ".join(
                f"{p['id']} {p['name']}" for p in state["projects"]
            )
        ts = [t for t in ts if t["project_id"] == pr["id"]]
    if assignee:
        aid = _resolve_person(state, assignee)
        ts = [t for t in ts if t["assignee_id"] == aid]
    if status:
        ts = [t for t in ts if t["status"] == status]
    else:
        ts = [t for t in ts if t["status"] != "done"] if overdue or stale else ts
    if overdue:
        ts = [t for t in ts if store.is_overdue(state, t)]
    if stale:
        ts = [t for t in ts if store.is_stale(state, t)]
    if waiting_on:
        wid = _resolve_person(state, waiting_on)
        ts = [t for t in ts if t["waiting_on"] == wid]
    if text:
        q = text.lower()
        ts = [t for t in ts if q in t["title"].lower() or q in (t["notes"] or "").lower()]
    if not ts:
        return "No tasks match."
    head = f"{len(ts)} task(s):"
    if text and len({t["title"].lower() for t in ts}) < len(ts):
        head += " NOTE — more than one task shares a title; confirm which one before changing it."
    return head + "\n" + _listing(state, ts)


def check_timeline(state, project_id=None, **_):
    pr = store.project(state, project_id)
    if not pr:
        return f"No project '{project_id}'."
    days = store.days_until(state, pr["due_date"])
    ts = store.open_tasks(state, pr["id"])
    if not ts:
        return f"{pr['name']}: nothing open. Due {pr['due_date']}."
    if days <= 0:
        return (
            f"{pr['name']} is past its due date ({pr['due_date']}, {-days}d ago) with "
            f"{sum(t['estimate_hrs'] for t in ts)}h still open across {len(ts)} tasks."
        )
    weeks = days / 7
    out = [
        f"{pr['name']}: due {pr['due_date']}, {days} days ({weeks:.1f} weeks) away.",
        f"Remaining work: {sum(t['estimate_hrs'] for t in ts)}h across {len(ts)} open tasks.",
        "",
    ]
    short = []
    for p in state["people"]:
        hrs = sum(t["estimate_hrs"] for t in ts if t["assignee_id"] == p["id"])
        if not hrs:
            continue
        cap = p["capacity_hrs_week"] * weeks
        slack = cap - hrs
        out.append(
            f"  - {p['name']}: {hrs}h of work vs {cap:.0f}h capacity "
            f"({'SHORT by ' + format(-slack, '.0f') + 'h' if slack < 0 else format(slack, '.0f') + 'h slack'})"
        )
        if slack < 0:
            short.append(f"{p['name']} is {-slack:.0f}h short")
    un = sum(t["estimate_hrs"] for t in ts if not t["assignee_id"])
    if un:
        out.append(f"  - unassigned: {un}h with nobody on it")
    out.append("")
    out.append(
        "Verdict: does NOT fit as planned — " + "; ".join(short) + "."
        if short
        else "Verdict: fits, on these estimates."
    )
    out.append(
        "(Arithmetic only — this ignores task order, drying and firing time, and anything "
        "waiting on someone else.)"
    )
    return "\n".join(out)


def _apply_change(state, ch, session, tool):
    action = ch.get("action", "update_task" if ch.get("task_id") else "create_task")
    if action == "create_task":
        pid = ch.get("project_id")
        if not store.project(state, pid):
            return f"! no project '{pid}', skipped '{ch.get('title')}'"
        t = {
            "id": store.next_id(state["tasks"], "t"),
            "project_id": store.project(state, pid)["id"],
            "title": ch.get("title", "untitled"),
            "assignee_id": ch.get("assignee_id"),
            "status": ch.get("status", "todo"),
            "priority": ch.get("priority", "med"),
            "due_date": ch.get("due_date"),
            "estimate_hrs": ch.get("estimate_hrs", 1),
            "waiting_on": ch.get("waiting_on"),
            "notes": ch.get("notes", ""),
            "last_touched": state["clock"]["today"],
        }
        state["tasks"].append(t)
        s = f"created {t['id']} '{t['title']}' in {t['project_id']}"
    else:
        t = store.task(state, ch.get("task_id"))
        if not t:
            return f"! no task '{ch.get('task_id')}', skipped"
        changed = []
        for f in FIELDS:
            if f in ch and ch[f] != t.get(f):
                changed.append(f"{f}: {t.get(f)} -> {ch[f]}")
                t[f] = ch[f]
        if "title" in ch:
            changed.append(f"title -> {ch['title']}")
            t["title"] = ch["title"]
        if not changed:
            return f"= {t['id']} '{t['title']}' unchanged"
        t["last_touched"] = state["clock"]["today"]
        s = f"{t['id']} '{t['title']}': " + "; ".join(changed)
    store.log_change(state, session, tool, s)
    return s


def propose_plan(state, summary=None, reason=None, changes=None, session=None, **_):
    pp = {
        "id": store.next_id(state["proposals"], "pp"),
        "summary": summary,
        "reason": reason,
        "changes": changes or [],
        "status": "pending",
        "created": state["clock"]["today"],
    }
    state["proposals"].append(pp)
    lines = [
        f"Proposal {pp['id']} created — PENDING, nothing has changed yet.",
        f"Summary: {summary}",
        f"Reason: {reason}",
        "Changes it would make:",
    ]
    for i, ch in enumerate(pp["changes"]):
        if ch.get("action") == "create_task":
            lines.append(f"  [{i}] create '{ch.get('title')}' in {ch.get('project_id')}")
        else:
            flds = ", ".join(f"{f}={ch[f]}" for f in (*FIELDS, "title") if f in ch)
            t = store.task(state, ch.get("task_id"))
            lines.append(f"  [{i}] {ch.get('task_id')} '{t['title'] if t else '?'}' -> {flds}")
    lines.append("Now tell the founder in your own words and ask for a yes.")
    return "\n".join(lines)


def _proposal(state, pid):
    return next((p for p in state["proposals"] if p["id"] == pid), None)


def apply_proposal(state, proposal_id=None, approved_changes=None, session=None, **_):
    pp = _proposal(state, proposal_id)
    if not pp:
        return f"No proposal '{proposal_id}'."
    if pp["status"] != "pending":
        return f"{proposal_id} is already {pp['status']}. Nothing applied."
    idxs = range(len(pp["changes"])) if approved_changes is None else approved_changes
    results = []
    for i in idxs:
        if 0 <= i < len(pp["changes"]):
            results.append(_apply_change(state, pp["changes"][i], session, "apply_proposal"))
    pp["status"] = "approved" if approved_changes is None else "modified"
    pp["applied"] = list(idxs)
    store.log_change(
        state, session, "apply_proposal", f"{proposal_id} {pp['status']}: {pp['summary']}"
    )
    return f"{proposal_id} {pp['status']}. Applied:\n" + "\n".join(f"  - {r}" for r in results)


def reject_proposal(state, proposal_id=None, note=None, session=None, **_):
    pp = _proposal(state, proposal_id)
    if not pp:
        return f"No proposal '{proposal_id}'."
    if pp["status"] != "pending":
        return f"{proposal_id} is already {pp['status']}."
    pp["status"] = "rejected"
    pp["reason"] = note or ""
    store.log_change(state, session, "reject_proposal", f"{proposal_id} rejected: {note or ''}")
    return f"{proposal_id} marked rejected. Nothing changed. Don't raise it again this session."


def create_tasks(state, project_id=None, new_project=None, tasks=None, session=None, **_):
    if new_project:
        pr = {
            "id": store.next_id(state["projects"], "pr"),
            "name": new_project["name"],
            "status": "active",
            "due_date": new_project.get("due_date"),
            "why_it_matters": new_project.get("why_it_matters", ""),
        }
        state["projects"].append(pr)
        store.log_change(
            state, session, "create_tasks", f"created project {pr['id']} '{pr['name']}'"
        )
        project_id = pr["id"]
    pr = store.project(state, project_id)
    if not pr:
        return f"No project '{project_id}'. Pass new_project to make one."
    out = [
        _apply_change(
            state, dict(t, action="create_task", project_id=pr["id"]), session, "create_tasks"
        )
        for t in (tasks or [])
    ]
    return f"In {pr['id']} {pr['name']}:\n" + "\n".join(f"  - {o}" for o in out)


def update_tasks(state, updates=None, session=None, **_):
    out = [
        _apply_change(state, dict(u, action="update_task"), session, "update_tasks")
        for u in (updates or [])
    ]
    return "\n".join(f"  - {o}" for o in out) or "Nothing to update."


REGISTRY = {
    "get_overview": get_overview,
    "find_tasks": find_tasks,
    "check_timeline": check_timeline,
    "propose_plan": propose_plan,
    "apply_proposal": apply_proposal,
    "reject_proposal": reject_proposal,
    "create_tasks": create_tasks,
    "update_tasks": update_tasks,
}


def run(name, args, state, session):
    fn = REGISTRY.get(name)
    if not fn:
        return f"Unknown tool '{name}'."
    try:
        return fn(state, session=session, **args)
    except Exception as e:  # a tool crash is a finding, not a session-ender
        return f"Tool error in {name}: {type(e).__name__}: {e}"
