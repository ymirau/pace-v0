"""One world per visitor, one log across all of them.

Both halves of this are easy to break by accident and silent when broken, which is why
they are pinned here rather than left to a manual check:

* **Isolation is what makes the ratings comparable.** Before visitors existed there was
  a single state document and `latest_session_id` returned the newest session for
  anybody, so the second person on the review link opened the first person's world —
  planted problems already cleaned up — and joined their conversation mid-thread. Both
  of them then rated "the app", and nothing in the log recorded that they had not been
  shown the same app.
* **The log must stay universal anyway.** Partitioning state and partitioning evidence
  are different decisions; getting the second one by accident would mean the viewer
  silently showed one browser's transcripts.

These exercise the real routes against Postgres (rolled back after each test), not the
helpers, because the bug being guarded against was a missing argument at the call site.
"""

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import get_current_user
from app.core.visitor import SOLO
from app.services.state_store import SOLO_KEY, state_key
from app.sources.postgres.session import get_session
from main import app

ALICE = {"X-Pace-Visitor": "alice0001"}
BOB = {"X-Pace-Visitor": "bob00002"}


def test_solo_keeps_the_pre_visitor_state_key() -> None:
    """`solo` must map to the row that existed before visitors did.

    Local dev, the terminal spike and anything already stored in Neon live under
    'current'. If this ever returns 'v:solo' instead, that work is not deleted but it IS
    orphaned — the app would silently open a freshly seeded world and the founder's real
    tasks would appear to be gone.
    """
    assert state_key(SOLO) == SOLO_KEY == "current"


def test_a_visitor_id_cannot_collide_with_the_solo_key() -> None:
    """A client cannot reach the `current` row by naming a key.

    `v:` namespacing stops "current" from being claimed; `SOLO` is refused by the
    dependency instead (below), because it has to keep mapping to the legacy row.
    """
    assert state_key("current") == "v:current"
    assert state_key("anything") == "v:anything"


@pytest.mark.parametrize(
    "bad",
    [
        "a" * 65,  # longer than the column deserves
        "has space",
        "quote'drop",
        "slash/path",
        "semi;colon",
    ],
)
async def test_a_malformed_visitor_id_is_refused(client: AsyncClient, bad: str) -> None:
    """It is a client-supplied database key, so the charset is enforced at the edge."""
    response = await client.get("/api/chat/state", headers={"X-Pace-Visitor": bad})
    assert response.status_code == 400


async def test_a_client_cannot_claim_to_be_solo(client: AsyncClient) -> None:
    """`solo` is the developer's own pre-visitor world. It must not be reachable by
    typing a guessable word into devtools on the review link."""
    response = await client.get("/api/chat/state", headers={"X-Pace-Visitor": SOLO})
    assert response.status_code == 400


async def test_no_visitor_header_is_solo(client: AsyncClient) -> None:
    """curl and the terminal spike send nothing and must still work."""
    assert (await client.get("/api/chat/state")).status_code == 200


async def test_two_visitors_do_not_share_a_world(client: AsyncClient) -> None:
    """The guarantee the whole change exists for.

    Alice rebuilds her world from a different seed; Bob must still be looking at his.
    `/reset` is used because it changes state without spending a model call.
    """
    assert (
        await client.post("/api/chat/reset", json={"seed": "ceramics"}, headers=ALICE)
    ).status_code == 200
    assert (
        await client.post("/api/chat/reset", json={"seed": "startup"}, headers=BOB)
    ).status_code == 200

    alice = (await client.get("/api/chat/state", headers=ALICE)).json()
    bob = (await client.get("/api/chat/state", headers=BOB)).json()
    assert alice["seed"] == "ceramics", "Bob's reset reached Alice's world"
    assert bob["seed"] == "startup"


async def test_a_new_visitor_gets_a_fresh_world_not_someone_elses(client: AsyncClient) -> None:
    """ "The app is the exact same after every user saves": a newcomer sees the seed.

    Alice switches her world to the ceramics fixture and only then does Carol arrive.
    Carol must get the configured default, not whatever Alice left behind.
    """
    await client.post("/api/chat/reset", json={"seed": "ceramics"}, headers=ALICE)
    carol = (await client.get("/api/chat/state", headers={"X-Pace-Visitor": "carol003"})).json()
    assert carol["seed"] == get_settings().pace_seed


async def test_the_log_sees_every_visitor(client: AsyncClient) -> None:
    """Isolated worlds, one shared body of evidence — and labelled, so they can be told
    apart. A reset creates the session row, which is all the listing needs."""
    await client.post("/api/chat/reset", json={"seed": "startup"}, headers=ALICE)
    await client.post("/api/chat/reset", json={"seed": "startup"}, headers=BOB)

    sessions = (await client.get("/api/log/sessions")).json()
    visitors = {s["visitor"] for s in sessions}
    assert {"alice0001", "bob00002"} <= visitors

    # And the aggregate is per browser, so one keen reviewer reads as one reviewer.
    stats = (await client.get("/api/log/stats")).json()
    assert "alice0001" in stats["by_visitor"]
    assert "bob00002" in stats["by_visitor"]


@pytest_asyncio.fixture
async def gated_client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """A client with BOTH codes configured, to prove they are not interchangeable."""

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    def override_get_current_user() -> dict:
        return {"sub": "test-user", "preferred_username": "tester@example.com"}

    def override_get_settings() -> Settings:
        return get_settings().model_copy(
            update={"pace_access_code": "reviewer-code", "pace_viewer_code": "viewer-code"}
        )

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_settings] = override_get_settings
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


async def test_the_reviewer_code_does_not_open_the_log(gated_client: AsyncClient) -> None:
    """The point of a second secret.

    Everyone with the review link shares one access code. If that code also read
    `/api/log`, handing it out would hand out every other reviewer's transcript and every
    note written about the agent's replies.
    """
    response = await gated_client.get(
        "/api/log/stats", headers={"X-Pace-Access-Code": "reviewer-code"}
    )
    assert response.status_code == 401


async def test_the_viewer_code_opens_the_log(gated_client: AsyncClient) -> None:
    response = await gated_client.get(
        "/api/log/stats", headers={"X-Pace-Viewer-Code": "viewer-code"}
    )
    assert response.status_code == 200


async def test_the_viewer_code_does_not_open_the_chat(gated_client: AsyncClient) -> None:
    """And the reverse: reading the log must not buy a conversation on the bill."""
    response = await gated_client.get(
        "/api/chat/state", headers={"X-Pace-Viewer-Code": "viewer-code"}
    )
    assert response.status_code == 401
