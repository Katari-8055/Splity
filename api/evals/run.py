"""Run the eval suites against a real model and write EVALS.md.

    uv run python -m evals.run                                   # all suites, default model
    uv run python -m evals.run --suite agent redteam --limit 10
    uv run python -m evals.run --models gemini/gemini-3.8-flash gemini/gemini-3.6-flash   # comparison table

Needs EVAL_DATABASE_URL (a disposable database; its schema is dropped and rebuilt)
and a model API key. Writes evals/results/<timestamp>.json and EVALS.md.
"""

import argparse
import asyncio
import json
import os
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path

import yaml
from httpx import ASGITransport, AsyncClient
from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.ai.llm import LiteLLMClient, set_llm_override
from app.ai.rag import enable_background_indexing, search
from app.ai.sql_agent import UnsafeSQL, answer_question, run_readonly
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import create_engine, get_session, get_session_factory
from evals.scoring import percentile, rows_equal, score_agent_case
from evals.world import World, build_world

ROOT = Path(__file__).resolve().parent
API_ROOT = ROOT.parent
SUITES = ("agent", "sql", "rag", "redteam")


def load(name: str) -> list[dict]:
    return yaml.safe_load((ROOT / "datasets" / f"{name}.yaml").read_text(encoding="utf-8")) or []


async def reset_database(url: str) -> None:
    from alembic import command
    from alembic.config import Config

    engine = create_engine(url, poolclass=pool.NullPool)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("DROP SCHEMA IF EXISTS analytics CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    cfg.attributes["database_url"] = url
    await asyncio.to_thread(command.upgrade, cfg, "head")


# ── suites ───────────────────────────────────────────────────────────────────


async def chat_cases(http: AsyncClient, token: str, cases: list[dict], label: str) -> list[dict]:
    results = []
    for n, case in enumerate(cases, start=1):
        started = time.perf_counter()
        res = await http.post(
            "/api/ai/chat?stream=false",
            json={"message": case["input"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        body = res.json() if res.status_code == 200 else {"type": "error", "message": res.text}
        scored = score_agent_case(case, body)
        usage = body.get("usage", {})
        results.append(
            {
                "id": case["id"],
                "category": case.get("category"),
                "lang": case.get("lang", "en"),
                "input": case["input"],
                "reply": body.get("message"),
                "latency_ms": usage.get("latency_ms") or int((time.perf_counter() - started) * 1000),
                "cost_usd": usage.get("cost_usd", 0),
                "tokens": usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0),
                **scored,
            }
        )
        print(f"  [{label} {n}/{len(cases)}] {case['id']}: {'PASS' if scored['pass'] else 'FAIL'}", flush=True)
    return results


async def sql_suite(factory, llm, world: World, cases: list[dict]) -> list[dict]:
    results = []
    for n, case in enumerate(cases, start=1):
        async with factory() as session:
            started = time.perf_counter()
            entry = {"id": case["id"], "question": case["question"]}
            try:
                generated = await answer_question(session, llm, world.me.id, case["question"])
                entry.update(sql=generated.sql, attempts=generated.attempts)
                if "reference" in case:
                    _, expected = await run_readonly(session, world.me.id, case["reference"])
                    entry["pass"] = rows_equal(generated.rows, expected)
                    if not entry["pass"]:
                        entry["notes"] = [f"got {generated.rows[:5]}, expected {expected[:5]}"]
                else:
                    dump = json.dumps(generated.rows, default=str)
                    leaked = [s for s in case.get("expect_refusal_or_no_leak", []) if s in dump]
                    entry["pass"], entry["notes"] = not leaked, [f"leaked {s}" for s in leaked]
            except UnsafeSQL as exc:
                entry["refused"] = str(exc)[:200]
                entry["pass"] = "reference" not in case  # refusing a safety case is a pass
            entry["latency_ms"] = int((time.perf_counter() - started) * 1000)
        results.append(entry)
        print(f"  [sql {n}/{len(cases)}] {case['id']}: {'PASS' if entry['pass'] else 'FAIL'}", flush=True)
    return results


JUDGE_SCHEMA = {
    "type": "object",
    "properties": {"faithful": {"type": "boolean"}, "reason": {"type": "string"}},
    "required": ["faithful"],
}


async def rag_suite(factory, llm, http, token, world: World, cases: list[dict]) -> list[dict]:
    def ref(key):
        if key is None:
            return None
        matches = [v for k, v in world.refs.items() if k.startswith(key) or key.startswith(k)]
        return matches[0] if matches else None

    results = []
    for n, case in enumerate(cases, start=1):
        async with factory() as session:
            hits = await search(session, llm, world.me.id, case["query"], k=5)
        ids = [h.source_id for h in hits]
        expected, forbidden = ref(case.get("expected_source")), ref(case.get("must_not_retrieve"))
        rank = ids.index(expected) + 1 if expected in ids else None
        entry = {
            "id": case["id"],
            "query": case["query"],
            "hit": rank is not None if expected else True,
            "reciprocal_rank": (1 / rank) if rank else 0.0,
            "isolation_ok": forbidden not in ids if forbidden else True,
        }
        if expected:
            reply = ""
            for attempt in range(3):  # ride out provider overloads (503) instead of scoring them
                res = await http.post(
                    "/api/ai/chat?stream=false",
                    json={"message": case["query"]},
                    headers={"Authorization": f"Bearer {token}"},
                )
                reply = res.json().get("message", "") if res.status_code == 200 else ""
                if reply and "unavailable" not in reply.lower():
                    break
                reply = ""
                await asyncio.sleep(5 * (attempt + 1))
            entry["reply"] = reply
            entry["keywords_ok"] = any(k.lower() in reply.lower() for k in case.get("keywords", [])) or not case.get(
                "keywords"
            )
            context = "\n".join(h.content for h in hits)
            try:
                if not reply:
                    raise RuntimeError("no answer to judge")
                verdict = await llm.complete_json(
                    [
                        {"role": "system", "content": "Judge if every factual claim in the ANSWER is supported by the "
                                                      "CONTEXT. Answer JSON {faithful, reason}."},
                        {"role": "user", "content": f"CONTEXT:\n{context}\n\nANSWER:\n{reply}"},
                    ],
                    JUDGE_SCHEMA,
                )  # fmt: skip
                entry["faithful"] = bool(verdict.get("faithful"))
            except Exception:
                entry["faithful"] = None
        entry["pass"] = entry["hit"] and entry["isolation_ok"] and entry.get("keywords_ok", True)
        results.append(entry)
        print(f"  [rag {n}/{len(cases)}] {case['id']}: {'PASS' if entry['pass'] else 'FAIL'}", flush=True)
    return results


# ── report ───────────────────────────────────────────────────────────────────


def pct(n: float) -> str:
    return f"{n * 100:.1f}%"


def rate(rows: list[dict], key: str = "pass") -> float:
    vals = [r[key] for r in rows if r.get(key) is not None]
    return sum(1 for v in vals if v) / len(vals) if vals else 0.0


def _errored(r: dict) -> bool:
    """Provider failures (429/503) say nothing about the system; keep them out of every rate."""
    if r.get("checks", {}).get("no_error") is False:
        return True
    if "unavailable" in str(r.get("refused", "")).lower():
        return True
    return "reply" in r and r["reply"] == "" and r.get("faithful") is None


def summarize(results: dict) -> dict:
    out: dict = {"errored": {k: sum(map(_errored, v)) for k, v in results.items()}}
    results = {k: [r for r in v if not _errored(r)] for k, v in results.items()}
    agent = results.get("agent", [])
    if agent:
        lat = [r["latency_ms"] for r in agent]
        check_names = sorted({c for r in agent for c in r.get("checks", {})})
        out["agent"] = {
            "cases": len(agent),
            "pass_rate": rate(agent),
            "by_check": {
                c: rate([{"pass": r["checks"][c]} for r in agent if c in r.get("checks", {})]) for c in check_names
            },
            "by_category": {
                c: rate([r for r in agent if r["category"] == c]) for c in sorted({r["category"] for r in agent})
            },
            "by_lang": {
                lang: rate([r for r in agent if r["lang"] == lang]) for lang in sorted({r["lang"] for r in agent})
            },
            "p50_ms": percentile(lat, 0.5),
            "p95_ms": percentile(lat, 0.95),
            "avg_cost_usd": statistics.mean([r["cost_usd"] or 0 for r in agent]),
        }
    if results.get("sql"):
        sql = results["sql"]
        acc = [r for r in sql if r["id"].startswith("sql-") and not r["id"].startswith("sql-safe")]
        safe = [r for r in sql if r["id"].startswith("sql-safe")]
        out["sql"] = {"execution_accuracy": rate(acc), "cases": len(acc), "safety_pass_rate": rate(safe),
                      "safety_cases": len(safe), "first_try_rate": rate([{"pass": r.get("attempts") == 1} for r in acc if "attempts" in r])}  # fmt: skip
    if results.get("rag"):
        rag = results["rag"]
        scored = [r for r in rag if "reply" in r]
        out["rag"] = {
            "hit_at_5": rate(scored, "hit"),
            "mrr": statistics.mean([r["reciprocal_rank"] for r in scored]) if scored else 0,
            "faithfulness": rate(scored, "faithful"),
            "answer_keywords": rate(scored, "keywords_ok"),
            "isolation": rate(rag, "isolation_ok"),
        }
    if results.get("redteam"):
        rt = results["redteam"]
        out["redteam"] = {
            "attacks": len(rt),
            "attack_success_rate": 1 - rate(rt),
            "by_category": {
                c: 1 - rate([r for r in rt if r["category"] == c]) for c in sorted({r["category"] for r in rt})
            },
        }
    return out


def render_markdown(runs: list[dict]) -> str:
    lines = ["# Splity AI evals", "", f"_Generated {datetime.now(UTC):%Y-%m-%d %H:%M} UTC by `evals/run.py`._", ""]
    lines += ["## Model comparison", "", "| Model | Prompt | Agent pass | Tool selection | Args | Clarify | SQL exec acc | "
              "SQL safety | RAG hit@5 | MRR | Faithful | Attack success ↓ | p50 | p95 | $/req |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]  # fmt: skip
    for run in runs:
        s, a = run["summary"], run["summary"].get("agent", {})
        checks, sql, rag, rt = a.get("by_check", {}), s.get("sql", {}), s.get("rag", {}), s.get("redteam", {})
        cell = lambda d, k: pct(d[k]) if k in d else "–"  # noqa: E731
        lines.append(
            f"| {run['model']} | {run['prompt_version']} | {cell(a, 'pass_rate')} | {cell(checks, 'tool_selection')} | "
            f"{cell(checks, 'arguments')} | {cell(checks, 'clarification')} | {cell(sql, 'execution_accuracy')} | "
            f"{cell(sql, 'safety_pass_rate')} | {cell(rag, 'hit_at_5')} | {rag.get('mrr', 0):.2f} | "
            f"{cell(rag, 'faithfulness')} | {cell(rt, 'attack_success_rate')} | {a.get('p50_ms', 0) / 1000:.1f}s | "
            f"{a.get('p95_ms', 0) / 1000:.1f}s | ${a.get('avg_cost_usd', 0):.4f} |"
        )
    for run in runs:
        s = run["summary"]
        lines += ["", f"## {run['model']}", ""]
        if "agent" in s:
            a = s["agent"]
            lines += [
                f"**Agent** — {a['cases']} cases, pass rate {pct(a['pass_rate'])}",
                "",
                "| Category | Pass |",
                "|---|---|",
            ] + [f"| {k} | {pct(v)} |" for k, v in a["by_category"].items()]
            lines += ["", "| Language | Pass |", "|---|---|"] + [f"| {k} | {pct(v)} |" for k, v in a["by_lang"].items()]
        if "redteam" in s:
            rt = s["redteam"]
            lines += [
                "",
                f"**Red-team** — {rt['attacks']} attacks, success rate {pct(rt['attack_success_rate'])} (lower is better)",
                "",
                "| Attack type | Success ↓ |",
                "|---|---|",
            ] + [f"| {k} | {pct(v)} |" for k, v in rt["by_category"].items()]
        failures = [
            r
            for suite in ("agent", "redteam", "sql", "rag")
            for r in run["results"].get(suite, [])
            if not r.get("pass")
        ]
        if failures:
            lines += ["", "<details><summary>Failures</summary>", ""]
            for f in failures[:40]:
                lines.append(f"- `{f['id']}` {'; '.join(f.get('notes', []) or [str(f.get('checks', ''))])}")
            lines += ["", "</details>"]
    lines += ["", "Methodology: `evals/README.md`. Raw results: `evals/results/`."]
    return "\n".join(lines) + "\n"


# ── main ─────────────────────────────────────────────────────────────────────


async def run_model(model: str, suites: list[str], limit: int | None, url: str) -> dict:
    from app.ai.prompts import PROMPT_VERSION
    from app.api.routes.ai import ai_limiter
    from app.main import app

    print(f"\n=== {model} ===\nResetting eval database and building the world…", flush=True)
    await reset_database(url)
    engine = create_engine(url, poolclass=pool.NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    llm = LiteLLMClient(model)
    set_llm_override(llm)
    enable_background_indexing(None)
    async with factory() as session:
        world = await build_world(session, llm)
    token = create_access_token(world.me.id, world.me.email)

    async def override_session():
        async with factory() as s:
            yield s

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_session_factory] = lambda: factory
    ai_limiter.limit = 10**6
    results: dict = {}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://eval", timeout=300) as http:
            take = (lambda xs: xs[:limit]) if limit else (lambda xs: xs)
            if "agent" in suites:
                results["agent"] = await chat_cases(http, token, take(load("agent")), "agent")
            if "redteam" in suites:
                results["redteam"] = await chat_cases(http, token, take(load("redteam")), "redteam")
            if "sql" in suites:
                results["sql"] = await sql_suite(factory, llm, world, take(load("sql")))
            if "rag" in suites:
                results["rag"] = await rag_suite(factory, llm, http, token, world, take(load("rag")))
    finally:
        app.dependency_overrides.clear()
        set_llm_override(None)
        await engine.dispose()
    return {"model": model, "prompt_version": PROMPT_VERSION, "results": results, "summary": summarize(results)}


async def main() -> None:
    parser = argparse.ArgumentParser(description="Splity AI evals")
    parser.add_argument("--suite", nargs="+", choices=[*SUITES, "all"], default=["all"])
    parser.add_argument("--models", nargs="+", default=[get_settings().llm_model])
    parser.add_argument("--limit", type=int, default=None, help="max cases per suite (quick runs)")
    args = parser.parse_args()

    url = os.environ.get("EVAL_DATABASE_URL")
    if not url:
        raise SystemExit("Set EVAL_DATABASE_URL to a disposable database (its schema is dropped).")
    suites = list(SUITES) if "all" in args.suite else args.suite

    runs = [await run_model(m, suites, args.limit, url) for m in args.models]
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    (out_dir / f"{stamp}.json").write_text(json.dumps(runs, indent=2, default=str), encoding="utf-8")
    (API_ROOT / "EVALS.md").write_text(render_markdown(runs), encoding="utf-8")
    print(f"\nWrote EVALS.md and evals/results/{stamp}.json")
    for run in runs:
        print(run["model"], json.dumps(run["summary"], indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
