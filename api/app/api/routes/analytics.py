from datetime import UTC, datetime

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.services import analytics as analytics_service

router = APIRouter(tags=["analytics"])


def _optional_int(value: str | None, low: int, high: int) -> int | None:
    # The React client sends empty strings (?month=&year=) when no filter is chosen.
    if value is None or not value.strip().isdigit():
        return None
    number = int(value)
    return number if low <= number <= high else None


@router.get("/analytics")
async def analytics(
    user: CurrentUser,
    session: SessionDep,
    month: str | None = Query(default=None),
    year: str | None = Query(default=None),
):
    now = datetime.now(UTC)
    m = _optional_int(month, 1, 12) or now.month
    y = _optional_int(year, 2000, 2100) or now.year
    return await analytics_service.analytics(session, user.id, y, m)


@router.get("/dashboard")
async def dashboard(user: CurrentUser, session: SessionDep):
    return await analytics_service.dashboard(session, user.id)
