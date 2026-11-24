"""Widen ai_messages.tool_call_id: Gemini 3 tool-call IDs carry ~3.5k-char thought signatures.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("ai_messages", "tool_call_id", type_=sa.Text, existing_type=sa.String(100))


def downgrade() -> None:
    op.alter_column("ai_messages", "tool_call_id", type_=sa.String(100), existing_type=sa.Text)
