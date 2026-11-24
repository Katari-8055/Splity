import asyncio

import pytest

from tests.helpers import balance_with, befriend, signup

pytestmark = pytest.mark.db


async def _users(client, *names):
    return [await signup(client, n) for n in names]


async def test_equal_split_updates_both_sides_of_the_ledger(client):
    me, rahul, priya = await _users(client, "Me", "Rahul", "Priya")
    await befriend(client, me, rahul)
    await befriend(client, me, priya)

    res = await client.post(
        "/api/expenses/create",
        json={"amount": 100, "category": "Food", "description": "Dinner", "friendIds": [rahul.id, priya.id]},
        headers=me.auth,
    )
    assert res.status_code == 201, res.text
    shares = {s["userId"]: s["amount"] for s in res.json()["splits"]}
    assert shares == {me.id: 33.34, rahul.id: 33.33, priya.id: 33.33}

    assert await balance_with(client, me, rahul) == 33.33
    assert await balance_with(client, rahul, me) == -33.33

    totals = (await client.get("/api/expenses/balances", headers=me.auth)).json()
    assert totals["totalYouAreOwed"] == 66.66
    assert totals["netBalance"] == 66.66


async def test_cannot_split_with_strangers_or_create_ghost_users(client):
    """Legacy bug: unknown IDs were inserted as new users and billed."""
    me, stranger = await _users(client, "Me", "Stranger")
    for friend_id in (stranger.id, "friend-balram"):
        res = await client.post(
            "/api/expenses/create",
            json={"amount": 60, "category": "Food", "friendIds": [friend_id]},
            headers=me.auth,
        )
        assert res.status_code == 400
    assert await balance_with(client, stranger, me) == 0


async def test_float_amount_from_browser_is_exact(client):
    me, rahul = await _users(client, "Me", "Rahul")
    await befriend(client, me, rahul)
    res = await client.post(
        "/api/expenses/create",
        json={"amount": 60.1, "category": "Food", "friendIds": [rahul.id]},
        headers=me.auth,
    )
    assert res.status_code == 201
    assert res.json()["expense"]["amount"] == 60.1
    assert sorted(s["amount"] for s in res.json()["splits"]) == [30.05, 30.05]


async def test_sub_cent_amount_rejected(client):
    me = (await _users(client, "Me"))[0]
    res = await client.post("/api/expenses/create", json={"amount": "10.005", "category": "Food"}, headers=me.auth)
    assert res.status_code == 400


async def test_percentage_and_custom_splits(client):
    me, priya = await _users(client, "Me", "Priya")
    await befriend(client, me, priya)

    rent = await client.post(
        "/api/expenses/create",
        json={
            "amount": 20000,
            "category": "Bills",
            "description": "Rent",
            "splitType": "percentage",
            "customSplits": [{"userId": me.id, "percentage": 60}, {"userId": priya.id, "percentage": 40}],
        },
        headers=me.auth,
    )
    assert rent.status_code == 201, rent.text
    assert await balance_with(client, me, priya) == 8000

    bad = await client.post(
        "/api/expenses/create",
        json={
            "amount": 100,
            "category": "Food",
            "splitType": "custom",
            "customSplits": [{"userId": me.id, "amount": 50}, {"userId": priya.id, "amount": 40}],
        },
        headers=me.auth,
    )
    assert bad.status_code == 400
    assert "add up to" in bad.json()["error"]


async def test_personal_expense_counts_fully_as_my_spending(client):
    me = (await _users(client, "Me"))[0]
    res = await client.post("/api/expenses/create", json={"amount": 250, "category": "Shopping"}, headers=me.auth)
    assert res.status_code == 201
    assert res.json()["splits"] == [{"userId": me.id, "amount": 250}]
    dashboard = (await client.get("/api/dashboard", headers=me.auth)).json()
    assert dashboard["totalSpent"] == 250


async def test_analytics_use_my_share_not_the_full_bill(client):
    """Legacy bug: a ₹600 dinner split 3 ways was reported as ₹600 spent."""
    me, rahul, priya = await _users(client, "Me", "Rahul", "Priya")
    await befriend(client, me, rahul)
    await befriend(client, me, priya)
    await client.post(
        "/api/expenses/create",
        json={"amount": 600, "category": "Food", "friendIds": [rahul.id, priya.id]},
        headers=me.auth,
    )

    for user in (me, rahul):
        dashboard = (await client.get("/api/dashboard", headers=user.auth)).json()
        assert dashboard["totalSpent"] == 200
        analytics = (await client.get("/api/analytics?month=&year=", headers=user.auth)).json()
        assert analytics["categorySpend"] == [{"category": "Food", "total": 200, "total_amount": 200, "count": 1}]


async def test_history_includes_expenses_i_share_with_split_details(client):
    me, rahul = await _users(client, "Me", "Rahul")
    await befriend(client, me, rahul)
    await client.post(
        "/api/expenses/create",
        json={"amount": 80, "category": "Transport", "description": "Cab", "friendIds": [rahul.id]},
        headers=me.auth,
    )
    history = (await client.get("/api/expenses/history", headers=rahul.auth)).json()
    assert len(history) == 1
    row = history[0]
    assert row["paid_by_name"] == "Me"
    assert row["user_id"] == me.id
    assert {s["userName"] for s in row["splits"]} == {"Me", "Rahul"}

    filtered = (await client.get("/api/expenses/history?category=food", headers=rahul.auth)).json()
    assert filtered == []


# ── settlements ──────────────────────────────────────────────────────────────


async def _rahul_owes_me(client, amount=100):
    me, rahul = await _users(client, "Me", "Rahul")
    await befriend(client, me, rahul)
    await client.post(
        "/api/expenses/create",
        json={"amount": amount * 2, "category": "Food", "friendIds": [rahul.id]},
        headers=me.auth,
    )
    return me, rahul


async def test_partial_then_full_settlement(client):
    me, rahul = await _rahul_owes_me(client)

    partial = await client.post("/api/expenses/settle", json={"friendId": me.id, "amount": 40}, headers=rahul.auth)
    assert partial.status_code == 200, partial.text
    assert partial.json()["payerId"] == rahul.id
    assert await balance_with(client, me, rahul) == 60

    full = await client.post("/api/expenses/settle", json={"friendId": me.id}, headers=rahul.auth)
    assert full.json()["settledAmount"] == 60
    assert await balance_with(client, me, rahul) == 0


async def test_over_settlement_rejected(client):
    me, rahul = await _rahul_owes_me(client)
    res = await client.post("/api/expenses/settle", json={"friendId": me.id, "amount": 150}, headers=rahul.auth)
    assert res.status_code == 400
    assert await balance_with(client, me, rahul) == 100


async def test_settlements_are_not_counted_as_spending(client):
    """Legacy bug: settlements were stored as 'Settlement' expenses and showed up in analytics."""
    me, rahul = await _rahul_owes_me(client)
    await client.post("/api/expenses/settle", json={"friendId": me.id}, headers=rahul.auth)
    for user in (me, rahul):
        assert (await client.get("/api/dashboard", headers=user.auth)).json()["totalSpent"] == 100


async def test_concurrent_settlements_cannot_overpay(client):
    me, rahul = await _rahul_owes_me(client)
    results = await asyncio.gather(
        *(client.post("/api/expenses/settle", json={"friendId": me.id}, headers=rahul.auth) for _ in range(5))
    )
    settled = sum(r.json().get("settledAmount", 0) for r in results if r.status_code == 200)
    assert settled == 100
    assert await balance_with(client, me, rahul) == 0


async def test_pay_expense_endpoint(client):
    me, rahul = await _rahul_owes_me(client)
    expense_id = (await client.get("/api/expenses/history", headers=rahul.auth)).json()[0]["id"]

    res = await client.post(f"/api/expenses/{expense_id}/pay", json={}, headers=rahul.auth)
    assert res.status_code == 200
    assert res.json()["payment"]["settledAmount"] == 100

    own = await client.post(f"/api/expenses/{expense_id}/pay", json={}, headers=me.auth)
    assert own.status_code == 400


async def test_cannot_pay_an_expense_you_are_not_part_of(client):
    me, rahul = await _rahul_owes_me(client)
    outsider = (await _users(client, "Outsider"))[0]
    expense_id = (await client.get("/api/expenses/history", headers=me.auth)).json()[0]["id"]
    res = await client.post(f"/api/expenses/{expense_id}/pay", json={}, headers=outsider.auth)
    assert res.status_code == 404
