"""Aggregations behind the AI Ops dashboard, all computed in Postgres."""

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.db.models import AITrace

_WINDOW = "created_at >= now() - make_interval(days => :days)"


async def _rows(session: AsyncSession, sql: str, days: int) -> list[dict]:
    result = await session.execute(text(sql), {"days": days})
    return [dict(r._mapping) for r in result]


async def summary(session: AsyncSession, days: int = 7) -> dict:
    totals = (
        await _rows(
            session,
            f"""
            SELECT count(*) AS requests,
                   count(*) FILTER (WHERE status IN ('error', 'failed')) AS errors,
                   count(*) FILTER (WHERE status = 'gave_up') AS gave_up,
                   count(*) FILTER (WHERE status = 'proposed') AS proposals,
                   COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0) AS p50_ms,
                   COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) AS p95_ms,
                   COALESCE(sum(cost_usd), 0) AS cost_usd,
                   COALESCE(sum(prompt_tokens + completion_tokens), 0) AS tokens,
                   COALESCE(avg(llm_calls) FILTER (WHERE kind = 'chat'), 0) AS avg_llm_calls
            FROM ai_traces WHERE {_WINDOW}
            """,
            days,
        )
    )[0]
    requests = totals["requests"] or 0
    totals["error_rate"] = round(totals["errors"] / requests, 4) if requests else 0
    totals["cost_per_request_usd"] = float(totals["cost_usd"]) / requests if requests else 0

    actions = (
        await _rows(
            session,
            f"""
            SELECT count(*) FILTER (WHERE status = 'executed') AS confirmed,
                   count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                   count(*) FILTER (WHERE status = 'failed') AS failed,
                   count(*) FILTER (WHERE status = 'pending' AND expires_at < now()) AS expired
            FROM ai_pending_actions WHERE {_WINDOW}
            """,
            days,
        )
    )[0]

    daily = await _rows(
        session,
        f"""
        SELECT date_trunc('day', created_at)::date AS day, count(*) AS requests,
               count(*) FILTER (WHERE status IN ('error', 'failed')) AS errors,
               COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) AS p95_ms,
               COALESCE(sum(cost_usd), 0) AS cost_usd
        FROM ai_traces WHERE {_WINDOW}
        GROUP BY day ORDER BY day
        """,
        days,
    )

    tools = await _rows(
        session,
        f"""
        SELECT s->>'name' AS name, count(*) AS calls,
               count(*) FILTER (WHERE (s->>'ok')::boolean IS FALSE) AS failures,
               round(avg((s->>'ms')::int)) AS avg_ms,
               COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY (s->>'ms')::int), 0) AS p95_ms
        FROM ai_traces, jsonb_array_elements(spans) AS s
        WHERE {_WINDOW} AND s->>'kind' = 'tool'
        GROUP BY name ORDER BY calls DESC
        """,
        days,
    )

    models = await _rows(
        session,
        f"""
        SELECT COALESCE(model, 'n/a') AS model, COALESCE(prompt_version, 'n/a') AS prompt_version,
               count(*) AS requests,
               count(*) FILTER (WHERE status IN ('error', 'failed')) AS errors,
               COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) AS p95_ms,
               COALESCE(avg(cost_usd), 0) AS avg_cost_usd
        FROM ai_traces WHERE {_WINDOW} AND kind = 'chat'
        GROUP BY 1, 2 ORDER BY requests DESC
        """,
        days,
    )

    by_status = await _rows(
        session,
        f"SELECT kind, status, count(*) AS n FROM ai_traces WHERE {_WINDOW} GROUP BY 1, 2 ORDER BY 1, 3 DESC",
        days,
    )

    return {
        "days": days,
        "totals": totals,
        "actions": actions,
        "daily": daily,
        "tools": tools,
        "models": models,
        "byStatus": by_status,
    }


_LIST_COLUMNS = (
    AITrace.id,
    AITrace.created_at,
    AITrace.kind,
    AITrace.status,
    AITrace.model,
    AITrace.latency_ms,
    AITrace.llm_calls,
    AITrace.cost_usd,
    AITrace.input_preview,
    AITrace.error,
)


async def list_traces(session: AsyncSession, *, status: str | None, order: str, limit: int) -> list[dict]:
    query = select(*_LIST_COLUMNS)
    if status == "errors":
        query = query.where(AITrace.status.in_(("error", "failed")))
    elif status:
        query = query.where(AITrace.status == status)
    query = query.order_by(AITrace.latency_ms.desc() if order == "slowest" else AITrace.created_at.desc())
    rows = await session.execute(query.limit(limit))
    return [dict(r._mapping) for r in rows]


async def get_trace(session: AsyncSession, trace_id: str) -> dict:
    trace = await session.get(AITrace, trace_id)
    if trace is None:
        raise NotFound("Trace not found")
    return {c.name: getattr(trace, c.name) for c in AITrace.__table__.columns}
