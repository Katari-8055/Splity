"""Trace recording and optional Langfuse export.

Every AI request writes one ``ai_traces`` row. If LANGFUSE_PUBLIC_KEY and
LANGFUSE_SECRET_KEY are set (and the ``langfuse`` package is installed),
LiteLLM also sends each LLM call to Langfuse.
"""

import logging
import os
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.db.models import AITrace

logger = logging.getLogger(__name__)


@dataclass
class TraceData:
    kind: str
    status: str
    user_id: str | None = None
    conversation_id: str | None = None
    model: str | None = None
    prompt_version: str | None = None
    input_preview: str | None = None
    output_preview: str | None = None
    latency_ms: int = 0
    spans: list[dict] = field(default_factory=list)
    error: str | None = None


def build_spans(raw: list[dict], started: float) -> list[dict]:
    """Merge LLM and tool entries into one timeline, with offsets in ms from the request start."""
    spans = []
    for entry in sorted(raw, key=lambda e: e.get("t", 0)):
        span = {k: v for k, v in entry.items() if k != "t"}
        span["start_ms"] = int((entry.get("t", started) - started) * 1000)
        spans.append(span)
    return spans


async def record(factory_or_session: AsyncSession | async_sessionmaker, data: TraceData) -> str | None:
    """Persist a trace. Never raises: observability must not break the request."""
    llm = [s for s in data.spans if s.get("kind") == "llm"]
    trace = AITrace(
        user_id=data.user_id,
        conversation_id=data.conversation_id,
        kind=data.kind,
        status=data.status,
        model=data.model or (llm[0].get("model") if llm else None),
        prompt_version=data.prompt_version,
        input_preview=(data.input_preview or "")[:500] or None,
        output_preview=(data.output_preview or "")[:1000] or None,
        llm_calls=len(llm),
        prompt_tokens=sum(s.get("prompt_tokens", 0) for s in llm),
        completion_tokens=sum(s.get("completion_tokens", 0) for s in llm),
        cost_usd=round(sum(s.get("cost_usd", 0.0) for s in llm), 6),
        latency_ms=data.latency_ms,
        spans=data.spans,
        error=(data.error or "")[:2000] or None,
    )
    try:
        if isinstance(factory_or_session, AsyncSession):
            factory_or_session.add(trace)
            await factory_or_session.commit()
        else:
            async with factory_or_session() as session:
                session.add(trace)
                await session.commit()
        return trace.id
    except Exception:
        logger.exception("Failed to record AI trace")
        return None


def configure_langfuse() -> bool:
    settings = get_settings()
    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        return False
    try:
        import langfuse  # noqa: F401
        import litellm
    except ImportError:
        logger.warning("Langfuse keys are set but the 'langfuse' package is not installed (uv add langfuse)")
        return False
    os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
    os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)
    os.environ.setdefault("LANGFUSE_HOST", settings.langfuse_host.strip('"'))
    # Langfuse SDK v3+ is OpenTelemetry-based; LiteLLM's matching integration is "langfuse_otel".
    for hooks in (litellm.success_callback, litellm.failure_callback):
        if "langfuse_otel" not in hooks:
            hooks.append("langfuse_otel")
    logger.info("Langfuse export enabled (%s)", settings.langfuse_host)
    return True
