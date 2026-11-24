"""The MCP server, driven by a real MCP client over the in-memory transport."""

import json

import pytest
from mcp.client.client import Client

from app.mcp_server import build_server
from tests.helpers import balance_with, befriend, signup

pytestmark = pytest.mark.db


def payload(result) -> dict:
    return json.loads(result.content[0].text)


async def test_mcp_exposes_tools_but_no_way_to_confirm(client, db_sessionmaker):
    me = await signup(client, "Me")
    async with Client(build_server(db_sessionmaker, me.id)) as mcp:
        tools = {t.name: t for t in (await mcp.list_tools()).tools}
    assert "get_balances" in tools and tools["get_balances"].annotations.read_only_hint
    assert tools["create_expense"].annotations.read_only_hint is False
    assert not any("confirm" in name for name in tools)


async def test_mcp_reads_run_as_the_token_user(client, db_sessionmaker):
    me, rahul = await signup(client, "Me"), await signup(client, "Rahul")
    await befriend(client, me, rahul)
    await client.post(
        "/api/expenses/create", json={"amount": 300, "category": "Food", "friendIds": [rahul.id]}, headers=me.auth
    )
    async with Client(build_server(db_sessionmaker, me.id)) as mcp:
        result = payload(await mcp.call_tool("get_balances", {"friend": "Rahul"}))
    assert result["meaning"] == "Rahul owes the user ₹150.00"


async def test_mcp_writes_wait_for_approval_in_the_app(client, db_sessionmaker):
    me, rahul = await signup(client, "Me"), await signup(client, "Rahul")
    await befriend(client, me, rahul)
    async with Client(build_server(db_sessionmaker, me.id)) as mcp:
        result = payload(
            await mcp.call_tool(
                "create_expense",
                {"amount": 80, "description": "Cab", "category": "Transport", "participants": ["Rahul"]},
            )
        )
    assert result["status"] == "awaiting_approval_in_splity_app"
    assert await balance_with(client, me, rahul) == 0

    pending = (await client.get("/api/ai/actions", headers=me.auth)).json()
    assert [p["actionId"] for p in pending] == [result["action_id"]]
    await client.post(f"/api/ai/actions/{result['action_id']}/confirm", headers=me.auth)
    assert await balance_with(client, me, rahul) == 40


async def test_mcp_tool_errors_come_back_as_data(client, db_sessionmaker):
    me = await signup(client, "Me")
    async with Client(build_server(db_sessionmaker, me.id)) as mcp:
        result = payload(await mcp.call_tool("settle_up", {"friend": "Nobody"}))
    assert "not in the user's friends" in result["error"]
