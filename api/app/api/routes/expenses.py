from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, SessionDep
from app.api.routes.ai import CategorizeIn as AISplitIn
from app.api.routes.ai import FactoryDep, enforce_ai_limit, traced_categorize
from app.api.schemas import CreateExpenseIn, PayExpenseIn, SettleIn
from app.services import expenses as expenses_service
from app.services import ledger

router = APIRouter(prefix="/expenses", tags=["expenses"])


async def _create(body: CreateExpenseIn, user: CurrentUser, session: SessionDep):
    data = expenses_service.ExpenseInput(
        amount=body.amount,
        category=body.category,
        subcategory=body.subcategory,
        description=body.description,
        friend_ids=body.friend_ids,
        split_type=body.split_type,
        shares=body.shares(),
        group_id=body.group_id,
    )
    return await expenses_service.create_expense(session, user, data)


# "/save" is kept as an alias because the legacy client calls both paths.
router.add_api_route("/create", _create, methods=["POST"], status_code=status.HTTP_201_CREATED)
router.add_api_route("/save", _create, methods=["POST"], status_code=status.HTTP_201_CREATED)


@router.get("/history")
async def history(
    user: CurrentUser,
    session: SessionDep,
    category: str | None = Query(default=None, max_length=50),
    start_date: datetime | None = Query(default=None, alias="startDate"),
    end_date: datetime | None = Query(default=None, alias="endDate"),
):
    return await expenses_service.list_expenses(
        session,
        user.id,
        category=category or None,
        start=_as_utc(start_date),
        end_exclusive=_end_exclusive(end_date),
    )


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _end_exclusive(value: datetime | None) -> datetime | None:
    """A bare date such as ``2025-01-31`` means "through the end of that day"."""
    value = _as_utc(value)
    if value is not None and value.time() == time(0, 0):
        return value + timedelta(days=1)
    return value


@router.post("/ai-split")
async def ai_split(body: AISplitIn, user: CurrentUser, factory: FactoryDep):
    """Category suggestion for the Add Expense form (legacy path)."""
    enforce_ai_limit(user)
    result = await traced_categorize(factory, user, body.description, body.amount)
    return {**result, "suggestedSplit": "equal"}


@router.get("/balances")
async def balances(user: CurrentUser, session: SessionDep):
    return await ledger.balances_for(session, user.id)


@router.post("/settle")
async def settle(body: SettleIn, user: CurrentUser, session: SessionDep):
    return await ledger.settle(session, user, body.friend_id, body.amount, note=body.description)


@router.post("/{expense_id}/pay")
async def pay(expense_id: str, body: PayExpenseIn, user: CurrentUser, session: SessionDep):
    payment = await expenses_service.pay_expense(session, user, expense_id, body.amount)
    return {"success": True, "payment": payment}
