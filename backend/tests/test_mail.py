"""The mailer — no relay, no database: checked against a fake ``smtplib.SMTP``."""

import logging
from email.message import EmailMessage
from typing import ClassVar

import pytest

from app.core.config import get_settings
from app.services import mailer as mailer_module
from app.services.mailer import OutgoingEmail, SmtpMailer, redirected

MESSAGE = OutgoingEmail(to="pat@example.com", subject="Hi", text="Body", html="<p>Body</p>")
ON = {
    "mail_enabled": True,
    "mail_smtp_host": "relay.example",
    "mail_sender": "no-reply@example.com",
    "mail_redirect_to": "",
}


class FakeSMTP:
    """Records what SmtpMailer does with the connection."""

    sent: ClassVar[list[EmailMessage]] = []
    calls: ClassVar[list[str]] = []

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.calls.append(f"connect {host}:{port}")

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def ehlo(self) -> None:
        self.calls.append("ehlo")

    def starttls(self) -> None:
        self.calls.append("starttls")

    def send_message(self, email: EmailMessage) -> None:
        self.sent.append(email)


@pytest.fixture
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> type[FakeSMTP]:
    FakeSMTP.sent = []
    FakeSMTP.calls = []
    monkeypatch.setattr(mailer_module.smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


def _mailer(**values: object) -> SmtpMailer:
    return SmtpMailer(get_settings().model_copy(update={**ON, **values}))


def test_sends_through_the_relay_with_starttls(fake_smtp: type[FakeSMTP]) -> None:
    assert _mailer().send(MESSAGE) == "pat@example.com"
    assert fake_smtp.calls == ["connect relay.example:25", "ehlo", "starttls", "ehlo"]
    (email,) = fake_smtp.sent
    assert email["To"] == "pat@example.com"
    assert email["From"] == "no-reply@example.com"
    assert email["Subject"] == "Hi"


def test_disabled_sends_nothing_and_logs(
    fake_smtp: type[FakeSMTP], caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger=mailer_module.__name__):
        assert _mailer(mail_enabled=False).send(MESSAGE) == "pat@example.com"
    assert fake_smtp.sent == []
    assert "would send" in caplog.text


def test_redirect_sends_elsewhere_and_names_the_recipient(fake_smtp: type[FakeSMTP]) -> None:
    assert _mailer(mail_redirect_to="qa@example.com").send(MESSAGE) == "qa@example.com"
    (email,) = fake_smtp.sent
    assert email["To"] == "qa@example.com"
    assert "Intended for: pat@example.com" in email.get_body(("plain",)).get_content()


def test_redirected_escapes_the_note_in_html() -> None:
    message = redirected(OutgoingEmail(to="<x>@y", subject="s", text="t", html="h"), "qa@z")
    assert message.html.startswith("<p><em>Intended for: &lt;x&gt;@y</em></p>")
