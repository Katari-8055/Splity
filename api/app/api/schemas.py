"""Request bodies.

Field names accept the camelCase keys the React client already sends
(``friendIds``, ``splitType``...) as well as snake_case.
"""

import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

Money = Decimal


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True)


# ── auth ──────────────────────────────────────────────────────────────────────

_PHONE = re.compile(r"^\+?[1-9]\d{6,14}$")


class SignUpIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str | None = None
    password: str = Field(min_length=8, max_length=72)  # bcrypt only uses the first 72 bytes
    role: Literal["user", "parent"] = "user"

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if v in (None, ""):
            return None
        if not _PHONE.match(v):
            raise ValueError("Invalid phone number")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v.encode()) > 72:
            raise ValueError("Password is too long")
        if not (re.search(r"[a-z]", v) and re.search(r"[A-Z]", v) and re.search(r"\d", v)):
            raise ValueError("Password must contain an uppercase letter, a lowercase letter and a number")
        return v


class SignInIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


# ── friends ───────────────────────────────────────────────────────────────────


class AddFriendIn(CamelModel):
    friend_id: str | None = None
    friend_email: EmailStr | None = None
    friend_phone: str | None = None


class ReminderIn(CamelModel):
    friend_id: str
    message: str | None = Field(default=None, max_length=500)


# ── groups ────────────────────────────────────────────────────────────────────


class CreateGroupIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    members: list[str] = Field(default_factory=list, max_length=50)


class GroupMessageIn(CamelModel):
    message: str = Field(min_length=1, max_length=2000)


# ── expenses ──────────────────────────────────────────────────────────────────


class ShareIn(CamelModel):
    user_id: str
    amount: Money | None = None
    percentage: Money | None = None


class CreateExpenseIn(CamelModel):
    amount: Money = Field(gt=0)
    category: str = Field(min_length=1, max_length=50)
    subcategory: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    friend_ids: list[str] = Field(default_factory=list, max_length=50)
    split_type: Literal["equal", "percentage", "custom"] = "equal"
    custom_splits: list[ShareIn] = Field(default_factory=list, max_length=50)
    group_id: str | None = None

    @model_validator(mode="after")
    def _shares_present(self):
        if self.split_type == "custom" and any(s.amount is None for s in self.custom_splits):
            raise ValueError("Every custom split needs an amount")
        if self.split_type == "percentage" and any(s.percentage is None for s in self.custom_splits):
            raise ValueError("Every percentage split needs a percentage")
        return self

    def shares(self) -> dict[str, Decimal]:
        key = "percentage" if self.split_type == "percentage" else "amount"
        return {s.user_id: getattr(s, key) for s in self.custom_splits}


class SettleIn(CamelModel):
    friend_id: str
    amount: Money | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, max_length=255)


class PayExpenseIn(CamelModel):
    amount: Money | None = Field(default=None, gt=0)


# ── notifications ─────────────────────────────────────────────────────────────


class AckIn(CamelModel):
    notification_id: str
