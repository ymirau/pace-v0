"""Who is an admin: one row per email (lowercased), declared by
``sql/postgres/004_user_roles.sql``. Sparse - a signed-in user with no row is a
plain ``user`` (app/core/roles.py), so a missing row never locks anyone out.
``display_name`` is a display copy from the directory people picker (nullable).
"""

import datetime
from typing import ClassVar

from sqlalchemy import CheckConstraint, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.sources.postgres.models.base import Base


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__: ClassVar[tuple] = (
        CheckConstraint("role IN ('admin', 'user')", name="ck_user_roles_role"),
        {"schema": "pace"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
