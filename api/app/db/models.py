"""Relational schema.

Changes from the legacy Node schema:
- ``expenses.paid_by`` replaces the ambiguous ``expenses.user_id``.
- Settlements live in their own ledger table instead of fake "Settlement"
  expenses, so they never show up as spending.
- Every expense has split rows for everyone who shares the cost, the payer
  included, so "my spending" is always ``SUM(expense_splits.amount)`` for me.
- Timestamps are timezone-aware, and money is NUMERIC(12,2) with CHECK constraints.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    type_annotation_map = {
        Decimal: Numeric(12, 2),
        datetime: DateTime(timezone=True),
    }


ID = String(64)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('user', 'parent')", name="ck_users_role"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20), index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user", server_default="user")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Friendship(Base):
    """Stored in both directions (A->B and B->A) so lookups are a single index scan."""

    __tablename__ = "friendships"
    __table_args__ = (
        CheckConstraint("user_id <> friend_id", name="ck_friendships_not_self"),
        Index("ix_friendships_friend_id", "friend_id"),
    )

    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    friend_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    created_by: Mapped[str] = mapped_column(ID, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (Index("ix_group_members_user_id", "user_id"),)

    group_id: Mapped[str] = mapped_column(ID, ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(server_default=func.now())


class GroupMessage(Base):
    __tablename__ = "group_messages"
    __table_args__ = (Index("ix_group_messages_group_id_created_at", "group_id", "created_at"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    group_id: Mapped[str] = mapped_column(ID, ForeignKey("groups.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_expenses_amount_positive"),
        CheckConstraint("split_type IN ('equal', 'percentage', 'custom', 'personal')", name="ck_expenses_split_type"),
        Index("ix_expenses_paid_by_created_at", "paid_by", "created_at"),
        Index("ix_expenses_group_id", "group_id"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    paid_by: Mapped[str] = mapped_column(ID, ForeignKey("users.id"))
    group_id: Mapped[str | None] = mapped_column(ID, ForeignKey("groups.id", ondelete="SET NULL"))
    amount: Mapped[Decimal]
    category: Mapped[str] = mapped_column(String(50))
    subcategory: Mapped[str | None] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(500))
    split_type: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ExpenseSplit(Base):
    """One row per person who shares the cost, the payer included."""

    __tablename__ = "expense_splits"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_expense_splits_amount_non_negative"),
        Index("ix_expense_splits_user_id", "user_id"),
    )

    expense_id: Mapped[str] = mapped_column(ID, ForeignKey("expenses.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id"), primary_key=True)
    amount: Mapped[Decimal]


class Settlement(Base):
    """A repayment from payer to payee. It reduces what the payer owes the payee."""

    __tablename__ = "settlements"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_settlements_amount_positive"),
        CheckConstraint("payer_id <> payee_id", name="ck_settlements_not_self"),
        Index("ix_settlements_payer_id", "payer_id"),
        Index("ix_settlements_payee_id", "payee_id"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    payer_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id"))
    payee_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id"))
    amount: Mapped[Decimal]
    group_id: Mapped[str | None] = mapped_column(ID, ForeignKey("groups.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(255))
    recorded_by: Mapped[str] = mapped_column(ID, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AIConversation(Base):
    __tablename__ = "ai_conversations"
    __table_args__ = (Index("ix_ai_conversations_user_id", "user_id"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AIMessage(Base):
    """Full transcript in OpenAI message format, tool calls included, so it can be replayed to the model."""

    __tablename__ = "ai_messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant', 'tool')", name="ck_ai_messages_role"),
        Index("ix_ai_messages_conversation_id_seq", "conversation_id", "seq"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(ID, ForeignKey("ai_conversations.id", ondelete="CASCADE"))
    seq: Mapped[int]
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str | None] = mapped_column(Text)
    tool_calls: Mapped[list | None] = mapped_column(JSONB)
    tool_call_id: Mapped[str | None] = mapped_column(Text)  # Gemini 3 embeds ~3.5k-char thought signatures
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AIPendingAction(Base):
    """A change the agent proposed. Only an explicit confirm by its owner, before it expires, runs it.

    ``args`` are built and validated by the server; the client never sends them.
    """

    __tablename__ = "ai_pending_actions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'executing', 'executed', 'cancelled', 'failed')",
            name="ck_ai_pending_actions_status",
        ),
        Index("ix_ai_pending_actions_user_id_status", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"))
    conversation_id: Mapped[str | None] = mapped_column(ID, ForeignKey("ai_conversations.id", ondelete="CASCADE"))
    tool: Mapped[str] = mapped_column(String(60))
    args: Mapped[dict] = mapped_column(JSONB)
    summary: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    result: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]
    executed_at: Mapped[datetime | None]


class AITrace(Base):
    """One row per AI request: the ordered LLM/tool timeline plus tokens, cost, latency and outcome."""

    __tablename__ = "ai_traces"
    __table_args__ = (
        Index("ix_ai_traces_created_at", "created_at"),
        Index("ix_ai_traces_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ID, ForeignKey("users.id", ondelete="SET NULL"))
    conversation_id: Mapped[str | None] = mapped_column(ID)
    kind: Mapped[str] = mapped_column(String(30))  # chat | categorize | action
    status: Mapped[str] = mapped_column(String(20))  # ok | proposed | gave_up | error | executed | failed
    model: Mapped[str | None] = mapped_column(String(100))
    prompt_version: Mapped[str | None] = mapped_column(String(40))
    input_preview: Mapped[str | None] = mapped_column(String(500))
    output_preview: Mapped[str | None] = mapped_column(String(1000))
    llm_calls: Mapped[int] = mapped_column(default=0, server_default="0")
    prompt_tokens: Mapped[int] = mapped_column(default=0, server_default="0")
    completion_tokens: Mapped[int] = mapped_column(default=0, server_default="0")
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0, server_default="0")
    latency_ms: Mapped[int] = mapped_column(default=0, server_default="0")
    spans: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_id_created_at", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(50), default="general", server_default="general")
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


# ── receipts (OCR) ───────────────────────────────────────────────────────────


class Receipt(Base):
    __tablename__ = "receipts"
    __table_args__ = (
        CheckConstraint("status IN ('parsed', 'needs_review', 'failed')", name="ck_receipts_status"),
        Index("ix_receipts_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20))
    merchant: Mapped[str | None] = mapped_column(String(200))
    bill_date: Mapped[str | None] = mapped_column(String(20))
    currency: Mapped[str | None] = mapped_column(String(10))
    subtotal: Mapped[Decimal | None]
    tax: Mapped[Decimal | None]
    tip: Mapped[Decimal | None]
    discount: Mapped[Decimal | None]
    total: Mapped[Decimal | None]
    issues: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    raw_text: Mapped[str | None] = mapped_column(Text)
    expense_id: Mapped[str | None] = mapped_column(ID, ForeignKey("expenses.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ReceiptItem(Base):
    __tablename__ = "receipt_items"
    __table_args__ = (Index("ix_receipt_items_receipt_id", "receipt_id"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    receipt_id: Mapped[str] = mapped_column(ID, ForeignKey("receipts.id", ondelete="CASCADE"))
    position: Mapped[int]
    name: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=1)
    amount: Mapped[Decimal]
    category: Mapped[str | None] = mapped_column(String(50))


# ── RAG ──────────────────────────────────────────────────────────────────────

EMBEDDING_DIM = 768


class Document(Base):
    """A searchable chunk. Visible to ``user_id`` (personal) or to members of ``group_id`` (group)."""

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("user_id IS NOT NULL OR group_id IS NOT NULL", name="ck_documents_owner"),
        Index("ix_documents_user_id", "user_id"),
        Index("ix_documents_group_id", "group_id"),
        Index("ix_documents_source", "source_type", "source_id"),
        Index("ix_documents_tsv", "tsv", postgresql_using="gin"),
        Index(
            "ix_documents_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ID, ForeignKey("users.id", ondelete="CASCADE"))
    group_id: Mapped[str | None] = mapped_column(ID, ForeignKey("groups.id", ondelete="CASCADE"))
    source_type: Mapped[str] = mapped_column(String(30))  # receipt | expense | group_message
    source_id: Mapped[str] = mapped_column(ID)
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    embedding = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    tsv = mapped_column(TSVECTOR, Computed("to_tsvector('simple', content)", persisted=True))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SqlExample(Base):
    """Verified question → SQL pairs, retrieved as few-shot examples for text-to-SQL."""

    __tablename__ = "sql_examples"

    id: Mapped[str] = mapped_column(ID, primary_key=True, default=new_id)
    question: Mapped[str] = mapped_column(Text, unique=True)
    sql: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
