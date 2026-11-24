"""Shared fixtures.

Unit tests need nothing. Integration tests (marked ``db``) need a disposable
PostgreSQL database in TEST_DATABASE_URL. The schema is built by running the
real Alembic migrations, so the migrations get tested too.
"""

import os

os.environ.setdefault("JWT_SECRET", "test-secret-key-that-is-at-least-32-characters-long")
os.environ.setdefault("ENVIRONMENT", "test")

from collections.abc import AsyncIterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import pool, text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402

from app.ai.llm import ScriptedLLM, set_llm_override  # noqa: E402
from app.ai.rag import enable_background_indexing  # noqa: E402
from app.api.routes.ai import ai_limiter  # noqa: E402
from app.core.rate_limit import login_limiter  # noqa: E402
from app.db.models import Base  # noqa: E402
from app.db.session import create_engine, get_session, get_session_factory  # noqa: E402
from app.main import app  # noqa: E402

API_ROOT = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def pytest_collection_modifyitems(config, items):
    if TEST_DATABASE_URL:
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL not set")
    for item in items:
        if "db" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def migrated_database() -> str:
    """Reset the test database and apply every migration once per test run."""
    assert TEST_DATABASE_URL
    import asyncio

    async def reset_schema():
        engine = create_engine(TEST_DATABASE_URL, poolclass=pool.NullPool)
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await engine.dispose()

    asyncio.run(reset_schema())
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    cfg.attributes["database_url"] = TEST_DATABASE_URL
    command.upgrade(cfg, "head")
    return TEST_DATABASE_URL


@pytest.fixture
async def db_sessionmaker(migrated_database) -> AsyncIterator[async_sessionmaker]:
    engine = create_engine(migrated_database, poolclass=pool.NullPool)
    tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(db_sessionmaker) -> AsyncIterator[AsyncClient]:
    async def override_session():
        async with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_session_factory] = lambda: db_sessionmaker
    login_limiter.reset()
    ai_limiter.reset()
    enable_background_indexing(None)  # tests index explicitly, never against the dev database
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=30) as http:
        yield http
    app.dependency_overrides.clear()
    set_llm_override(None)


@pytest.fixture
def use_llm():
    """Install a ScriptedLLM for this test: ``llm = use_llm([call(...), say(...)])``."""

    def install(steps, json_result=None) -> ScriptedLLM:
        llm = ScriptedLLM(steps, json_result=json_result)
        set_llm_override(llm)
        return llm

    yield install
    set_llm_override(None)
