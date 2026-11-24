from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_SSL_MODES = {"require", "verify-ca", "verify-full", "prefer", "allow", "disable"}


def normalize_database_url(raw: str) -> tuple[str, dict]:
    """Turn a libpq-style URL (Neon, Supabase, local) into an asyncpg URL.

    asyncpg rejects libpq-only query params such as ``sslmode`` and
    ``channel_binding``, so they move into ``connect_args``.
    """
    url = make_url(raw)
    if url.drivername in ("postgres", "postgresql", "postgresql+psycopg2", "postgresql+psycopg"):
        url = url.set(drivername="postgresql+asyncpg")

    query = dict(url.query)
    connect_args: dict = {}
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if isinstance(sslmode, str) and sslmode in _SSL_MODES and sslmode != "disable":
        connect_args["ssl"] = sslmode
    url = url.set(query=query)
    return url.render_as_string(hide_password=False), connect_args


def create_engine(database_url: str, **kwargs) -> AsyncEngine:
    url, connect_args = normalize_database_url(database_url)
    return create_async_engine(url, connect_args=connect_args, pool_pre_ping=True, **kwargs)


@lru_cache
def get_engine() -> AsyncEngine:
    return create_engine(get_settings().database_url)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """For streaming responses: the generator opens its own session that lives as long as the stream."""
    return get_sessionmaker()
