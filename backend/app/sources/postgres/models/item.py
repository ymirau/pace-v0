import datetime
from decimal import Decimal
from typing import ClassVar

from sqlalchemy import Date, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.sources.postgres.models.base import Base


class Item(Base):
    """Example entity — replace with your own, or add more alongside it.

    Demonstrates the conventions: tables live in the `pace` schema, columns use
    the SQLAlchemy 2.0 ``Mapped[...] / mapped_column(...)`` style, and a mix of
    column types — text, an optional (nullable) column, a ``Numeric`` money amount,
    and a ``Date``.
    """

    __tablename__ = "items"
    __table_args__: ClassVar[dict[str, str]] = {"schema": "pace"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Numeric serializes to a JSON *string* (precise decimal), not a float.
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
