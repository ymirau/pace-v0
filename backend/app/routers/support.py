"""The support form's API (`/api/support`): the app emails support itself.

**Authentication only, no role lookup.** A support request is most needed when
something is broken, so nothing here depends on anything but the token.

**The recipient never comes from the request.** It is ``SUPPORT_EMAIL``; a
``to`` form field is simply not a parameter, so it is dropped. Reply-To is the
caller's token email, so support answers with a plain Reply.

**Up to three photos** ride along as attachments. They go through the
``services/uploads.py`` policy (image types only, its size cap) but are never
stored: the row keeps only their names.

**The send is inline** (``run_in_threadpool``, since smtplib blocks): "sent"
means the relay accepted the message, and a refusal is a 502 the page can offer
the ``mailto:`` fallback for. With ``MAIL_ENABLED=false`` (local dev) nothing goes
and the response says ``disabled``, so the whole flow still runs locally.

**The ``support_requests`` log is best-effort.** A ``pending`` row is written,
the mail is sent, and the row moves to ``sent`` or ``failed``. A failed insert
(e.g. ``sql/postgres/003_support_requests.sql`` not applied yet) does not stop
the send - the email then says it was not recorded - and a failed update is
logged and ignored.
"""

import html
import logging
from contextlib import suppress
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, get_current_user, principal_email, principal_identity
from app.schemas.support import SupportConfig, SupportSent
from app.services import uploads
from app.services.mailer import EmailAttachment, Mailer, OutgoingEmail, get_mailer
from app.sources.postgres.models.support_request import SUPPORT_KINDS, SupportRequest
from app.sources.postgres.session import get_session

logger = logging.getLogger(__name__)

APP_NAME = "pace-v0"

SUBJECT_MAX = 200
BODY_MAX = 10_000
DIAGNOSTICS_MAX = 2_000
IMAGES_MAX = 3

NOT_RECORDED = "Not recorded: the database was unavailable"

# The `/api` prefix is added in main.py, not here.
router = APIRouter(
    prefix="/support",
    tags=["support"],
    dependencies=[Depends(get_current_user)],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
MailerDep = Annotated[Mailer, Depends(get_mailer)]


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _checked_text(label: str, value: str, maximum: int) -> str:
    value = value.strip()
    if not value:
        raise _unprocessable(f"{label} is required.")
    if len(value) > maximum:
        raise _unprocessable(f"{label} must be at most {maximum:,} characters.")
    return value


async def _read_images(images: list[UploadFile]) -> list[EmailAttachment]:
    """Images only, each within the size cap - every refusal a 422."""
    if len(images) > IMAGES_MAX:
        raise _unprocessable(f"At most {IMAGES_MAX} images can be attached.")
    read: list[EmailAttachment] = []
    for image in images:
        content_type = uploads.image_content_type(image.content_type)
        filename = uploads.attachment_filename(image.filename)
        data = await uploads.read_upload(image, filename)
        read.append(EmailAttachment(filename=filename, content_type=content_type, data=data))
    return read


def current_environment(settings: Settings) -> str:
    """This deployment's code (loc/sbx/uat/prd), from ENV_NAME (``pace-sbx`` -> ``sbx``)."""
    if not settings.env_name:
        return "loc"
    suffix = settings.env_name.rsplit("-", 1)[-1]
    return suffix if suffix in ("sbx", "uat") else "prd"


def support_subject(env: str, kind: str, subject: str) -> str:
    """Tagged by app, environment and kind, so a mailbox rule can sort on it."""
    return f"[{APP_NAME} / {env}] {kind}: {subject}"


def support_body(body: str, diagnostics: str, *, recorded: bool) -> str:
    """The sender's words, then the footer - the same shape as the mailto: body."""
    lines = [body, "", "---", f"Sent from the {APP_NAME} support form."]
    if not recorded:
        lines.append(NOT_RECORDED)
    if diagnostics:
        lines.append(diagnostics)
    return "\n".join(lines)


async def _record_pending(session: AsyncSession, row: SupportRequest) -> bool:
    try:
        session.add(row)
        await session.commit()
    except Exception:
        logger.warning("support: could not record the request; sending anyway", exc_info=True)
        with suppress(Exception):
            await session.rollback()
        return False
    return True


async def _record_outcome(session: AsyncSession, row: SupportRequest, error: str | None) -> None:
    # Read before the commit: a failed commit expires the row, and touching an
    # expired attribute in the handler below would need IO the async session refuses.
    row_id = row.id
    try:
        row.status = "failed" if error else "sent"
        row.error = error
        await session.commit()
    except Exception:
        logger.warning("support: could not record the outcome of request %s", row_id, exc_info=True)
        with suppress(Exception):
            await session.rollback()


@router.get("/config", response_model=SupportConfig)
async def get_support_config(settings: SettingsDep) -> SupportConfig:
    return SupportConfig(
        support_email=settings.support_email, configured=settings.support_email != ""
    )


@router.post("", response_model=SupportSent)
async def send_support(
    session: SessionDep,
    settings: SettingsDep,
    mailer: MailerDep,
    user: CurrentUser,
    # Defaulted so a blank field (which multipart sends as absent) gets the same
    # readable 422 as a whitespace-only one, not FastAPI's "Field required" list.
    kind: Annotated[str, Form()] = "",
    subject: Annotated[str, Form()] = "",
    details: Annotated[str, Form()] = "",
    diagnostics: Annotated[str, Form()] = "",
    images: Annotated[list[UploadFile] | None, File()] = None,
) -> SupportSent:
    if kind not in SUPPORT_KINDS:
        raise _unprocessable(f"Kind must be one of {', '.join(SUPPORT_KINDS)}.")
    subject = _checked_text("Subject", subject, SUBJECT_MAX)
    details = _checked_text("Details", details, BODY_MAX)
    if len(diagnostics) > DIAGNOSTICS_MAX:
        raise _unprocessable(f"Diagnostics must be at most {DIAGNOSTICS_MAX:,} characters.")
    photos = await _read_images(images or [])

    recipient = settings.support_email
    if not recipient:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Support isn't configured")

    env = current_environment(settings)
    sender_id, sender_name = principal_identity(user)
    reply_to = principal_email(user)
    row = SupportRequest(
        environment=env,
        sender_id=sender_id or None,
        sender_name=sender_name or None,
        sender_email=reply_to,
        kind=kind,
        subject=subject,
        body=details,
        image_names=[photo.filename for photo in photos] or None,
        status="pending",
    )
    recorded = await _record_pending(session, row)

    text = support_body(details, diagnostics, recorded=recorded)
    message = OutgoingEmail(
        to=recipient,
        subject=support_subject(env, kind, subject),
        text=text,
        html=f'<pre style="font-family: inherit; white-space: pre-wrap">{html.escape(text)}</pre>',
        reply_to=reply_to,
        attachments=tuple(photos),
    )
    try:
        await run_in_threadpool(mailer.send, message)
    except Exception as exc:  # smtplib raises a family of errors; all mean "not sent"
        logger.warning("support: send failed", exc_info=True)
        if recorded:
            await _record_outcome(session, row, str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The mail relay refused the message",
        ) from exc

    # With mail disabled the mailer only logs; the row still records a send
    # that "went" (to the log), since nothing failed.
    if recorded:
        await _record_outcome(session, row, None)
    return SupportSent(status="sent" if settings.mail_enabled else "disabled", recorded=recorded)
