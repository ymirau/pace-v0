"""Reading the chat log — one implementation, two scopes.

The log is served twice, to two different audiences:

* **`/api/log`** (the viewer at `/viewer`, behind `PACE_VIEWER_CODE`) reads across every
  visitor. It is the evidence v0 exists to produce.
* **`/api/my-log`** (the Log page inside the app, behind the ordinary reviewer code)
  reads one visitor's own sessions, so somebody can see what they themselves rated
  without being handed everyone else's transcripts and the notes written about them.

Both go through the functions here with `visitor=None` or `visitor="<id>"`. Keeping it
in one place is not tidiness: two hand-written copies of this arithmetic would eventually
disagree about what "rated" means, and the whole point of the log is that its numbers can
be trusted. The scoped routes also have to filter *every* query — sessions, events,
ratings and the detail lookup — and a filter forgotten in one of four places is a quiet
leak rather than a visible bug.

Read-only by design: nothing here edits or deletes a log line. An append-only record is
only worth something if it cannot be tidied up after the fact.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.log import Event, SessionDetail, SessionSummary, Stats
from app.sources.postgres.models.chat import ChatEvent, ChatRating, ChatSession


async def summaries(
    db: AsyncSession, ids: list[str] | None = None, visitor: str | None = None
) -> list[SessionSummary]:
    """Session rows with their turn and rating counts, newest first.

    `visitor=None` means every visitor; a value scopes it to one browser.
    """
    q = select(ChatSession).order_by(ChatSession.updated_at.desc())
    if ids is not None:
        q = q.where(ChatSession.id.in_(ids))
    if visitor is not None:
        q = q.where(ChatSession.visitor == visitor)
    sessions = (await db.execute(q)).scalars().all()
    if not sessions:
        return []
    # Everything below is keyed off the sessions already selected, so the visitor filter
    # above is the only place scoping has to be applied — a session that isn't in `keys`
    # contributes nothing to any count.
    keys = [s.id for s in sessions]

    counts = {
        (sid, t): n
        for sid, t, n in (
            await db.execute(
                select(ChatEvent.session_id, ChatEvent.type, func.count())
                .where(ChatEvent.session_id.in_(keys))
                .group_by(ChatEvent.session_id, ChatEvent.type)
            )
        ).all()
    }
    # avg() ignores NULLs, which is what we want: a feel-only rating has no cleanup
    # score and must not be averaged in as a zero.
    rated = {
        sid: (n, avg)
        for sid, n, avg in (
            await db.execute(
                select(ChatRating.session_id, func.count(), func.avg(ChatRating.score))
                .where(ChatRating.session_id.in_(keys))
                .group_by(ChatRating.session_id)
            )
        ).all()
    }
    by_feel = {
        (sid, feel): n
        for sid, feel, n in (
            await db.execute(
                select(ChatRating.session_id, ChatRating.feel, func.count())
                .where(ChatRating.session_id.in_(keys))
                .group_by(ChatRating.session_id, ChatRating.feel)
            )
        ).all()
    }
    out = []
    for s in sessions:
        n, avg = rated.get(s.id, (0, None))
        out.append(
            SessionSummary(
                id=s.id,
                started_at=s.started_at,
                updated_at=s.updated_at,
                model=s.model,
                prompt_version=s.prompt_version,
                seed=s.seed,
                visitor=s.visitor,
                sim_today=s.sim_today.isoformat() if s.sim_today else None,
                business=(s.founder or {}).get("business") or None,
                turns=counts.get((s.id, "assistant"), 0),
                tool_calls=counts.get((s.id, "tool_call"), 0),
                rated=n,
                magic=by_feel.get((s.id, "magic"), 0),
                annoying=by_feel.get((s.id, "annoying"), 0),
                avg_score=round(float(avg), 2) if avg is not None else None,
            )
        )
    return out


async def detail(
    db: AsyncSession, session_id: str, visitor: str | None = None
) -> SessionDetail | None:
    """One session's full transcript, or None when it isn't this caller's to read.

    The `visitor` filter runs through `summaries`, so a scoped caller asking for a
    session id that isn't theirs gets None — indistinguishable from a session that does
    not exist, which is the point. Without that, the in-app Log page would hand any
    reviewer any other reviewer's transcript to anyone who guessed an 8-character id.
    """
    found = await summaries(db, [session_id], visitor)
    if not found:
        return None
    events = (
        (
            await db.execute(
                select(ChatEvent).where(ChatEvent.session_id == session_id).order_by(ChatEvent.seq)
            )
        )
        .scalars()
        .all()
    )
    ratings = (
        (await db.execute(select(ChatRating).where(ChatRating.session_id == session_id)))
        .scalars()
        .all()
    )
    return SessionDetail(
        session=found[0],
        events=[
            Event(seq=e.seq, type=e.type, created_at=e.created_at, payload=e.payload or {})
            for e in events
        ],
        ratings={r.turn: {"score": r.score, "feel": r.feel, "note": r.note} for r in ratings},
    )


def _empty_group() -> dict:
    return {
        "turns": 0,
        "sessions": 0,
        "rated": 0,
        "magic": 0,
        "annoying": 0,
        "avg_score": None,
        "_sum": 0,
        "_n": 0,
    }


async def stats(db: AsyncSession, visitor: str | None = None) -> Stats:
    """The numbers the v0 verdict needs, computed from the log rather than by hand."""
    q = select(ChatSession)
    if visitor is not None:
        q = q.where(ChatSession.visitor == visitor)
    sessions = (await db.execute(q)).scalars().all()
    ids = [s.id for s in sessions]

    # Scoped by session id rather than re-deriving the filter, so events and ratings can
    # never fall out of step with the sessions above.
    if visitor is None:
        events = (await db.execute(select(ChatEvent))).scalars().all()
        ratings = (await db.execute(select(ChatRating))).scalars().all()
    elif ids:
        events = (
            (await db.execute(select(ChatEvent).where(ChatEvent.session_id.in_(ids))))
            .scalars()
            .all()
        )
        ratings = (
            (await db.execute(select(ChatRating).where(ChatRating.session_id.in_(ids))))
            .scalars()
            .all()
        )
    else:
        events, ratings = [], []

    version_by_session = {s.id: s.prompt_version for s in sessions}
    visitor_by_session = {s.id: s.visitor for s in sessions}
    assistant = [e for e in events if e.type == "assistant"]
    # A rating is a feel; the cleanup score is optional and often added later, so the
    # two are counted separately. Averaging over "every rating" would silently treat
    # a feel-only rating as a zero.
    scores = [r.score for r in ratings if r.score is not None]

    # Always all three keys, so the page can show "0 annoying" rather than nothing.
    feels: dict[str, int] = {"magic": 0, "meh": 0, "annoying": 0}
    for r in ratings:
        feels[r.feel] = feels.get(r.feel, 0) + 1

    proposals: dict[str, int] = {}
    for e in events:
        if e.type == "proposal":
            outcome = (e.payload or {}).get("outcome", "unknown")
            proposals[outcome] = proposals.get(outcome, 0) + 1
    # A proposal the agent made that was never resolved reads as ignored, which is a
    # real outcome: the thesis says the founder just says yes.
    made = sum(
        1
        for e in events
        if e.type == "tool_call" and (e.payload or {}).get("name") == "propose_plan"
    )
    applied = sum(
        1
        for e in events
        if e.type == "tool_call" and (e.payload or {}).get("name") == "apply_proposal"
    )
    rejected = sum(
        1
        for e in events
        if e.type == "tool_call" and (e.payload or {}).get("name") == "reject_proposal"
    )
    proposals.setdefault("proposed", made)
    proposals.setdefault("applied", applied)
    proposals.setdefault("rejected", rejected)
    proposals.setdefault("unresolved", max(made - applied - rejected, 0))

    def grouped(label_of: dict[str, str]) -> dict[str, dict]:
        """Turns and verdicts bucketed by whatever `label_of` maps a session to.

        Prompt version and visitor are the same arithmetic over a different key, and the
        cleanup average has one trap worth keeping in one place: `avg_score` is over
        ratings that actually carry a score, never over every rating, or a feel-only
        verdict would be averaged in as a zero and flatter the result.
        """
        out: dict[str, dict] = {}
        for sid in label_of:
            out.setdefault(label_of[sid], _empty_group())["sessions"] += 1
        for e in assistant:
            out.setdefault(label_of.get(e.session_id, "?"), _empty_group())["turns"] += 1
        for r in ratings:
            slot = out.setdefault(label_of.get(r.session_id, "?"), _empty_group())
            slot["rated"] += 1
            if r.feel in ("magic", "annoying"):
                slot[r.feel] += 1
            if r.score is not None:
                slot["_sum"] += r.score
                slot["_n"] += 1
        for slot in out.values():
            slot["avg_score"] = round(slot["_sum"] / slot["_n"], 2) if slot["_n"] else None
            slot.pop("_sum")
            slot.pop("_n")
        return out

    return Stats(
        sessions=len(sessions),
        turns=len(assistant),
        proactive_turns=sum(1 for e in assistant if (e.payload or {}).get("proactive")),
        tool_calls=sum(1 for e in events if e.type == "tool_call"),
        cap_hits=sum(1 for e in assistant if (e.payload or {}).get("cap_hit")),
        rated=len(ratings),
        scored=len(scores),
        avg_score=round(sum(scores) / len(scores), 2) if scores else None,
        pct_rated_zero=(
            round(100 * sum(1 for s in scores if s == 0) / len(scores), 1) if scores else None
        ),
        feels=feels,
        proposals=proposals,
        by_prompt_version=grouped(version_by_session),
        by_visitor=grouped(visitor_by_session),
    )
