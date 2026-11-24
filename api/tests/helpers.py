from dataclasses import dataclass

from httpx import AsyncClient

PASSWORD = "Str0ngPassw0rd"


@dataclass
class TestUser:
    id: str
    name: str
    email: str
    token: str

    @property
    def auth(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}


async def signup(client: AsyncClient, name: str) -> TestUser:
    email = f"{name.lower().replace(' ', '.')}@example.com"
    res = await client.post("/api/auth/signup", json={"name": name, "email": email, "password": PASSWORD})
    assert res.status_code == 201, res.text
    body = res.json()
    return TestUser(id=body["user"]["id"], name=name, email=email, token=body["token"])


async def befriend(client: AsyncClient, a: TestUser, b: TestUser) -> None:
    res = await client.post("/api/friends/add", json={"friendId": b.id}, headers=a.auth)
    assert res.status_code == 200, res.text


async def balance_with(client: AsyncClient, user: TestUser, other: TestUser) -> float:
    res = await client.get("/api/expenses/balances", headers=user.auth)
    assert res.status_code == 200, res.text
    for row in res.json()["balances"]:
        if row["friendId"] == other.id:
            return row["balance"]
    return 0.0
