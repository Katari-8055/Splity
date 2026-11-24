from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequest, NotFound
from app.db.models import Friendship, User
from app.services import users as users_service
from app.services.notifications import notify
from app.services.users import _escape_like


async def list_friends(session: AsyncSession, user_id: str) -> list[User]:
    result = await session.scalars(
        select(User)
        .join(Friendship, Friendship.friend_id == User.id)
        .where(Friendship.user_id == user_id)
        .order_by(User.name)
    )
    return list(result)


async def search_friends(session: AsyncSession, user_id: str, prefix: str, limit: int = 10) -> list[User]:
    """Autocomplete over the user's own friends, e.g. "ra" matches Ram, Rama, Ramesh."""
    pattern = f"{_escape_like(prefix.strip())}%"
    result = await session.scalars(
        select(User)
        .join(Friendship, Friendship.friend_id == User.id)
        .where(Friendship.user_id == user_id, User.name.ilike(pattern))
        .order_by(func.length(User.name), User.name)
        .limit(limit)
    )
    return list(result)


async def friend_ids(session: AsyncSession, user_id: str) -> set[str]:
    result = await session.scalars(select(Friendship.friend_id).where(Friendship.user_id == user_id))
    return set(result)


async def add_friend(
    session: AsyncSession,
    user: User,
    *,
    friend_id: str | None = None,
    email: str | None = None,
    phone: str | None = None,
) -> User:
    if friend_id:
        friend = await session.get(User, friend_id)
    elif email:
        friend = await users_service.get_by_email(session, email)
    elif phone:
        friend = await users_service.get_by_phone(session, phone)
    else:
        raise BadRequest("Provide friendId, friendEmail or friendPhone")

    if friend is None:
        raise NotFound("Friend user not found")
    if friend.id == user.id:
        raise BadRequest("Cannot add yourself as a friend")

    stmt = insert(Friendship).values(
        [{"user_id": user.id, "friend_id": friend.id}, {"user_id": friend.id, "friend_id": user.id}]
    )
    result = await session.execute(stmt.on_conflict_do_nothing())
    if result.rowcount:
        notify(session, friend.id, f"{user.name} added you as a friend", "friend_added", {"fromUserId": user.id})
    await session.commit()
    return friend


async def send_reminder(session: AsyncSession, user: User, friend_id: str, message: str | None) -> None:
    if friend_id not in await friend_ids(session, user.id):
        raise NotFound("Friend not found")
    notify(
        session,
        friend_id,
        message or f"{user.name} sent you a reminder about shared expenses.",
        "reminder",
        {"fromUserId": user.id},
    )
    await session.commit()
