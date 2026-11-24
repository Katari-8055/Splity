import pytest

from app.ai.llm import Completion, ToolCall, Usage, say
from app.ai.prompts import PROMPT_VERSION
from app.core.config import get_settings
from tests.helpers import befriend, signup

pytestmark = pytest.mark.db


def priced(completion: Completion, prompt: int, out: int, cost: float, ms: int) -> Completion:
    completion.usage = Usage(prompt, out, cost)
    completion.model = "test/model"
    completion.latency_ms = ms
    return completion


@pytest.fixture
def admin(monkeypatch):
    emails = ["boss@example.com"]
    monkeypatch.setattr(get_settings(), "admin_emails", emails)
    return emails


async def _chat(client, user, message):
    res = await client.post("/api/ai/chat?stream=false", json={"message": message}, headers=user.auth)
    assert res.status_code == 200, res.text
    return res.json()


async def test_every_chat_turn_writes_an_ordered_trace(client, use_llm, admin):
    boss = await signup(client, "Boss")
    friend = await signup(client, "Rahul")
    await befriend(client, boss, friend)
    use_llm(
        [
            priced(Completion(tool_calls=[ToolCall("c1", "get_balances", {})]), 900, 20, 0.0004, 700),
            priced(say("All settled."), 1100, 15, 0.0005, 400),
        ]
    )
    out = await _chat(client, boss, "who owes me?")

    trace = (await client.get(f"/api/ai/ops/traces/{out['traceId']}", headers=boss.auth)).json()
    assert trace["status"] == "ok" and trace["kind"] == "chat"
    assert trace["llm_calls"] == 2
    assert trace["prompt_tokens"] == 2000 and trace["completion_tokens"] == 35
    assert float(trace["cost_usd"]) == pytest.approx(0.0009)
    assert [s["kind"] for s in trace["spans"]] == ["llm", "tool", "llm"]
    assert trace["prompt_version"] == PROMPT_VERSION
    assert trace["input_preview"] == "who owes me?"


async def test_errors_proposals_and_confirmations_are_traced(client, use_llm, admin):
    boss = await signup(client, "Boss")
    friend = await signup(client, "Rahul")
    await befriend(client, boss, friend)

    use_llm([RuntimeError("provider 503")])
    await _chat(client, boss, "hello")

    use_llm(
        [
            Completion(
                tool_calls=[
                    ToolCall("c", "create_expense", {"amount": 50, "description": "Tea", "category": "Food",
                                                     "participants": ["Rahul"]})
                ]
            ),
            say("Confirm?"),
        ]
    )  # fmt: skip
    proposal = await _chat(client, boss, "tea 50 with rahul")
    await client.post(f"/api/ai/actions/{proposal['confirmation']['actionId']}/confirm", headers=boss.auth)

    summary = (await client.get("/api/ai/ops/summary", headers=boss.auth)).json()
    statuses = {(r["kind"], r["status"]): r["n"] for r in summary["byStatus"]}
    assert statuses == {("chat", "error"): 1, ("chat", "proposed"): 1, ("action", "executed"): 1}
    assert summary["totals"]["requests"] == 3
    assert summary["totals"]["error_rate"] == pytest.approx(1 / 3, abs=1e-3)
    assert summary["actions"]["confirmed"] == 1
    tools = {t["name"]: t for t in summary["tools"]}
    assert tools["create_expense"]["calls"] == 1 and tools["create_expense:execute"]["failures"] == 0

    errors = (await client.get("/api/ai/ops/traces?status=errors", headers=boss.auth)).json()
    assert len(errors) == 1 and "503" in errors[0]["error"]


async def test_categorize_fallbacks_count_as_errors(client, use_llm, admin):
    boss = await signup(client, "Boss")
    use_llm([], json_result={"category": "Nope", "subcategory": "x", "confidence": 1})
    await client.post("/api/ai/categorize", json={"description": "latte"}, headers=boss.auth)
    summary = (await client.get("/api/ai/ops/summary", headers=boss.auth)).json()
    assert summary["byStatus"] == [{"kind": "categorize", "status": "error", "n": 1}]


async def test_ops_is_admin_only(client, admin):
    regular = await signup(client, "Regular")
    for path in ("/api/ai/ops/summary", "/api/ai/ops/traces", "/api/ai/ops/traces/x"):
        assert (await client.get(path, headers=regular.auth)).status_code == 403
    assert (await client.get("/api/ai/ops/me", headers=regular.auth)).json() == {"isAdmin": False}
    boss = await signup(client, "Boss")
    assert (await client.get("/api/ai/ops/me", headers=boss.auth)).json() == {"isAdmin": True}
