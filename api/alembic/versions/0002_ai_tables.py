"""AI tables: conversations, transcript messages, pending (confirm-to-run) actions.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(64)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column("id", ID, primary_key=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(120)),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_conversations_user_id", "ai_conversations", ["user_id"])

    op.create_table(
        "ai_messages",
        sa.Column("id", ID, primary_key=True),
        sa.Column("conversation_id", ID, sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text),
        sa.Column("tool_calls", postgresql.JSONB),
        sa.Column("tool_call_id", sa.String(100)),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant', 'tool')", name="ck_ai_messages_role"),
    )
    op.create_index("ix_ai_messages_conversation_id_seq", "ai_messages", ["conversation_id", "seq"])

    op.create_table(
        "ai_pending_actions",
        sa.Column("id", ID, primary_key=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", ID, sa.ForeignKey("ai_conversations.id", ondelete="CASCADE")),
        sa.Column("tool", sa.String(60), nullable=False),
        sa.Column("args", postgresql.JSONB, nullable=False),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("result", postgresql.JSONB),
        sa.Column("error", sa.Text),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("executed_at", TS),
        sa.CheckConstraint(
            "status IN ('pending', 'executing', 'executed', 'cancelled', 'failed')",
            name="ck_ai_pending_actions_status",
        ),
    )
    op.create_index("ix_ai_pending_actions_user_id_status", "ai_pending_actions", ["user_id", "status"])


def downgrade() -> None:
    op.drop_table("ai_pending_actions")
    op.drop_table("ai_messages")
    op.drop_table("ai_conversations")
