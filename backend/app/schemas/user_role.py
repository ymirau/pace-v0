"""Schemas for the user-roles API (`/api/user-roles`, admins only)."""

import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Role = Literal["admin", "user"]


class UserRoleCreate(BaseModel):
    email: str
    role: Role
    # Display copy from the directory people picker.
    display_name: str | None = Field(default=None, max_length=256)

    @field_validator("display_name")
    @classmethod
    def blank_display_name_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class UserRoleUpdate(BaseModel):
    role: Role


class UserRoleRead(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    email: str
    display_name: str | None
    role: Role
    created_at: datetime.datetime
    updated_at: datetime.datetime
