"""Chat (Server-Sent Events), the confirm/cancel gate, and categorisation."""

import json
import time
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai import ops, store, tracing
from app.ai.agent import run_turn
from app.ai.categorize import categorize
from app.ai.guardrails import clean_user_input
from app.ai.llm import LLMError, get_llm
from app.ai.tools import ToolContext
from app.ai.tracing import TraceData
from app.ai.voice import sniff_audio, transcribe
from app.api.deps import CurrentUser, SessionDep
from app.api.schemas import CamelModel
from app.core.config import get_settings
from app.core.errors import BadRequest, Forbidden, TooManyRequests
from app.core.rate_limit import SlidingWindowLimiter
from app.db.models import User
from app.db.session import get_session_factory

router = APIRouter(prefix="/ai", tags=["ai"])
ai_limiter = SlidingWindowLimiter(get_settings().ai_rate_limit_per_minute, 60)

FactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]


class ChatIn(CamelModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = None


class CategorizeIn(CamelModel):
    description: str = Field(min_length=1, max_length=300)
    amount: float | None = None


def enforce_ai_limit(user: User) -> None:
    if not ai_limiter.hit(user.id):
        raise TooManyRequests("Too many AI requests. Please slow down and try again shortly.")


async def _events(factory: async_sessionmaker[AsyncSession], user_id: str, body: ChatIn) -> AsyncIterator[dict]:
    async with factory() as session:
        user = await session.get(User, user_id)
        ctx = ToolContext(session=session, user=user)
        async for event in run_turn(ctx, get_llm(), body.message, body.conversation_id):
            yield event


def _sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"


@router.post("/chat")
async def chat(body: ChatIn, user: CurrentUser, factory: FactoryDep, stream: bool = Query(default=True)):
    """Streams ``conversation``, ``token``, ``tool_start``/``tool_end``, ``confirmation``,
    ``done`` or ``error`` events. ``?stream=false`` returns one JSON object instead
    (used by the eval harness)."""
    enforce_ai_limit(user)
    if not stream:
        result: dict = {"tools": [], "confirmation": None}
        async for event in _events(factory, user.id, body):
            if event["type"] in ("done", "error"):
                result.update(event)
            elif event["type"] == "confirmation":
                result["confirmation"] = event
            elif event["type"] == "conversation":
                result["conversationId"] = event["conversationId"]
        return result

    async def body_stream():
        async for event in _events(factory, user.id, body):
            yield _sse(event)

    return StreamingResponse(
        body_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/actions")
async def pending_actions(user: CurrentUser, session: SessionDep):
    """Changes proposed by the assistant or an MCP client that are waiting for this user's decision."""
    return await store.list_pending(session, user)


@router.post("/actions/{action_id}/confirm")
async def confirm(action_id: str, user: CurrentUser, session: SessionDep, factory: FactoryDep):
    user_id = user.id  # read before confirm: a failed action rolls back, which expires ORM objects
    started = time.perf_counter()
    result = await store.confirm_action(session, user, action_id)
    ms = int((time.perf_counter() - started) * 1000)
    ok = result["status"] == "executed"
    await tracing.record(
        factory,
        TraceData(
            kind="action",
            status=result["status"],
            user_id=user_id,
            input_preview=f"confirm {result['tool']}",
            output_preview=result["message"],
            latency_ms=ms,
            spans=[{"kind": "tool", "name": f"{result['tool']}:execute", "ok": ok, "ms": ms, "start_ms": 0}],
            error=None if ok else result["message"],
        ),
    )
    return result


@router.post("/actions/{action_id}/cancel")
async def cancel(action_id: str, user: CurrentUser, session: SessionDep):
    return await store.cancel_action(session, user, action_id)


@router.get("/conversations/{conversation_id}/messages")
async def conversation_messages(conversation_id: str, user: CurrentUser, session: SessionDep):
    return await store.visible_messages(session, user, conversation_id)


async def traced_categorize(factory, user: User, description: str, amount: float | None) -> dict:
    llm = get_llm()
    started = time.perf_counter()
    result = await categorize(llm, description, amount)
    ms = int((time.perf_counter() - started) * 1000)
    await tracing.record(
        factory,
        TraceData(
            kind="categorize",
            status="error" if result["fallback"] else "ok",
            user_id=user.id,
            model=getattr(llm, "model", None),
            input_preview=description,
            output_preview=f"{result['category']} / {result['subcategory']} ({result['confidence']})",
            latency_ms=ms,
            spans=[{"kind": "llm", "model": getattr(llm, "model", None), "latency_ms": ms, "start_ms": 0}],
            error="fell back to Other" if result["fallback"] else None,
        ),
    )
    return result


@router.post("/categorize")
async def categorize_expense(body: CategorizeIn, user: CurrentUser, factory: FactoryDep):
    enforce_ai_limit(user)
    return await traced_categorize(factory, user, body.description, body.amount)


# ── AI Ops (admins only) ─────────────────────────────────────────────────────


async def require_admin(user: CurrentUser) -> User:
    if user.email not in {e.lower() for e in get_settings().admin_emails}:
        raise Forbidden("AI Ops is only available to admins")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


@router.get("/ops/summary")
async def ops_summary(_: AdminUser, session: SessionDep, days: int = Query(default=7, ge=1, le=90)):
    return await ops.summary(session, days)


@router.get("/ops/traces")
async def ops_traces(
    _: AdminUser,
    session: SessionDep,
    status: str | None = Query(default=None, max_length=20),
    order: str = Query(default="recent", pattern="^(recent|slowest)$"),
    limit: int = Query(default=20, ge=1, le=100),
):
    return await ops.list_traces(session, status=status, order=order, limit=limit)


@router.get("/ops/traces/{trace_id}")
async def ops_trace(trace_id: str, _: AdminUser, session: SessionDep):
    return await ops.get_trace(session, trace_id)


@router.get("/ops/me")
async def ops_access(user: CurrentUser):
    """Lets the UI decide whether to show the AI Ops link."""
    return {"isAdmin": user.email in {e.lower() for e in get_settings().admin_emails}}


# ── voice ────────────────────────────────────────────────────────────────────


@router.post("/transcribe")
async def transcribe_audio(user: CurrentUser, audio: UploadFile = File(...)):
    """Voice note → text. The client puts the text in the input box for the user to check before sending."""
    enforce_ai_limit(user)
    data = await audio.read(get_settings().max_audio_bytes + 1)
    if len(data) > get_settings().max_audio_bytes:
        raise BadRequest("Voice note is too long")
    mime = sniff_audio(data)
    if mime is None:
        raise BadRequest("Unsupported audio format (use webm, ogg, wav, mp3 or m4a)")
    try:
        result = await transcribe(get_llm(), data, mime)
    except LLMError as exc:
        raise BadRequest("Couldn't understand the voice note. Please try again or type instead.") from exc
    return {"text": clean_user_input(result.text), "language": result.language}


# ── RAG maintenance (admins) ─────────────────────────────────────────────────


@router.post("/ops/reindex")
async def reindex(_: AdminUser, session: SessionDep):
    """Rebuild search chunks and embeddings for all expenses, messages and receipts, and seed SQL examples."""
    from app.ai.rag import reindex_all
    from app.ai.sql_agent import seed_examples

    counts = await reindex_all(session, get_llm())
    counts["sql_examples"] = await seed_examples(session, get_llm())
    return counts
