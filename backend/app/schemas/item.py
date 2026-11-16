import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ItemCreate(BaseModel):
    name: str = Field(..., max_length=120, min_length=1)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=80)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    date: datetime.date | None = None


class ItemUpdate(BaseModel):
    # All optional; only fields present in the request body are applied
    # (PATCH semantics via model_dump(exclude_unset=True)).
    name: str | None = Field(default=None, max_length=120, min_length=1)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=80)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    date: datetime.date | None = None


class ItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    category: str | None
    # Numeric/Decimal serializes to a JSON string; Date to an ISO "YYYY-MM-DD" string.
    amount: Decimal | None
    date: datetime.date | None
