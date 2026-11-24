from functools import lru_cache

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Unauthorized
from app.core.security import hash_password, verify_password
from app.db.models import User


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def get_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(User.email == normalize_email(email)))


async def get_by_phone(session: AsyncSession, phone: str) -> User | None:
    return await session.scalar(select(User).where(User.phone == phone.strip()))


async def create_user(
    session: AsyncSession, *, name: str, email: str, password: str, phone: str | None, role: str
) -> User:
    user = User(
        name=name.strip(),
        email=normalize_email(email),
        phone=phone.strip() if phone else None,
        password_hash=hash_password(password),
        role=role,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise Conflict("User with this email already exists") from exc
    return user


@lru_cache
def _dummy_hash() -> str:
    return hash_password("timing-equaliser-not-a-real-password")


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    user = await get_by_email(session, email)
    if user is None or not user.password_hash:
        # Spend the same bcrypt time as a real check so response time doesn't reveal
        # whether the account exists.
        verify_password(password, _dummy_hash())
        raise Unauthorized("Invalid credentials")
    if not verify_password(password, user.password_hash):
        raise Unauthorized("Invalid credentials")
    return user


async def search_users(session: AsyncSession, query: str, exclude_id: str, limit: int = 10) -> list[User]:
    """Search people to add as friends.

    Matches name prefix, or the exact email or phone. Unlike the legacy
    substring match, this can't be used to list every account.
    """
    q = query.strip()
    result = await session.scalars(
        select(User)
        .where(
            User.id != exclude_id,
            or_(User.name.ilike(f"{_escape_like(q)}%"), User.email == q.lower(), User.phone == q),
        )
        .order_by(User.name)
        .limit(limit)
    )
    return list(result)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
