"""AI traces for observability.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_traces",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("conversation_id", sa.String(64)),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("model", sa.String(100)),
        sa.Column("prompt_version", sa.String(40)),
        sa.Column("input_preview", sa.String(500)),
        sa.Column("output_preview", sa.String(1000)),
        sa.Column("llm_calls", sa.Integer, nullable=False, server_default="0"),
        sa.Column("prompt_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("spans", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_traces_created_at", "ai_traces", ["created_at"])
    op.create_index("ix_ai_traces_user_id_created_at", "ai_traces", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_table("ai_traces")
