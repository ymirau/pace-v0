"""The support form's API: validation, the email it sends, and the log row.

The mailer is a fake (``dependency_overrides``), so nothing reaches a relay.
Runs on conftest's ``client``, whose session rolls back, so log rows don't
persist. Auth is covered by test_auth_guard.py.
"""

from collections.abc import Callable, Iterator

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.routers.support import current_environment
from app.services.mailer import OutgoingEmail, get_mailer
from app.sources.postgres.models.support_request import SupportRequest
from main import app

FORM = {
    "kind": "Problem",
    "subject": "Save fails",
    "details": "It spins.",
    "diagnostics": "Build: 1",
}
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


class FakeMailer:
    def __init__(self, error: Exception | None = None) -> None:
        self.sent: list[OutgoingEmail] = []
        self._error = error

    def send(self, message: OutgoingEmail) -> str:
        if self._error:
            raise self._error
        self.sent.append(message)
        return message.to


@pytest.fixture
def use() -> Iterator[Callable[..., FakeMailer]]:
    def _use(mailer: FakeMailer | None = None, **settings: object) -> FakeMailer:
        mailer = mailer or FakeMailer()
        values = {"support_email": "help@example.com", "mail_enabled": True, **settings}
        configured = get_settings().model_copy(update=values)
        app.dependency_overrides[get_settings] = lambda: configured
        app.dependency_overrides[get_mailer] = lambda: mailer
        return mailer

    yield _use


async def test_config_reports_the_address(
    client: AsyncClient, use: Callable[..., FakeMailer]
) -> None:
    use()
    response = await client.get("/api/support/config")
    assert response.json() == {"support_email": "help@example.com", "configured": True}


async def test_config_unconfigured(client: AsyncClient, use: Callable[..., FakeMailer]) -> None:
    use(support_email="")
    response = await client.get("/api/support/config")
    assert response.json() == {"support_email": "", "configured": False}


async def test_sends_to_support_with_reply_to_the_sender(
    client: AsyncClient, use: Callable[..., FakeMailer], db_session: AsyncSession
) -> None:
    mailer = use()
    response = await client.post("/api/support", data=FORM)
    assert response.status_code == 200
    assert response.json() == {"status": "sent", "recorded": True}
    (message,) = mailer.sent
    assert message.to == "help@example.com"
    assert message.reply_to == "tester@example.com"
    assert message.subject.endswith("/ loc] Problem: Save fails")
    assert message.text.startswith("It spins.\n\n---\n")
    assert message.text.endswith("Build: 1")
    row = (await db_session.execute(select(SupportRequest))).scalars().one()
    assert (row.status, row.kind, row.sender_email) == ("sent", "Problem", "tester@example.com")


async def test_says_disabled_when_mail_is_off(
    client: AsyncClient, use: Callable[..., FakeMailer]
) -> None:
    use(mail_enabled=False)
    response = await client.post("/api/support", data=FORM)
    assert response.json()["status"] == "disabled"


async def test_photos_ride_along(client: AsyncClient, use: Callable[..., FakeMailer]) -> None:
    mailer = use()
    files = [("images", ("shot.png", PNG, "image/png"))]
    response = await client.post("/api/support", data=FORM, files=files)
    assert response.status_code == 200
    (attachment,) = mailer.sent[0].attachments
    assert (attachment.filename, attachment.content_type) == ("shot.png", "image/png")


@pytest.mark.parametrize(
    ("form", "files", "detail"),
    [
        ({**FORM, "kind": "Rant"}, None, "Kind must be one of"),
        ({**FORM, "subject": "  "}, None, "Subject is required."),
        ({**FORM, "details": ""}, None, "Details is required."),
        (FORM, [("images", ("a.txt", b"hi", "text/plain"))], "cannot be attached"),
        (FORM, [("images", (f"{n}.png", PNG, "image/png")) for n in range(4)], "At most 3"),
    ],
)
async def test_refuses_bad_input_with_a_readable_422(
    client: AsyncClient,
    use: Callable[..., FakeMailer],
    form: dict[str, str],
    files: list | None,
    detail: str,
) -> None:
    mailer = use()
    response = await client.post("/api/support", data=form, files=files)
    assert response.status_code == 422
    assert detail in response.json()["detail"]
    assert mailer.sent == []


async def test_409_without_a_support_address(
    client: AsyncClient, use: Callable[..., FakeMailer]
) -> None:
    use(support_email="")
    response = await client.post("/api/support", data=FORM)
    assert response.status_code == 409


async def test_502_and_failed_row_when_the_relay_refuses(
    client: AsyncClient, use: Callable[..., FakeMailer], db_session: AsyncSession
) -> None:
    use(FakeMailer(error=OSError("relay down")))
    response = await client.post("/api/support", data=FORM)
    assert response.status_code == 502
    row = (await db_session.execute(select(SupportRequest))).scalars().one()
    assert (row.status, row.error) == ("failed", "relay down")


@pytest.mark.parametrize(
    ("env_name", "code"),
    # One per line (with the trailing comma) so a longer app slug can't push it past
    # the line limit once /syn-init-webapp renames pace.
    [
        ("", "loc"),
        ("pace-sbx", "sbx"),
        ("pace-uat", "uat"),
        ("pace-prod", "prd"),
    ],
)
def test_current_environment(env_name: str, code: str) -> None:
    assert current_environment(get_settings().model_copy(update={"env_name": env_name})) == code
