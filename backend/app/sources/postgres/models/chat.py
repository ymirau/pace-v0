"""Chat log: sessions, events and ratings. See sql/postgres/002_chat.sql."""

from datetime import date, datetime
from typing import Any, ClassVar

from sqlalchemy import BigInteger, ForeignKey, Integer, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.sources.postgres.models.base import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__: ClassVar[dict[str, str]] = {"schema": "pace"}

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    model: Mapped[str] = mapped_column(Text)
    prompt_version: Mapped[str] = mapped_column(Text)
    seed: Mapped[str] = mapped_column(Text)
    # Which browser this conversation belongs to (app/core/visitor.py). Not an
    # identity, and not a secret: it partitions demo worlds so one reviewer's
    # cleanup does not rewrite the app the next reviewer is shown.
    visitor: Mapped[str] = mapped_column(Text, default="solo", server_default="solo")
    sim_today: Mapped[date | None] = mapped_column(nullable=True)
    messages: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    founder: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class ChatEvent(Base):
    __tablename__ = "chat_events"
    __table_args__: ClassVar[dict[str, str]] = {"schema": "pace"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("pace.chat_sessions.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(Text, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ChatRating(Base):
    __tablename__ = "chat_ratings"
    __table_args__: ClassVar[dict[str, str]] = {"schema": "pace"}

    session_id: Mapped[str] = mapped_column(
        ForeignKey("pace.chat_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    turn: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Optional: how it felt is one press, cleanup cost is only known later.
    score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    feel: Mapped[str] = mapped_column(Text)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
