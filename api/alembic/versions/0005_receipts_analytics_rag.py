"""Receipts (OCR), analytics views + read-only role (text-to-SQL), documents + pgvector (RAG).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(64)
MONEY = sa.Numeric(12, 2)
TS = sa.DateTime(timezone=True)
DIM = 768

# Every view filters by the per-transaction setting app.user_id, so a query can only
# ever see the current user's rows, whatever SQL the model writes.
ANALYTICS_VIEWS = """
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE OR REPLACE VIEW analytics.my_expenses AS
SELECT e.id                                   AS expense_id,
       e.created_at                           AS spent_at,
       e.created_at::date                     AS spent_on,
       e.category,
       e.subcategory,
       e.description,
       e.amount                               AS total_amount,
       s.amount                               AS my_share,
       (e.paid_by = s.user_id)                AS paid_by_me,
       payer.name                             AS paid_by_name,
       g.name                                 AS group_name,
       (SELECT count(*) FROM expense_splits x WHERE x.expense_id = e.id) AS people_count
FROM expenses e
JOIN expense_splits s ON s.expense_id = e.id AND s.user_id = current_setting('app.user_id', true)
JOIN users payer ON payer.id = e.paid_by
LEFT JOIN groups g ON g.id = e.group_id;

CREATE OR REPLACE VIEW analytics.my_expense_people AS
SELECT e.id AS expense_id, e.created_at::date AS spent_on, e.category, u.name AS person_name,
       x.amount AS person_share, (u.id = current_setting('app.user_id', true)) AS is_me
FROM expenses e
JOIN expense_splits me ON me.expense_id = e.id AND me.user_id = current_setting('app.user_id', true)
JOIN expense_splits x ON x.expense_id = e.id
JOIN users u ON u.id = x.user_id;

CREATE OR REPLACE VIEW analytics.my_settlements AS
SELECT st.created_at::date AS settled_on, st.amount,
       CASE WHEN st.payer_id = current_setting('app.user_id', true) THEN 'paid' ELSE 'received' END AS direction,
       CASE WHEN st.payer_id = current_setting('app.user_id', true) THEN payee.name ELSE payer.name END AS other_person
FROM settlements st
JOIN users payer ON payer.id = st.payer_id
JOIN users payee ON payee.id = st.payee_id
WHERE current_setting('app.user_id', true) IN (st.payer_id, st.payee_id);

CREATE OR REPLACE VIEW analytics.my_receipt_items AS
SELECT r.id AS receipt_id, r.merchant, r.bill_date, r.created_at::date AS uploaded_on,
       i.name AS item_name, i.quantity, i.amount, i.category
FROM receipts r JOIN receipt_items i ON i.receipt_id = r.id
WHERE r.user_id = current_setting('app.user_id', true);
"""

READONLY_ROLE = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'splity_analyst') THEN
    CREATE ROLE splity_analyst NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA analytics TO splity_analyst;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO splity_analyst;
REVOKE ALL ON SCHEMA public FROM splity_analyst;
GRANT splity_analyst TO CURRENT_USER;
"""


def upgrade() -> None:
    op.create_table(
        "receipts",
        sa.Column("id", ID, primary_key=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("storage_path", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("merchant", sa.String(200)),
        sa.Column("bill_date", sa.String(20)),
        sa.Column("currency", sa.String(10)),
        sa.Column("subtotal", MONEY),
        sa.Column("tax", MONEY),
        sa.Column("tip", MONEY),
        sa.Column("discount", MONEY),
        sa.Column("total", MONEY),
        sa.Column("issues", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("raw_text", sa.Text),
        sa.Column("expense_id", ID, sa.ForeignKey("expenses.id", ondelete="SET NULL")),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('parsed', 'needs_review', 'failed')", name="ck_receipts_status"),
    )
    op.create_index("ix_receipts_user_id_created_at", "receipts", ["user_id", "created_at"])

    op.create_table(
        "receipt_items",
        sa.Column("id", ID, primary_key=True),
        sa.Column("receipt_id", ID, sa.ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("category", sa.String(50)),
    )
    op.create_index("ix_receipt_items_receipt_id", "receipt_items", ["receipt_id"])

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "documents",
        sa.Column("id", ID, primary_key=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("group_id", ID, sa.ForeignKey("groups.id", ondelete="CASCADE")),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_id", ID, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("meta", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("embedding", Vector(DIM)),
        sa.Column("tsv", postgresql.TSVECTOR, sa.Computed("to_tsvector('simple', content)", persisted=True)),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("user_id IS NOT NULL OR group_id IS NOT NULL", name="ck_documents_owner"),
    )
    op.create_index("ix_documents_user_id", "documents", ["user_id"])
    op.create_index("ix_documents_group_id", "documents", ["group_id"])
    op.create_index("ix_documents_source", "documents", ["source_type", "source_id"])
    op.create_index("ix_documents_tsv", "documents", ["tsv"], postgresql_using="gin")
    op.create_index(
        "ix_documents_embedding",
        "documents",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

    op.create_table(
        "sql_examples",
        sa.Column("id", ID, primary_key=True),
        sa.Column("question", sa.Text, nullable=False, unique=True),
        sa.Column("sql", sa.Text, nullable=False),
        sa.Column("embedding", Vector(DIM)),
    )

    op.execute(ANALYTICS_VIEWS)
    op.execute(READONLY_ROLE)


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS analytics CASCADE")
    op.drop_table("sql_examples")
    op.drop_table("documents")
    op.drop_table("receipt_items")
    op.drop_table("receipts")
