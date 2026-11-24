"""Initial schema: users, friends, groups, expenses, splits, settlements, notifications.

Revision ID: 0001
Revises:
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(64)
MONEY = sa.Numeric(12, 2)
TS = sa.DateTime(timezone=True)


def _created_at(name: str = "created_at") -> sa.Column:
    return sa.Column(name, TS, server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", ID, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("phone", sa.String(20)),
        sa.Column("password_hash", sa.String(255)),
        sa.Column("role", sa.String(20), nullable=False, server_default="user"),
        _created_at(),
        sa.CheckConstraint("role IN ('user', 'parent')", name="ck_users_role"),
    )
    op.create_index("ix_users_phone", "users", ["phone"])

    op.create_table(
        "friendships",
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("friend_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        _created_at(),
        sa.CheckConstraint("user_id <> friend_id", name="ck_friendships_not_self"),
    )
    op.create_index("ix_friendships_friend_id", "friendships", ["friend_id"])

    op.create_table(
        "groups",
        sa.Column("id", ID, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_by", ID, sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
    )

    op.create_table(
        "group_members",
        sa.Column("group_id", ID, sa.ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        _created_at("joined_at"),
    )
    op.create_index("ix_group_members_user_id", "group_members", ["user_id"])

    op.create_table(
        "group_messages",
        sa.Column("id", ID, primary_key=True),
        sa.Column("group_id", ID, sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        _created_at(),
    )
    op.create_index("ix_group_messages_group_id_created_at", "group_messages", ["group_id", "created_at"])

    op.create_table(
        "expenses",
        sa.Column("id", ID, primary_key=True),
        sa.Column("paid_by", ID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("group_id", ID, sa.ForeignKey("groups.id", ondelete="SET NULL")),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("subcategory", sa.String(80)),
        sa.Column("description", sa.String(500)),
        sa.Column("split_type", sa.String(20), nullable=False),
        _created_at(),
        sa.CheckConstraint("amount > 0", name="ck_expenses_amount_positive"),
        sa.CheckConstraint(
            "split_type IN ('equal', 'percentage', 'custom', 'personal')", name="ck_expenses_split_type"
        ),
    )
    op.create_index("ix_expenses_paid_by_created_at", "expenses", ["paid_by", "created_at"])
    op.create_index("ix_expenses_group_id", "expenses", ["group_id"])

    op.create_table(
        "expense_splits",
        sa.Column("expense_id", ID, sa.ForeignKey("expenses.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("amount", MONEY, nullable=False),
        sa.CheckConstraint("amount >= 0", name="ck_expense_splits_amount_non_negative"),
    )
    op.create_index("ix_expense_splits_user_id", "expense_splits", ["user_id"])

    op.create_table(
        "settlements",
        sa.Column("id", ID, primary_key=True),
        sa.Column("payer_id", ID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("payee_id", ID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("group_id", ID, sa.ForeignKey("groups.id", ondelete="SET NULL")),
        sa.Column("note", sa.String(255)),
        sa.Column("recorded_by", ID, sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        sa.CheckConstraint("amount > 0", name="ck_settlements_amount_positive"),
        sa.CheckConstraint("payer_id <> payee_id", name="ck_settlements_not_self"),
    )
    op.create_index("ix_settlements_payer_id", "settlements", ["payer_id"])
    op.create_index("ix_settlements_payee_id", "settlements", ["payee_id"])

    op.create_table(
        "notifications",
        sa.Column("id", ID, primary_key=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False, server_default="general"),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("data", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("is_read", sa.Boolean, nullable=False, server_default=sa.false()),
        _created_at(),
    )
    op.create_index("ix_notifications_user_id_created_at", "notifications", ["user_id", "created_at"])


def downgrade() -> None:
    for table in (
        "notifications",
        "settlements",
        "expense_splits",
        "expenses",
        "group_messages",
        "group_members",
        "groups",
        "friendships",
        "users",
    ):
        op.drop_table(table)
