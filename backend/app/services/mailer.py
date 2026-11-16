"""Send one email — the transport behind notification mail and the support form.

**SMTP to Office 365's connector for the domain**
(``example-com.mail.protection.outlook.com:25``). IT's inbound connector
accepts mail from Synveon's external IPs, so there is no login and no secret; the
host, port and sender are ordinary settings in the committed env files. Chosen
over Microsoft Graph ``sendMail`` because it
needs no app registration, no admin consent and no expiring client secret.
STARTTLS is on: Office 365 offers it on port 25, so mail is encrypted in transit.

A relay accepting a message is not proof of delivery — a bounce goes to the
sender address, not to the app. That is accepted for notifications.

``smtplib`` blocks. A notification goes out from a FastAPI background task
(``background_tasks.add_task(mailer.send, message)``) so the request never waits
on the relay; the support form (routers/support.py) runs it in a threadpool
instead, because the sender needs to know whether it went.

Two settings bend where a message goes, both for safety:

* ``MAIL_ENABLED=false`` (the default) sends nothing and logs what would have
  been sent, so local dev and the test suite can never email anyone.
* ``MAIL_REDIRECT_TO`` sends EVERY message to that one address instead, with the
  intended recipient named at the top of the body. sbx and uat set it.
"""

import html
import logging
import smtplib
from dataclasses import dataclass, replace
from email.message import EmailMessage
from typing import Annotated, Protocol

from fastapi import Depends

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class EmailAttachment:
    filename: str
    content_type: str
    data: bytes


@dataclass(frozen=True)
class OutgoingEmail:
    """One message: a plain-text body plus an HTML alternative (escape every value)."""

    to: str
    subject: str
    text: str
    html: str
    attachments: tuple[EmailAttachment, ...] = ()
    reply_to: str | None = None


class Mailer(Protocol):
    def send(self, message: OutgoingEmail) -> str:
        """Send ``message``; returns the address it actually went to."""
        ...


def redirected(message: OutgoingEmail, redirect_to: str) -> OutgoingEmail:
    """``message`` sent to ``redirect_to`` instead, saying who it was for."""
    note = f"Intended for: {message.to}"
    return replace(
        message,
        to=redirect_to,
        text=f"{note}\n\n{message.text}",
        html=f"<p><em>{html.escape(note)}</em></p>{message.html}",
    )


class SmtpMailer:
    """Sends through the configured relay. Raises on failure; the caller logs."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def send(self, message: OutgoingEmail) -> str:
        settings = self._settings
        if settings.mail_redirect_to:
            message = redirected(message, settings.mail_redirect_to)
        if not settings.mail_enabled:
            logger.info("mail disabled; would send %r to %s", message.subject, message.to)
            return message.to

        email = EmailMessage()
        email["From"] = settings.mail_sender
        email["To"] = message.to
        email["Subject"] = message.subject
        if message.reply_to:
            email["Reply-To"] = message.reply_to
        email.set_content(message.text)
        email.add_alternative(message.html, subtype="html")
        for attachment in message.attachments:
            maintype, _, subtype = attachment.content_type.partition("/")
            if not (maintype and subtype):
                maintype, subtype = "application", "octet-stream"
            email.add_attachment(
                attachment.data,
                maintype=maintype,
                subtype=subtype,
                filename=attachment.filename,
            )

        with smtplib.SMTP(
            settings.mail_smtp_host, settings.mail_smtp_port, timeout=SMTP_TIMEOUT_SECONDS
        ) as smtp:
            smtp.ehlo()
            if settings.mail_starttls:
                smtp.starttls()
                smtp.ehlo()
            smtp.send_message(email)
        return message.to


def get_mailer(settings: Annotated[Settings, Depends(get_settings)]) -> Mailer:
    """The configured mailer — a dependency, so tests swap in a fake."""
    return SmtpMailer(settings)
