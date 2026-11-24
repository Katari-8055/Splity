"""Balances and settlements.

From user U's point of view, the balance with another person O is the sum of:
    + O's share of expenses U paid               (O owes U)
    - U's share of expenses O paid               (U owes O)
    + settlements U paid to O                    (U paid back what they owed)
    - settlements O paid to U                    (O paid back what they owed)

A positive balance means O owes U; a negative one means U owes O. This is the
only place the formula is written, so the REST API and the AI agent always agree.
"""

from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequest, NotFound
from app.db.models import Settlement, User
from app.services.notifications import notify
from app.services.splitting import SplitError, from_cents, to_cents

_LEDGER_CTE = """
WITH ledger AS (
    SELECT s.user_id AS other_id, s.amount AS delta
    FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
    WHERE e.paid_by = :uid AND s.user_id <> :uid
  UNION ALL
    SELECT e.paid_by, -s.amount
    FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
    WHERE s.user_id = :uid AND e.paid_by <> :uid
  UNION ALL
    SELECT payee_id, amount FROM settlements WHERE payer_id = :uid
  UNION ALL
    SELECT payer_id, -amount FROM settlements WHERE payee_id = :uid
)
"""

_ALL_BALANCES_SQL = text(
    _LEDGER_CTE
    + """
, totals AS (SELECT other_id, SUM(delta) AS balance FROM ledger GROUP BY other_id)
SELECT u.id, u.name, u.email, COALESCE(t.balance, 0) AS balance
FROM users u
LEFT JOIN totals t ON t.other_id = u.id
WHERE u.id IN (SELECT other_id FROM totals)
   OR u.id IN (SELECT friend_id FROM friendships WHERE user_id = :uid)
ORDER BY u.name
"""
)

_PAIR_BALANCE_SQL = text(_LEDGER_CTE + "SELECT COALESCE(SUM(delta), 0) FROM ledger WHERE other_id = :oid")


async def balances_for(session: AsyncSession, user_id: str) -> dict:
    rows = (await session.execute(_ALL_BALANCES_SQL, {"uid": user_id})).all()
    balances = [
        {"friendId": r.id, "friendName": r.name, "friendEmail": r.email, "balance": Decimal(r.balance)} for r in rows
    ]
    owed = sum((b["balance"] for b in balances if b["balance"] > 0), Decimal(0))
    owe = sum((-b["balance"] for b in balances if b["balance"] < 0), Decimal(0))
    return {
        "balances": balances,
        "totalYouAreOwed": owed,
        "totalYouOwe": owe,
        "netBalance": owed - owe,
    }


async def pair_balance(session: AsyncSession, user_id: str, other_id: str) -> Decimal:
    value = await session.scalar(_PAIR_BALANCE_SQL, {"uid": user_id, "oid": other_id})
    return Decimal(value or 0)


async def settle(
    session: AsyncSession,
    user: User,
    friend_id: str,
    amount: Decimal | None = None,
    note: str | None = None,
) -> dict:
    """Record a repayment between the user and a friend, in whichever direction is owed.

    Locks the pair so two settlements recorded at the same moment can't both
    pass the over-payment check.
    """
    if friend_id == user.id:
        raise BadRequest("Cannot settle balance with yourself")
    friend = await session.get(User, friend_id)
    if friend is None:
        raise NotFound("Friend not found")

    a, b = sorted((user.id, friend_id))
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"settle:{a}:{b}"})

    balance = await pair_balance(session, user.id, friend_id)
    outstanding_cents = abs(int(balance * 100))
    if outstanding_cents == 0:
        await session.rollback()
        return {
            "success": True,
            "settledAmount": Decimal(0),
            "newBalance": Decimal(0),
            "friendId": friend_id,
            "message": "Already all settled up! No outstanding balance.",
        }

    if amount is None:
        cents = outstanding_cents
    else:
        try:
            cents = to_cents(amount)
        except SplitError as exc:
            raise BadRequest(str(exc)) from exc
    if cents > outstanding_cents:
        raise BadRequest(
            f"Settlement amount ({from_cents(cents)}) cannot exceed outstanding balance "
            f"({from_cents(outstanding_cents)})"
        )

    # balance < 0: the user owes the friend, so the user pays. Otherwise the friend pays.
    payer_id, payee_id = (user.id, friend_id) if balance < 0 else (friend_id, user.id)
    settlement = Settlement(
        payer_id=payer_id,
        payee_id=payee_id,
        amount=from_cents(cents),
        note=note,
        recorded_by=user.id,
    )
    session.add(settlement)
    await session.flush()

    new_balance = await pair_balance(session, user.id, friend_id)
    notify(
        session,
        friend_id,
        f"{user.name} recorded a settlement of {from_cents(cents)} with you.",
        "settlement",
        {"settlementId": settlement.id, "fromUserId": user.id},
    )
    await session.commit()
    return {
        "success": True,
        "settledAmount": from_cents(cents),
        "newBalance": new_balance,
        "friendId": friend_id,
        "settlementId": settlement.id,
        "payerId": payer_id,
        "recipientId": payee_id,
        "message": f"Settlement of {from_cents(cents)} recorded successfully.",
    }
