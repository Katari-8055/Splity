import pytest

from tests.helpers import PASSWORD, signup

pytestmark = pytest.mark.db


async def test_signup_then_signin_returns_token_and_never_leaks_hash(client):
    user = await signup(client, "Asha")
    res = await client.post("/api/auth/signin", json={"email": "ASHA@example.com", "password": PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["id"] == user.id
    assert "password" not in str(body["user"]).lower()

    profile = await client.get("/api/users/profile", headers=user.auth)
    assert profile.json()["email"] == "asha@example.com"


async def test_wrong_password_and_unknown_email_look_identical(client):
    await signup(client, "Asha")
    wrong = await client.post("/api/auth/signin", json={"email": "asha@example.com", "password": "Nope12345"})
    unknown = await client.post("/api/auth/signin", json={"email": "ghost@example.com", "password": "Nope12345"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


async def test_duplicate_email_is_409(client):
    await signup(client, "Asha")
    res = await client.post(
        "/api/auth/signup", json={"name": "Other", "email": "Asha@Example.com", "password": PASSWORD}
    )
    assert res.status_code == 409


@pytest.mark.parametrize("password", ["short1A", "alllowercase1", "NoDigitsHere", "x" * 80 + "A1"])
async def test_weak_passwords_rejected(client, password):
    res = await client.post("/api/auth/signup", json={"name": "A", "email": "a@example.com", "password": password})
    assert res.status_code == 400
    assert "error" in res.json()


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer not-a-jwt"}, {"Authorization": "Basic abc"}],
)
async def test_protected_routes_require_valid_token(client, headers):
    res = await client.get("/api/expenses/balances", headers=headers)
    assert res.status_code == 401


async def test_tampered_token_rejected(client):
    user = await signup(client, "Asha")
    header, payload, signature = user.token.split(".")
    forged = f"{header}.{payload}.{signature[:-2]}xx"
    res = await client.get("/api/users/profile", headers={"Authorization": f"Bearer {forged}"})
    assert res.status_code == 401


async def test_signin_is_rate_limited(client):
    await signup(client, "Asha")
    statuses = []
    for _ in range(11):
        res = await client.post("/api/auth/signin", json={"email": "asha@example.com", "password": "Wrong12345"})
        statuses.append(res.status_code)
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


async def test_user_search_needs_two_chars_and_hides_phone(client):
    asha = await signup(client, "Asha")
    await signup(client, "Rahul")
    assert (await client.get("/api/users/search?q=r", headers=asha.auth)).json() == []
    found = (await client.get("/api/users/search?q=ra", headers=asha.auth)).json()
    assert [u["name"] for u in found] == ["Rahul"]
    assert "phone" not in found[0]
