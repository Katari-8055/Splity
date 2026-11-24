"""LangGraph agent: llm → (tools → llm)* → answer.

    START → llm ─┬─ tool calls ──→ tools ─┬─ step budget left → llm
                 └─ text answer → END     └─ budget used up → give_up → END

- Read tools run immediately. Write tools only create a pending action, and
  after that the model gets no tools, so it can only tell the user to confirm.
- Everything the UI needs (tokens, tool progress) goes out through LangGraph's
  custom stream writer.
"""

import json
import operator
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.ai import store, tracing
from app.ai.llm import Completion, LLMClient, LLMError, TextDelta
from app.ai.prompts import PROMPT_VERSION, build_system_prompt
from app.ai.tools import TOOLS, ToolContext, ToolError, openai_tools, prepare_write, run_read
from app.ai.tracing import TraceData, build_spans
from app.core.config import get_settings
from app.services import friends as friends_service
from app.services import groups as groups_service

MAX_TOOL_RESULT_CHARS = 8000
GIVE_UP_MESSAGE = "I couldn't finish that in a reasonable number of steps. Could you ask in a simpler way?"
UNAVAILABLE_MESSAGE = "Sorry, the AI service is unavailable right now. Please try again in a moment."


class AgentState(TypedDict):
    messages: Annotated[list[dict], operator.add]
    steps: int
    pending: dict | None
    tool_log: Annotated[list[dict], operator.add]
    usage: Annotated[list[dict], operator.add]


@dataclass
class AgentDeps:
    ctx: ToolContext
    llm: LLMClient
    system_prompt: str
    conversation_id: str | None
    max_steps: int = field(default_factory=lambda: get_settings().agent_max_steps)


def _deps(config: RunnableConfig) -> AgentDeps:
    return config["configurable"]["deps"]


async def llm_node(state: AgentState, config: RunnableConfig) -> dict:
    deps = _deps(config)
    write = get_stream_writer()
    # Once a change has been proposed, take the tools away: the model can only ask for confirmation.
    tools = None if state.get("pending") else openai_tools()
    completion: Completion | None = None
    async for event in deps.llm.stream([{"role": "system", "content": deps.system_prompt}, *state["messages"]], tools):
        if isinstance(event, TextDelta):
            write({"type": "token", "text": event.text})
        else:
            completion = event
    assert completion is not None
    if tools is None:
        completion.tool_calls = []
    return {
        "messages": [completion.as_message()],
        "steps": state["steps"] + 1,
        "usage": [
            {
                "kind": "llm",
                "t": time.perf_counter(),
                "model": completion.model,
                "prompt_tokens": completion.usage.prompt_tokens,
                "completion_tokens": completion.usage.completion_tokens,
                "cost_usd": completion.usage.cost_usd,
                "latency_ms": completion.latency_ms,
            }
        ],
    }


def _tool_message(call_id: str, payload: Any) -> dict:
    content = json.dumps(payload, ensure_ascii=False, default=str)
    if len(content) > MAX_TOOL_RESULT_CHARS:
        content = content[:MAX_TOOL_RESULT_CHARS] + '..."[truncated]"'
    return {"role": "tool", "tool_call_id": call_id, "content": content}


async def tools_node(state: AgentState, config: RunnableConfig) -> dict:
    deps = _deps(config)
    write = get_stream_writer()
    pending = state.get("pending")
    replies, log = [], []

    for call in state["messages"][-1].get("tool_calls", []):
        name = call["function"]["name"]
        raw = json.loads(call["function"]["arguments"] or "{}")
        spec = TOOLS.get(name)
        mutates = bool(spec and spec.mutates)
        write({"type": "tool_start", "name": name})
        started = time.perf_counter()
        ok = True
        try:
            if mutates and pending:
                payload = {"error": "Only one change can be proposed at a time. Ask the user to confirm the first."}
                ok = False
            elif mutates:
                prepared = await prepare_write(deps.ctx, name, raw)
                action = await store.create_pending_action(
                    deps.ctx.session, deps.ctx.user.id, deps.conversation_id, name, prepared
                )
                pending = {
                    "actionId": action.id,
                    "tool": name,
                    "summary": prepared.summary,
                    "preview": prepared.preview,
                    "expiresAt": action.expires_at.isoformat(),
                }
                payload = {
                    "status": "awaiting_user_confirmation",
                    "summary": prepared.summary,
                    "note": "NOT saved yet. Tell the user to review it and press Confirm.",
                }
            else:
                payload = await run_read(deps.ctx, name, raw)
        except ToolError as exc:
            payload, ok = {"error": str(exc)}, False
        elapsed = int((time.perf_counter() - started) * 1000)
        write({"type": "tool_end", "name": name, "ok": ok})
        replies.append(_tool_message(call["id"], payload))
        log.append(
            {"kind": "tool", "t": started, "name": name, "ok": ok, "mutates": mutates, "ms": elapsed, "args": raw}
        )

    return {"messages": replies, "pending": pending, "tool_log": log}


async def give_up_node(state: AgentState) -> dict:
    get_stream_writer()({"type": "token", "text": GIVE_UP_MESSAGE})
    return {"messages": [{"role": "assistant", "content": GIVE_UP_MESSAGE}]}


def after_llm(state: AgentState) -> str:
    return "tools" if state["messages"][-1].get("tool_calls") else END


def after_tools(state: AgentState, config: RunnableConfig) -> str:
    return "llm" if state["steps"] < _deps(config).max_steps else "give_up"


def _build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("llm", llm_node)
    graph.add_node("tools", tools_node)
    graph.add_node("give_up", give_up_node)
    graph.add_edge(START, "llm")
    graph.add_conditional_edges("llm", after_llm, ["tools", END])
    graph.add_conditional_edges("tools", after_tools, ["llm", "give_up"])
    graph.add_edge("give_up", END)
    return graph.compile()


GRAPH = _build_graph()


async def system_prompt_for(ctx: ToolContext) -> str:
    friends = await friends_service.list_friends(ctx.session, ctx.user.id)
    groups = await groups_service.list_groups(ctx.session, ctx.user.id)
    return build_system_prompt(
        ctx.user.name, [f.name for f in friends], [g["name"] for g in groups], datetime.now(UTC).date()
    )


async def run_turn(
    ctx: ToolContext, llm: LLMClient, user_message: str, conversation_id: str | None
) -> AsyncIterator[dict]:
    """Run one chat turn and yield UI events. Persists the turn to the transcript."""
    conversation = await store.get_or_create_conversation(ctx.session, ctx.user, conversation_id, user_message)
    yield {"type": "conversation", "conversationId": conversation.id}

    history = await store.load_history(ctx.session, conversation.id)
    user_msg = {"role": "user", "content": user_message}
    initial: AgentState = {"messages": [*history, user_msg], "steps": 0, "pending": None, "tool_log": [], "usage": []}
    deps = AgentDeps(ctx=ctx, llm=llm, system_prompt=await system_prompt_for(ctx), conversation_id=conversation.id)
    config: RunnableConfig = {"configurable": {"deps": deps}, "recursion_limit": 4 * deps.max_steps + 5}

    started = time.perf_counter()
    final: AgentState | None = None  # latest state snapshot, kept even if a later step fails

    def trace(status: str, answer: str | None, error: str | None = None) -> TraceData:
        spans = (final or {}).get("usage", []) + (final or {}).get("tool_log", [])
        return TraceData(
            kind="chat",
            status=status,
            user_id=ctx.user.id,
            conversation_id=conversation.id,
            model=getattr(llm, "model", None),
            prompt_version=PROMPT_VERSION,
            input_preview=user_message,
            output_preview=answer,
            latency_ms=int((time.perf_counter() - started) * 1000),
            spans=build_spans(spans, started),
            error=error,
        )

    try:
        async for mode, chunk in GRAPH.astream(initial, config, stream_mode=["custom", "values"]):
            if mode == "custom":
                yield chunk
            else:
                final = chunk
    except LLMError as exc:
        # Keep the stored transcript valid: never save half a tool exchange.
        await store.append_messages(
            ctx.session, conversation.id, [user_msg, {"role": "assistant", "content": UNAVAILABLE_MESSAGE}]
        )
        trace_id = await tracing.record(ctx.session, trace("error", UNAVAILABLE_MESSAGE, str(exc)))
        yield {"type": "error", "message": UNAVAILABLE_MESSAGE, "traceId": trace_id}
        return

    assert final is not None
    new_messages = final["messages"][len(history) :]
    await store.append_messages(ctx.session, conversation.id, new_messages)

    if final["pending"]:
        yield {"type": "confirmation", **final["pending"]}
    answer = next((m["content"] for m in reversed(new_messages) if m["role"] == "assistant" and m.get("content")), "")
    if not answer:
        answer = "Please review the details below and confirm." if final["pending"] else "Done."
    status = "proposed" if final["pending"] else "gave_up" if answer == GIVE_UP_MESSAGE else "ok"
    record = trace(status, answer)
    trace_id = await tracing.record(ctx.session, record)
    llm_spans = [s for s in record.spans if s["kind"] == "llm"]
    yield {
        "type": "done",
        "message": answer,
        "conversationId": conversation.id,
        "traceId": trace_id,
        "tools": [{k: v for k, v in s.items() if k != "kind"} for s in record.spans if s["kind"] == "tool"],
        "usage": {
            "llm_calls": len(llm_spans),
            "prompt_tokens": sum(s["prompt_tokens"] for s in llm_spans),
            "completion_tokens": sum(s["completion_tokens"] for s in llm_spans),
            "cost_usd": round(sum(s["cost_usd"] for s in llm_spans), 6),
            "latency_ms": record.latency_ms,
        },
        "promptVersion": PROMPT_VERSION,
    }
