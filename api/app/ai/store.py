"""Conversation transcripts and pending actions (the confirm-to-run gate)."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.tools import Prepared, ToolContext, ToolError, execute_write
from app.core.config import get_settings
from app.core.errors import BadRequest, Conflict, DomainError, NotFound
from app.db.models import AIConversation, AIMessage, AIPendingAction, User

logger = logging.getLogger(__name__)

# ── conversations ────────────────────────────────────────────────────────────


async def get_or_create_conversation(
    session: AsyncSession, user: User, conversation_id: str | None, first_message: str
) -> AIConversation:
    if conversation_id:
        conversation = await session.get(AIConversation, conversation_id)
        if conversation is None or conversation.user_id != user.id:
            raise NotFound("Conversation not found")
        return conversation
    conversation = AIConversation(user_id=user.id, title=first_message[:120])
    session.add(conversation)
    await session.commit()
    return conversation


def _to_openai(m: AIMessage) -> dict:
    message: dict = {"role": m.role, "content": m.content}
    if m.tool_calls:
        message["tool_calls"] = m.tool_calls
    if m.tool_call_id:
        message["tool_call_id"] = m.tool_call_id
    return message


async def load_history(session: AsyncSession, conversation_id: str, limit: int = 30) -> list[dict]:
    rows = list(
        await session.scalars(
            select(AIMessage)
            .where(AIMessage.conversation_id == conversation_id)
            .order_by(AIMessage.seq.desc())
            .limit(limit)
        )
    )
    rows.reverse()
    # Never start mid tool-exchange: providers reject a tool result without its call.
    while rows and rows[0].role != "user":
        rows.pop(0)
    return [_to_openai(m) for m in rows]


async def append_messages(session: AsyncSession, conversation_id: str, messages: list[dict]) -> None:
    last = await session.scalar(
        select(func.coalesce(func.max(AIMessage.seq), 0)).where(AIMessage.conversation_id == conversation_id)
    )
    for offset, m in enumerate(messages, start=1):
        session.add(
            AIMessage(
                conversation_id=conversation_id,
                seq=last + offset,
                role=m["role"],
                content=m.get("content"),
                tool_calls=m.get("tool_calls"),
                tool_call_id=m.get("tool_call_id"),
            )
        )
    await session.commit()


async def visible_messages(session: AsyncSession, user: User, conversation_id: str) -> list[dict]:
    conversation = await session.get(AIConversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise NotFound("Conversation not found")
    rows = await session.scalars(
        select(AIMessage)
        .where(AIMessage.conversation_id == conversation_id, AIMessage.role.in_(("user", "assistant")))
        .order_by(AIMessage.seq)
    )
    return [{"role": m.role, "content": m.content, "created_at": m.created_at} for m in rows if m.content]


# ── pending actions ──────────────────────────────────────────────────────────


async def create_pending_action(
    session: AsyncSession, user_id: str, conversation_id: str | None, tool: str, prepared: Prepared
) -> AIPendingAction:
    ttl = timedelta(minutes=get_settings().pending_action_ttl_minutes)
    action = AIPendingAction(
        user_id=user_id,
        conversation_id=conversation_id,
        tool=tool,
        args=prepared.args,
        summary=prepared.summary,
        expires_at=datetime.now(UTC) + ttl,
    )
    session.add(action)
    await session.commit()
    return action


async def list_pending(session: AsyncSession, user: User) -> list[dict]:
    rows = await session.scalars(
        select(AIPendingAction)
        .where(
            AIPendingAction.user_id == user.id,
            AIPendingAction.status == "pending",
            AIPendingAction.expires_at > func.now(),
        )
        .order_by(AIPendingAction.created_at.desc())
    )
    return [
        {"actionId": a.id, "tool": a.tool, "summary": a.summary, "expiresAt": a.expires_at, "createdAt": a.created_at}
        for a in rows
    ]


@dataclass(frozen=True)
class _Claimed:
    """Plain copy of a claimed action. ORM objects are expired by rollback(), and
    touching an expired attribute in async SQLAlchemy raises MissingGreenlet."""

    id: str
    tool: str
    args: dict
    summary: str
    conversation_id: str | None


async def _claim(session: AsyncSession, user_id: str, action_id: str, new_status: str) -> _Claimed:
    """Atomically move a pending action to ``new_status``. Only one confirm can ever win."""
    claimed = await session.scalar(
        update(AIPendingAction)
        .where(
            AIPendingAction.id == action_id,
            AIPendingAction.user_id == user_id,
            AIPendingAction.status == "pending",
            AIPendingAction.expires_at > func.now(),
        )
        .values(status=new_status)
        .returning(AIPendingAction)
    )
    if claimed is not None:
        snapshot = _Claimed(claimed.id, claimed.tool, dict(claimed.args), claimed.summary, claimed.conversation_id)
        await session.commit()
        return snapshot

    await session.rollback()
    existing = await session.get(AIPendingAction, action_id)
    if existing is None or existing.user_id != user_id:
        raise NotFound("Action not found")
    if existing.status == "pending":
        raise BadRequest("This action has expired. Ask the assistant again.")
    raise Conflict(f"This action was already {existing.status}.")


async def confirm_action(session: AsyncSession, user: User, action_id: str) -> dict:
    action = await _claim(session, user.id, action_id, "executing")
    ctx = ToolContext(session=session, user=user)
    try:
        result = await execute_write(ctx, action.tool, action.args)
    except (ToolError, DomainError) as exc:
        await session.rollback()
        message = exc.message if isinstance(exc, DomainError) else str(exc)
        await _finish(session, action.id, "failed", error=message)
        await _note(session, action, f"[The proposed action failed: {action.summary}. Reason: {message}]")
        return {
            "status": "failed",
            "message": f"Couldn't complete that: {message}",
            "actionId": action.id,
            "tool": action.tool,
        }
    except Exception:
        logger.exception("Pending action %s crashed", action.id)
        await session.rollback()
        await _finish(session, action.id, "failed", error="internal error")
        raise

    await _finish(session, action.id, "executed", result=result)
    await _note(session, action, f"[The user confirmed and it was saved: {action.summary}]")
    return {
        "status": "executed",
        "message": f"Done: {action.summary}",
        "result": result,
        "actionId": action.id,
        "tool": action.tool,
    }


async def cancel_action(session: AsyncSession, user: User, action_id: str) -> dict:
    action = await _claim(session, user.id, action_id, "cancelled")
    await _note(session, action, f"[The user cancelled: {action.summary}]")
    return {
        "status": "cancelled",
        "message": "Cancelled. Nothing was changed.",
        "actionId": action.id,
        "tool": action.tool,
    }


async def _finish(session: AsyncSession, action_id: str, status: str, result=None, error=None) -> None:
    await session.execute(
        update(AIPendingAction)
        .where(AIPendingAction.id == action_id)
        .values(status=status, result=result, error=error, executed_at=func.now())
    )
    await session.commit()


async def _note(session: AsyncSession, action: _Claimed, text: str) -> None:
    """Record the outcome in the transcript so the model knows what happened next turn."""
    if action.conversation_id:
        await append_messages(session, action.conversation_id, [{"role": "assistant", "content": text}])
