"""The business-state document. See sql/postgres/003_state.sql."""

from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.sources.postgres.models.base import Base


class PaceState(Base):
    __tablename__ = "pace_state"
    __table_args__: ClassVar[dict[str, str]] = {"schema": "pace"}

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    state: Mapped[dict[str, Any]] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
