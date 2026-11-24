"""Spending analytics, always computed on the user's own share.

The legacy backend summed the full bill. Split ₹600 three ways and it reported
₹600 spent instead of ₹200. Here "my spending" is ``SUM(expense_splits.amount)``
for the user, and settlements are never spending because they live in their
own table.
"""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import groups as groups_service
from app.services.expenses import list_expenses

_MY_SHARES = """
FROM expense_splits s
JOIN expenses e ON e.id = s.expense_id
WHERE s.user_id = :uid
"""


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=UTC)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=UTC)
    return start, end


async def category_spend(session: AsyncSession, user_id: str, year: int, month: int) -> list[dict]:
    start, end = _month_bounds(year, month)
    rows = await session.execute(
        text(
            "SELECT e.category, SUM(s.amount) AS total, COUNT(*) AS count"
            + _MY_SHARES
            + " AND e.created_at >= :start AND e.created_at < :end"
            " GROUP BY e.category ORDER BY total DESC"
        ),
        {"uid": user_id, "start": start, "end": end},
    )
    return [{"category": r.category, "total": r.total, "total_amount": r.total, "count": r.count} for r in rows]


async def period_summary(session: AsyncSession, user_id: str, unit: str, limit: int = 12) -> list[dict]:
    if unit not in ("week", "month"):
        raise ValueError(unit)
    rows = await session.execute(
        text(
            f"SELECT date_trunc('{unit}', e.created_at) AS period, SUM(s.amount) AS total"
            + _MY_SHARES
            + " GROUP BY period ORDER BY period DESC LIMIT :limit"
        ),
        {"uid": user_id, "limit": limit},
    )
    return [{unit: r.period, "total": r.total} for r in rows]


async def top_categories(session: AsyncSession, user_id: str, limit: int = 5) -> list[dict]:
    now = datetime.now(UTC)
    start, end = _month_bounds(now.year, now.month)
    rows = await session.execute(
        text(
            "SELECT e.category, COUNT(*) AS n, SUM(s.amount) AS total, AVG(s.amount) AS average"
            + _MY_SHARES
            + " AND e.created_at >= :start AND e.created_at < :end"
            " GROUP BY e.category ORDER BY total DESC LIMIT :limit"
        ),
        {"uid": user_id, "start": start, "end": end, "limit": limit},
    )
    return [
        {
            "category": r.category,
            "total": r.total,
            "transactionCount": r.n,
            "average": Decimal(r.average).quantize(Decimal("0.01")),
        }
        for r in rows
    ]


async def analytics(session: AsyncSession, user_id: str, year: int, month: int) -> dict:
    return {
        "categorySpend": await category_spend(session, user_id, year, month),
        "monthlySummary": await period_summary(session, user_id, "month"),
        "weeklySummary": await period_summary(session, user_id, "week"),
        "topCategories": await top_categories(session, user_id),
    }


async def dashboard(session: AsyncSession, user_id: str) -> dict:
    total = await session.scalar(text("SELECT COALESCE(SUM(s.amount), 0)" + _MY_SHARES), {"uid": user_id})
    groups = await groups_service.list_groups(session, user_id)
    return {
        "totalSpent": total,
        "groupCount": len(groups),
        "recentExpenses": await list_expenses(session, user_id, limit=5),
    }
