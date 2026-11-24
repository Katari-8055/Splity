"""Authorization boundaries: every legacy IDOR found in the review has a test here."""

import pytest

from tests.helpers import befriend, signup

pytestmark = pytest.mark.db


async def _group(client):
    me, rahul, outsider = [await signup(client, n) for n in ("Me", "Rahul", "Outsider")]
    await befriend(client, me, rahul)
    res = await client.post("/api/groups", json={"name": "Goa Trip", "members": [rahul.id]}, headers=me.auth)
    assert res.status_code == 201, res.text
    return me, rahul, outsider, res.json()["group"]["id"]


async def test_group_creation_notifies_members_and_lists_for_both(client):
    me, rahul, _, gid = await _group(client)
    for user in (me, rahul):
        groups = (await client.get("/api/groups", headers=user.auth)).json()
        assert [(g["id"], g["member_count"]) for g in groups] == [(gid, 2)]
    notes = (await client.get("/api/notifications", headers=rahul.auth)).json()
    assert any(n["type"] == "group_added" for n in notes)


async def test_cannot_add_non_friends_to_a_group(client):
    me, outsider = [await signup(client, n) for n in ("Me", "Outsider")]
    res = await client.post("/api/groups", json={"name": "X", "members": [outsider.id]}, headers=me.auth)
    assert res.status_code == 400


@pytest.mark.parametrize("path", ["", "/expenses", "/messages"])
async def test_non_members_get_404_on_group_reads(client, path):
    _, _, outsider, gid = await _group(client)
    res = await client.get(f"/api/groups/{gid}{path}", headers=outsider.auth)
    assert res.status_code == 404


async def test_group_lookup_by_name_is_not_possible(client):
    """Legacy bug: group access checks also matched `name ILIKE id`."""
    me, *_ = await _group(client)
    res = await client.get("/api/groups/Goa Trip", headers=me.auth)
    assert res.status_code == 404


async def test_non_members_cannot_post_messages(client):
    me, _, outsider, gid = await _group(client)
    res = await client.post(f"/api/groups/{gid}/messages", json={"message": "hi"}, headers=outsider.auth)
    assert res.status_code == 404
    ok = await client.post(f"/api/groups/{gid}/messages", json={"message": " Flight at 6am "}, headers=me.auth)
    assert ok.status_code == 201
    assert ok.json()["message"] == "Flight at 6am"


async def test_group_expense_limited_to_members(client):
    me, rahul, outsider, gid = await _group(client)
    await befriend(client, me, outsider)  # a friend, but not in this group
    res = await client.post(
        "/api/expenses/create",
        json={"amount": 90, "category": "Travel", "groupId": gid, "friendIds": [rahul.id, outsider.id]},
        headers=me.auth,
    )
    assert res.status_code == 400

    ok = await client.post(
        "/api/expenses/create",
        json={"amount": 90, "category": "Travel", "groupId": gid, "friendIds": [rahul.id]},
        headers=me.auth,
    )
    assert ok.status_code == 201
    details = (await client.get(f"/api/groups/{gid}", headers=rahul.auth)).json()
    assert details["total_spent"] == 90
    assert {m["name"] for m in details["members"]} == {"Me", "Rahul"}


async def test_outsider_cannot_bill_a_group(client):
    _, _, outsider, gid = await _group(client)
    res = await client.post(
        "/api/expenses/create", json={"amount": 10, "category": "Food", "groupId": gid}, headers=outsider.auth
    )
    assert res.status_code == 404


async def test_cannot_acknowledge_someone_elses_notification(client):
    me, rahul, outsider, _ = await _group(client)
    note_id = (await client.get("/api/notifications", headers=rahul.auth)).json()[0]["id"]

    res = await client.post("/api/notifications/ack", json={"notificationId": note_id}, headers=outsider.auth)
    assert res.status_code == 404
    ok = await client.post("/api/notifications/ack", json={"notificationId": note_id}, headers=rahul.auth)
    assert ok.json()["is_read"] is True


async def test_reminders_only_to_friends(client):
    me, rahul, outsider, _ = await _group(client)
    stranger = await client.post("/api/friends/send-reminder", json={"friendId": outsider.id}, headers=me.auth)
    friend = await client.post("/api/friends/send-reminder", json={"friendId": rahul.id}, headers=me.auth)
    assert (stranger.status_code, friend.status_code) == (404, 200)


async def test_friend_autocomplete_matches_prefix_of_own_friends_only(client):
    me = await signup(client, "Me")
    names = ["Ram", "Rama", "Ramesh", "Shyam"]
    for n in names:
        await befriend(client, me, await signup(client, n))
    await signup(client, "Ravi")  # not a friend

    found = (await client.get("/api/friends/search?prefix=ra", headers=me.auth)).json()
    assert [f["name"] for f in found] == ["Ram", "Rama", "Ramesh"]

    wildcard = (await client.get("/api/friends/search?prefix=%25", headers=me.auth)).json()
    assert wildcard == []
