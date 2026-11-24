from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import rag
from app.core.errors import BadRequest, NotFound
from app.db.models import Expense, ExpenseSplit, User
from app.services import groups as groups_service
from app.services import ledger
from app.services.friends import friend_ids
from app.services.notifications import notify
from app.services.splitting import (
    Share,
    SplitError,
    custom_split,
    equal_split,
    from_cents,
    percentage_split,
    to_cents,
)

SplitType = Literal["equal", "percentage", "custom"]


@dataclass
class ExpenseInput:
    amount: Decimal
    category: str
    description: str | None = None
    subcategory: str | None = None
    friend_ids: list[str] = field(default_factory=list)
    split_type: SplitType = "equal"
    # For "custom": {user_id: amount}. For "percentage": {user_id: percent}.
    shares: dict[str, Decimal] = field(default_factory=dict)
    group_id: str | None = None


async def _allowed_participants(session: AsyncSession, payer: User, group_id: str | None) -> set[str]:
    """Who the payer may put on an expense: group members if it's a group expense,
    otherwise the payer's friends. The legacy backend accepted any ID and created
    placeholder users for unknown ones."""
    if group_id:
        await groups_service.require_membership(session, group_id, payer.id)
        return await groups_service.member_ids(session, group_id)
    return await friend_ids(session, payer.id) | {payer.id}


def compute_shares(data: ExpenseInput, payer_id: str, total_cents: int) -> tuple[str, list[Share]]:
    others = list(dict.fromkeys(f for f in data.friend_ids if f and f != payer_id))
    if data.split_type == "equal":
        if not others:
            return "personal", [Share(payer_id, total_cents)]
        return "equal", equal_split(total_cents, [payer_id, *others])
    if not data.shares:
        raise SplitError(f"{data.split_type} split needs per-person shares")
    if data.split_type == "percentage":
        return "percentage", percentage_split(total_cents, data.shares)
    return "custom", custom_split(total_cents, data.shares)


async def create_expense(session: AsyncSession, payer: User, data: ExpenseInput) -> dict:
    try:
        total_cents = to_cents(data.amount)
        split_type, shares = compute_shares(data, payer.id, total_cents)
    except SplitError as exc:
        raise BadRequest(str(exc)) from exc

    allowed = await _allowed_participants(session, payer, data.group_id)
    outsiders = {s.user_id for s in shares} - allowed
    if outsiders:
        scope = "members of this group" if data.group_id else "your friends"
        raise BadRequest(f"Expenses can only be split with {scope}")

    category = data.category.strip()
    if not category:
        raise BadRequest("Category is required")

    expense = Expense(
        paid_by=payer.id,
        group_id=data.group_id,
        amount=from_cents(total_cents),
        category=category,
        subcategory=(data.subcategory or "").strip() or None,
        description=(data.description or "").strip() or None,
        split_type=split_type,
    )
    session.add(expense)
    await session.flush()
    session.add_all(
        ExpenseSplit(expense_id=expense.id, user_id=s.user_id, amount=s.amount) for s in shares if s.cents > 0
    )

    label = expense.description or expense.category
    for s in shares:
        if s.user_id != payer.id and s.cents > 0:
            notify(
                session,
                s.user_id,
                f"{payer.name} added '{label}' ({expense.amount}). Your share: {s.amount}",
                "expense_added",
                {"expenseId": expense.id, "fromUserId": payer.id},
            )
    await session.commit()
    await session.refresh(expense)
    rag.schedule_index("expense", expense.id)

    return {
        "expense": expense_row(expense, payer.name),
        "splits": [{"userId": s.user_id, "amount": s.amount} for s in shares if s.cents > 0],
    }


def expense_row(expense: Expense, paid_by_name: str) -> dict:
    return {
        "id": expense.id,
        "user_id": expense.paid_by,  # legacy key the React client reads
        "paid_by": expense.paid_by,
        "paid_by_name": paid_by_name,
        "group_id": expense.group_id,
        "amount": expense.amount,
        "category": expense.category,
        "subcategory": expense.subcategory,
        "description": expense.description,
        "split_type": expense.split_type,
        "created_at": expense.created_at,
    }


_EXPENSE_SELECT = """
SELECT e.id, e.paid_by, e.group_id, e.amount, e.category, e.subcategory, e.description,
       e.split_type, e.created_at, payer.name AS paid_by_name,
       COALESCE((
         SELECT json_agg(json_build_object('userId', s.user_id, 'amount', s.amount, 'userName', u.name)
                         ORDER BY u.name)
         FROM expense_splits s JOIN users u ON u.id = s.user_id
         WHERE s.expense_id = e.id
       ), '[]'::json) AS splits
FROM expenses e
JOIN users payer ON payer.id = e.paid_by
"""


def _row_to_dict(r) -> dict:
    return {
        "id": r.id,
        "user_id": r.paid_by,
        "paid_by": r.paid_by,
        "paid_by_name": r.paid_by_name,
        "group_id": r.group_id,
        "amount": r.amount,
        "category": r.category,
        "subcategory": r.subcategory,
        "description": r.description,
        "split_type": r.split_type,
        "created_at": r.created_at,
        "splits": [{**s, "amount": Decimal(str(s["amount"]))} for s in r.splits],
    }


async def list_expenses(
    session: AsyncSession,
    user_id: str,
    *,
    category: str | None = None,
    start: datetime | None = None,
    end_exclusive: datetime | None = None,
    limit: int = 200,
) -> list[dict]:
    """Expenses the user paid for or has a share in, newest first."""
    where = [
        "(e.paid_by = :uid OR EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = e.id AND s.user_id = :uid))"
    ]
    params: dict = {"uid": user_id, "limit": limit}
    if category:
        where.append("e.category ILIKE :category")
        params["category"] = category
    if start:
        where.append("e.created_at >= :start")
        params["start"] = start
    if end_exclusive:
        where.append("e.created_at < :end")
        params["end"] = end_exclusive
    sql = _EXPENSE_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY e.created_at DESC LIMIT :limit"
    rows = (await session.execute(text(sql), params)).all()
    return [_row_to_dict(r) for r in rows]


async def list_group_expenses(session: AsyncSession, group_id: str) -> list[dict]:
    sql = _EXPENSE_SELECT + " WHERE e.group_id = :gid ORDER BY e.created_at DESC"
    rows = (await session.execute(text(sql), {"gid": group_id})).all()
    return [_row_to_dict(r) for r in rows]


async def pay_expense(session: AsyncSession, user: User, expense_id: str, amount: Decimal | None) -> dict:
    """Settle up with whoever paid this expense. This settles the overall balance
    with that person (the same as the legacy ``/expenses/:id/pay`` endpoint)."""
    expense = await session.get(Expense, expense_id)
    has_share = expense is not None and await session.get(ExpenseSplit, (expense_id, user.id))
    if expense is None or not has_share:
        raise NotFound("Expense not found")
    if expense.paid_by == user.id:
        raise BadRequest("Cannot settle an expense you paid for yourself")
    if await ledger.pair_balance(session, user.id, expense.paid_by) >= 0:
        raise BadRequest("You don't owe this person anything right now")
    return await ledger.settle(
        session,
        user,
        expense.paid_by,
        amount,
        note=f"Settlement for: {expense.description or expense.category}",
    )
