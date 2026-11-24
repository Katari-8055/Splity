from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.db.models import Notification


def notify(
    session: AsyncSession, user_id: str, message: str, type_: str = "general", data: dict | None = None
) -> Notification:
    """Queue a notification in the caller's transaction, so it commits or rolls back with it."""
    notification = Notification(user_id=user_id, message=message, type=type_, data=data or {})
    session.add(notification)
    return notification


async def list_notifications(session: AsyncSession, user_id: str, limit: int = 100) -> list[Notification]:
    result = await session.scalars(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    return list(result)


async def acknowledge(session: AsyncSession, user_id: str, notification_id: str) -> Notification:
    """Only the owner can mark a notification read; anything else looks like not found."""
    result = await session.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user_id)
        .values(is_read=True)
        .returning(Notification)
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        raise NotFound("Notification not found")
    await session.commit()
    return notification
