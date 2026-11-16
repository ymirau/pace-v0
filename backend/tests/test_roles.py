"""Roles: resolving the caller's role, ``GET /api/me``, and the user-roles API.

Runs on conftest's ``client`` (its session rolls back, so nothing persists). Each
test starts from an empty ``user_roles`` table inside that transaction, so the
seeded bootstrap admin never skews the counts. Auth is covered by test_auth_guard.py.
"""

from collections.abc import Awaitable, Callable, Iterator

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.roles import resolve_role
from app.core.security import get_current_user
from app.sources.postgres.models.user_role import UserRole
from main import app

ME = "tester@example.com"  # conftest's signed-in user
OTHER = "other@example.com"


Roles = Callable[..., Awaitable[dict[str, int]]]


@pytest_asyncio.fixture
async def roles(db_session: AsyncSession) -> Roles:
    """Replace the table's rows (inside the test's transaction) with ``{email: role}``."""
    await db_session.execute(delete(UserRole))

    async def _set(rows: dict[str, str] | None = None) -> dict[str, int]:
        ids: dict[str, int] = {}
        for email, role in (rows or {}).items():
            row = UserRole(email=email, role=role)
            db_session.add(row)
            await db_session.flush()
            ids[email] = row.id
        return ids

    return _set


@pytest.fixture
def as_user() -> Iterator[Callable[[str], None]]:
    def _as(email: str) -> None:
        app.dependency_overrides[get_current_user] = lambda: {
            "sub": "id",
            "preferred_username": email,
        }

    yield _as


@pytest.fixture(autouse=True)
def auth_on() -> Iterator[None]:
    """Real role lookups, whatever a local backend/.env says about AUTH_DISABLED."""
    settings = get_settings().model_copy(update={"auth_disabled": False})
    app.dependency_overrides[get_settings] = lambda: settings
    yield


# --- Resolving a role ---------------------------------------------------------


async def test_no_row_is_a_user(client: AsyncClient, roles: Roles) -> None:
    await roles()
    assert (await client.get("/api/me")).json() == {
        "email": ME,
        "name": ME,
        "role": "user",
    }


async def test_admin_row_is_an_admin_case_insensitively(
    client: AsyncClient, roles: Roles, as_user: Callable[[str], None]
) -> None:
    await roles({"jane.doe@example.com": "admin"})
    as_user("Jane.Doe@example.com")
    assert (await client.get("/api/me")).json()["role"] == "admin"


async def test_unknown_stored_role_is_a_user() -> None:
    class FakeResult:
        def scalar_one_or_none(self) -> str:
            return "superuser"

    class FakeSession:
        async def execute(self, _: object) -> FakeResult:
            return FakeResult()

    settings = get_settings().model_copy(update={"auth_disabled": False})
    user = {"preferred_username": ME}
    assert await resolve_role(user, FakeSession(), settings) == "user"  # type: ignore[arg-type]


async def test_unreadable_table_is_a_user_and_rolls_back() -> None:
    rolled_back: list[bool] = []

    class BrokenSession:
        async def execute(self, _: object) -> None:
            raise RuntimeError('relation "pace.user_roles" does not exist')

        async def rollback(self) -> None:
            rolled_back.append(True)

    settings = get_settings().model_copy(update={"auth_disabled": False})
    user = {"preferred_username": ME}
    assert await resolve_role(user, BrokenSession(), settings) == "user"  # type: ignore[arg-type]
    assert rolled_back == [True]


async def test_auth_disabled_is_an_admin() -> None:
    settings = get_settings().model_copy(update={"auth_disabled": True})
    assert await resolve_role({"sub": "dev"}, None, settings) == "admin"  # type: ignore[arg-type]


async def test_no_email_is_a_user(client: AsyncClient, as_user: Callable[[str], None]) -> None:
    as_user("not-an-address")
    assert (await client.get("/api/me")).json()["role"] == "user"


# --- The user-roles API -------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/user-roles"),
        ("POST", "/api/user-roles"),
        ("PATCH", "/api/user-roles/1"),
        ("DELETE", "/api/user-roles/1"),
    ],
)
async def test_users_get_403_everywhere(
    client: AsyncClient, roles: Roles, method: str, path: str
) -> None:
    await roles()
    body = {"email": OTHER, "role": "admin"} if method != "DELETE" else None
    response = await client.request(method, path, json=body)
    assert response.status_code == 403
    assert response.json()["detail"] == "You need the admin role for this."


async def test_admin_lists_adds_changes_and_removes(client: AsyncClient, roles: Roles) -> None:
    await roles({ME: "admin"})
    added = await client.post(
        "/api/user-roles", json={"email": "  New@example.com ", "role": "admin"}
    )
    assert added.status_code == 201
    row = added.json()
    assert (row["email"], row["role"]) == ("new@example.com", "admin")
    assert row["display_name"] is None

    listed = (await client.get("/api/user-roles")).json()
    assert [r["email"] for r in listed] == ["new@example.com", ME]

    changed = await client.patch(f"/api/user-roles/{row['id']}", json={"role": "user"})
    assert changed.json()["role"] == "user"

    assert (await client.delete(f"/api/user-roles/{row['id']}")).status_code == 204
    assert (await client.delete(f"/api/user-roles/{row['id']}")).status_code == 404


async def test_add_stores_the_trimmed_display_name(client: AsyncClient, roles: Roles) -> None:
    await roles({ME: "admin"})
    named = await client.post(
        "/api/user-roles",
        json={"email": "named@example.com", "role": "admin", "display_name": "  Pat Lee "},
    )
    assert (named.status_code, named.json()["display_name"]) == (201, "Pat Lee")
    blank = await client.post(
        "/api/user-roles",
        json={"email": "blank@example.com", "role": "admin", "display_name": "   "},
    )
    assert (blank.status_code, blank.json()["display_name"]) == (201, None)


async def test_add_refuses_a_non_address_and_a_duplicate(client: AsyncClient, roles: Roles) -> None:
    await roles({ME: "admin", OTHER: "admin"})
    bad = await client.post("/api/user-roles", json={"email": "jane", "role": "admin"})
    assert (bad.status_code, bad.json()["detail"]) == (422, "Enter an email address.")
    dup = await client.post("/api/user-roles", json={"email": "OTHER@example.com", "role": "admin"})
    assert (dup.status_code, dup.json()["detail"]) == (409, f"{OTHER} already has a role.")
    unknown = await client.post("/api/user-roles", json={"email": "x@y.z", "role": "owner"})
    assert unknown.status_code == 422


async def test_missing_row_is_404(client: AsyncClient, roles: Roles) -> None:
    await roles({ME: "admin"})
    response = await client.patch("/api/user-roles/999999", json={"role": "user"})
    assert (response.status_code, response.json()["detail"]) == (
        404,
        "That user's role was already removed.",
    )


async def test_cannot_change_or_remove_own_row(client: AsyncClient, roles: Roles) -> None:
    ids = await roles({ME: "admin", OTHER: "admin"})
    mine = ids[ME]
    for response in (
        await client.patch(f"/api/user-roles/{mine}", json={"role": "user"}),
        await client.delete(f"/api/user-roles/{mine}"),
    ):
        assert response.status_code == 409
        assert response.json()["detail"] == "You can't change your own role. Ask another admin."


async def test_cannot_remove_or_demote_the_last_admin(client: AsyncClient, roles: Roles) -> None:
    # The caller must be an admin who isn't that row: the AUTH_DISABLED dev user is
    # exactly that (an admin with no row), so it never counts as "another admin".
    ids = await roles({OTHER: "admin"})
    settings = get_settings().model_copy(update={"auth_disabled": True})
    app.dependency_overrides[get_settings] = lambda: settings
    for response in (
        await client.patch(f"/api/user-roles/{ids[OTHER]}", json={"role": "user"}),
        await client.delete(f"/api/user-roles/{ids[OTHER]}"),
    ):
        assert response.status_code == 409
        assert response.json()["detail"] == "This is the last admin; add another admin first."


async def test_demoting_one_of_two_admins_is_allowed(
    client: AsyncClient, roles: Roles, as_user: Callable[[str], None]
) -> None:
    ids = await roles({ME: "admin", OTHER: "admin"})
    as_user(OTHER)
    response = await client.patch(f"/api/user-roles/{ids[ME]}", json={"role": "user"})
    assert (response.status_code, response.json()["role"]) == (200, "user")
