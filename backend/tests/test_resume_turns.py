"""Turn numbering survives a cold process with the right value.

Ratings are keyed on (session_id, turn), and the whole point of v0 is the ratings, so a
turn number that shifts when the process restarts silently attaches a verdict to a reply
nobody gave. That is not a cosmetic bug — it is the evidence going wrong quietly.

The trap: the Messages API has only two roles, so a `tool_result` is appended with role
`"user"` exactly like something the founder typed. Counting every user message made two
real turns plus three tool results resume as turn 5, and the reply replayed when the app
reopened was then rated against a turn with no reply in the log. Observed on the
deployed app, not imagined: `role=user` split 2 string / 3 array in `chat_sessions`.

A real turn is the string form; tool results are always a list of content blocks.
"""

from app.routers.chat import _resumed_turn_count


def _user(text: str) -> dict:
    """What the router appends for something the founder typed."""
    return {"role": "user", "content": text}


def _tool_result(tool_use_id: str) -> dict:
    """What the engine appends after running a tool — also role 'user'."""
    return {
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "content": "ok"}],
    }


def _assistant(*blocks: dict) -> dict:
    return {"role": "assistant", "content": list(blocks)}


def test_empty_history_is_turn_zero() -> None:
    assert _resumed_turn_count([]) == 0


def test_tool_results_are_not_turns() -> None:
    """The exact shape the deployed session had: 2 typed turns, 3 tool results."""
    history = [
        _user("[session_open]"),
        _assistant({"type": "tool_use", "id": "a"}),
        _tool_result("a"),
        _assistant({"type": "tool_use", "id": "b"}),
        _tool_result("b"),
        _assistant({"type": "text", "text": "hello"}),
        _user("add a task"),
        _assistant({"type": "tool_use", "id": "c"}),
        _tool_result("c"),
        _assistant({"type": "text", "text": "added"}),
    ]
    assert _resumed_turn_count(history) == 2, "counted tool results as turns"


def test_count_matches_a_live_session() -> None:
    """Resuming must land on the same number the live agent would have reached.

    The live agent increments once per `send()`. Replaying the same conversation from
    storage has to agree, or a rating made before a restart and one made after point at
    different replies.
    """
    history: list[dict] = []
    live_turns = 0
    for text in ["[session_open]", "add a task", "yes", "what about the glaze?"]:
        history.append(_user(text))
        live_turns += 1
        history.append(_assistant({"type": "tool_use", "id": text[:2]}))
        history.append(_tool_result(text[:2]))
        history.append(_assistant({"type": "text", "text": "ok"}))
    assert _resumed_turn_count(history) == live_turns == 4
