"""The support request log: one row per support form send.

Declared by ``sql/postgres/003_support_requests.sql``. Write-only from the app's
side - written ``pending``, then moved to ``sent`` or ``failed`` - and
best-effort: the email goes even if this insert fails. No screen reads it.

The sender columns come from the validated token, never from the form.
"""

import datetime
from typing import ClassVar

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.sources.postgres.models.base import Base

SUPPORT_KINDS = ("Problem", "Question", "Request")
"""What the sender is describing. The DDL leaves ``kind`` unconstrained, so this
tuple (checked by ``routers/support.py``) is the only list; the frontend's
``SUPPORT_KINDS`` in ``lib/supportMail.ts`` mirrors it."""


class SupportRequest(Base):
    __tablename__ = "support_requests"
    __table_args__: ClassVar[tuple] = (
        CheckConstraint("status IN ('pending', 'sent', 'failed')", name="chk_support_status"),
        Index("idx_support_requests_created", "created_at"),
        {"schema": "pace"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    environment: Mapped[str] = mapped_column(String(20), nullable=False)  # loc/sbx/uat/prd
    sender_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    image_names: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default="pending", server_default="pending"
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
