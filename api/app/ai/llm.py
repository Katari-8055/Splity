"""Model-agnostic LLM access.

The agent depends only on the ``LLMClient`` protocol. Production uses
LiteLLM, so Gemini, Claude and GPT are a config change. Tests use
``ScriptedLLM``, so agent behaviour is tested without network calls.
"""

import json
import logging
import time
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class LLMError(Exception):
    """The model call failed after retries (timeout, quota, provider outage)."""


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]
    raw_arguments: str = ""


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0


@dataclass
class Completion:
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    latency_ms: int = 0

    def as_message(self) -> dict:
        """Render as an OpenAI-format assistant message for the conversation history."""
        message: dict[str, Any] = {"role": "assistant", "content": self.content or None}
        if self.tool_calls:
            message["tool_calls"] = [
                {
                    "id": c.id,
                    "type": "function",
                    "function": {"name": c.name, "arguments": json.dumps(c.arguments)},
                }
                for c in self.tool_calls
            ]
        return message


@dataclass
class TextDelta:
    text: str


StreamEvent = TextDelta | Completion


class LLMClient(Protocol):
    def stream(self, messages: list[dict], tools: Sequence[dict] | None = None) -> AsyncIterator[StreamEvent]:
        """Yield TextDelta chunks as they arrive, then exactly one final Completion."""
        ...

    async def complete_json(self, messages: list[dict], schema: dict) -> dict:
        """Single non-streaming call that must return a JSON object matching ``schema``.
        Messages may contain images or audio (OpenAI-style content parts)."""
        ...

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """One embedding vector (EMBEDDING_DIM floats) per input text."""
        ...


def _parse_arguments(raw: str | dict | None) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {"__invalid_json__": raw}
    return value if isinstance(value, dict) else {"__invalid_json__": raw}


class LiteLLMClient:
    def __init__(self, model: str | None = None):
        settings = get_settings()
        self.model = model or settings.llm_model
        self.timeout = settings.llm_timeout_seconds
        self.retries = settings.llm_max_retries

    @property
    def models(self) -> list[str]:
        """Primary model first, then fallbacks (only used when a model fails before producing output)."""
        if self.model != get_settings().llm_model:
            return [self.model]  # an explicitly chosen model (e.g. in evals) never silently falls back
        return list(dict.fromkeys([self.model, *get_settings().llm_fallback_models]))

    def _kwargs(self, model: str) -> dict:
        if model.startswith("gemini/") and not get_settings().gemini_api_key:
            # Fail fast and clearly instead of spending retries on a request that can't succeed.
            raise LLMError("GEMINI_API_KEY is not set")
        # drop_params: newer models reject some settings (gemini-3.8-flash rejects temperature);
        # dropping unsupported ones keeps the client portable across providers.
        kwargs: dict[str, Any] = {
            "model": model,
            "timeout": self.timeout,
            "num_retries": self.retries,
            "drop_params": True,
        }
        if model.startswith("gemini/"):
            kwargs["api_key"] = get_settings().gemini_api_key
        return kwargs

    async def stream(self, messages, tools=None):
        import litellm

        started = time.perf_counter()
        errors: list[str] = []
        for model in self.models:
            chunks = []
            produced_output = False
            try:
                response = await litellm.acompletion(
                    messages=messages,
                    tools=list(tools) if tools else None,
                    stream=True,
                    stream_options={"include_usage": True},
                    temperature=0.1,
                    **self._kwargs(model),
                )
                async for chunk in response:
                    chunks.append(chunk)
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta is not None and getattr(delta, "content", None):
                        produced_output = True
                        yield TextDelta(delta.content)
                full = litellm.stream_chunk_builder(chunks, messages=messages)
                break
            except LLMError:
                raise
            except Exception as exc:  # provider SDKs raise many exception types
                errors.append(f"{model}: {type(exc).__name__}: {exc}")
                if produced_output:  # the user already saw partial text; don't mix two models' answers
                    raise LLMError(errors[-1]) from exc
                logger.warning("LLM %s failed, trying next fallback: %s", model, type(exc).__name__)
        else:
            raise LLMError(" | ".join(errors))

        message = full.choices[0].message
        tool_calls = [
            ToolCall(
                id=c.id or f"call_{i}",
                name=c.function.name,
                arguments=_parse_arguments(c.function.arguments),
                raw_arguments=c.function.arguments or "",
            )
            for i, c in enumerate(message.tool_calls or [])
        ]
        usage = getattr(full, "usage", None)
        try:
            cost = float(litellm.completion_cost(completion_response=full) or 0)
        except Exception:
            cost = 0.0
        yield Completion(
            content=message.content or "",
            tool_calls=tool_calls,
            usage=Usage(
                prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
                cost_usd=cost,
            ),
            model=model,  # the model that actually answered (may be a fallback)
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    async def complete_json(self, messages, schema):
        import litellm

        errors: list[str] = []
        for model in self.models:
            try:
                response = await litellm.acompletion(
                    messages=messages,
                    response_format={"type": "json_schema", "json_schema": {"name": "result", "schema": schema}},
                    temperature=0,
                    **self._kwargs(model),
                )
                return json.loads(response.choices[0].message.content)
            except LLMError:
                raise
            except Exception as exc:
                errors.append(f"{model}: {type(exc).__name__}: {exc}")
        raise LLMError(" | ".join(errors))


    async def embed(self, texts):
        import litellm

        from app.db.models import EMBEDDING_DIM

        settings = get_settings()
        kwargs: dict[str, Any] = {"model": settings.embedding_model, "dimensions": EMBEDDING_DIM, "drop_params": True}
        if settings.embedding_model.startswith("gemini/"):
            if not settings.gemini_api_key:
                raise LLMError("GEMINI_API_KEY is not set")
            kwargs["api_key"] = settings.gemini_api_key
        try:
            response = await litellm.aembedding(input=texts, timeout=self.timeout, **kwargs)
        except Exception as exc:
            raise LLMError(f"{type(exc).__name__}: {exc}") from exc
        return [_normalize(item["embedding"]) for item in response.data]


def _normalize(vector: list[float]) -> list[float]:
    """Unit-length vectors, so cosine distance works when providers truncate dimensions."""
    norm = sum(v * v for v in vector) ** 0.5 or 1.0
    return [v / norm for v in vector]


def fake_embedding(text: str) -> list[float]:
    """Deterministic bag-of-words embedding for tests: shared words → similar vectors."""
    import hashlib

    from app.db.models import EMBEDDING_DIM

    vector = [0.0] * EMBEDDING_DIM
    for word in text.lower().split():
        bucket = int(hashlib.md5(word.strip(".,!?").encode()).hexdigest(), 16) % EMBEDDING_DIM
        vector[bucket] += 1.0
    return _normalize(vector)


# ── test double ──────────────────────────────────────────────────────────────

ScriptStep = Completion | Callable[[list[dict]], Completion] | Exception


class ScriptedLLM:
    """Plays back a fixed list of responses and records what the agent sent."""

    def __init__(self, steps: list[ScriptStep], json_result: dict | Exception | None = None):
        self.steps = list(steps)
        self.json_result = json_result
        self.calls: list[list[dict]] = []
        self.tools_seen: list[list[str]] = []

    async def stream(self, messages, tools=None):
        self.calls.append([dict(m) for m in messages])
        self.tools_seen.append([t["function"]["name"] for t in tools or []])
        if not self.steps:
            raise AssertionError("ScriptedLLM ran out of steps")
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise LLMError(str(step))
        completion = step(messages) if callable(step) else step
        for word in completion.content.split(" ") if completion.content else []:
            yield TextDelta(word + " ")
        yield completion

    async def complete_json(self, messages, schema):
        self.calls.append(messages)
        result = self.json_result
        if isinstance(result, list):
            result = result.pop(0) if result else {}
        if isinstance(result, Exception):
            raise LLMError(str(result))
        return result or {}

    async def embed(self, texts):
        return [fake_embedding(t) for t in texts]


def say(text: str) -> Completion:
    return Completion(content=text)


def call(name: str, call_id: str | None = None, **arguments) -> Completion:
    return Completion(tool_calls=[ToolCall(id=call_id or f"call_{name}", name=name, arguments=arguments)])


_override: LLMClient | None = None


def get_llm() -> LLMClient:
    return _override or LiteLLMClient()


def set_llm_override(client: LLMClient | None) -> None:
    """Used by tests and the eval harness to inject a model."""
    global _override
    _override = client
