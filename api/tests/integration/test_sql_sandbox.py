"""Text-to-SQL sandbox, tested without an LLM.

Three independent layers are checked separately:
1. ``validate_sql`` (sqlglot) rejects every attack query.
2. The database layer alone (read-only transaction + ``splity_analyst`` role +
   timeout), with the validator bypassed, still refuses writes, base tables and
   slow queries.
3. Per-user views: the same query returns only the caller's rows.
Plus: every reference query (few-shot examples and eval gold SQL) passes the
validator and runs, so the guard doesn't block legitimate analytics.
"""

from decimal import Decimal
from pathlib import Path

import pytest
import yaml
from sqlalchemy.exc import DBAPIError

from app.ai.sql_agent import DEFAULT_EXAMPLES, UnsafeSQL, run_readonly, validate_sql
from app.db.models import User
from app.services.expenses import ExpenseInput, create_expense
from tests.helpers import signup

pytestmark = pytest.mark.db

ATTACKS = [
    # writes and DDL
    "DELETE FROM analytics.my_expenses",
    "UPDATE analytics.my_expenses SET my_share = 0",
    "INSERT INTO analytics.my_expenses (my_share) VALUES (1)",
    "DROP TABLE users",
    "CREATE TABLE stolen AS SELECT * FROM users",
    "ALTER TABLE users ADD COLUMN x int",
    "TRUNCATE expenses",
    "SELECT * INTO stolen FROM analytics.my_expenses",
    "WITH gone AS (DELETE FROM expenses RETURNING *) SELECT * FROM gone",
    # stacked statements
    "SELECT 1; DROP TABLE users",
    "SELECT my_share FROM analytics.my_expenses; DELETE FROM expenses",
    # base tables and other schemas
    "SELECT * FROM users",
    "SELECT email, password_hash FROM public.users",
    "SELECT * FROM expenses",
    "SELECT * FROM analytics.my_expenses JOIN users ON true",
    "SELECT * FROM analytics.my_expenses UNION SELECT * FROM expense_splits",
    "SELECT * FROM pg_catalog.pg_user",
    "SELECT * FROM information_schema.tables",
    "SELECT * FROM (SELECT * FROM users) AS u",
    # dangerous functions
    "SELECT pg_sleep(10)",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT set_config('app.user_id', 'someone-else', true)",
    "SELECT * FROM analytics.my_expenses WHERE set_config('app.user_id', 'x', true) IS NOT NULL",
    "SELECT current_setting('app.user_id')",
    "SELECT lo_import('/etc/passwd')",
    "SELECT dblink('host=evil', 'select 1')",
    "SELECT version()",
    # session / permission changes
    "SET ROLE splity",
    "RESET ROLE",
    "COPY users TO '/tmp/u.csv'",
    # not SQL / empty
    "DROP",
    "",
]

# Run straight through the database layer with the validator bypassed.
DB_LAYER_ATTACKS = [
    "DELETE FROM analytics.my_expenses",
    "UPDATE analytics.my_expenses SET my_share = 0",
    "DROP TABLE users",
    "CREATE TABLE stolen (a int)",
    "SELECT * FROM users",
    "SELECT email, password_hash FROM public.users",
    "SELECT * FROM expenses",
    "SELECT * FROM expense_splits",
    "SELECT * FROM settlements",
    "SELECT pg_sleep(10)",
]


def _reference_queries() -> list[str]:
    dataset = Path(__file__).resolve().parents[2] / "evals" / "datasets" / "sql.yaml"
    gold = [c["reference"] for c in yaml.safe_load(dataset.read_text(encoding="utf-8")) if "reference" in c]
    return [sql for _, sql in DEFAULT_EXAMPLES] + gold


@pytest.mark.parametrize("sql", ATTACKS)
def test_validator_rejects_attack(sql):
    with pytest.raises(UnsafeSQL):
        validate_sql(sql, 200)


@pytest.mark.parametrize("sql", _reference_queries())
def test_validator_accepts_reference_query(sql):
    checked = validate_sql(sql, 200)
    assert "LIMIT" in checked.upper()


def test_validator_caps_row_limit():
    assert "LIMIT 200" in validate_sql("SELECT * FROM my_expenses LIMIT 100000", 200)


async def _two_users_with_private_expenses(client, db_sessionmaker) -> tuple[str, str]:
    alice = await signup(client, "Alice Iso")
    bob = await signup(client, "Bob Iso")
    async with db_sessionmaker() as session:
        for user_id, label, amount in ((alice.id, "alice-secret", "111.00"), (bob.id, "bob-secret", "999.00")):
            user = await session.get(User, user_id)
            await create_expense(
                session, user, ExpenseInput(amount=Decimal(amount), category="Food", description=label)
            )
    return alice.id, bob.id


@pytest.mark.parametrize("sql", DB_LAYER_ATTACKS)
async def test_database_layer_blocks_attack_without_validator(client, db_sessionmaker, sql):
    alice_id, _ = await _two_users_with_private_expenses(client, db_sessionmaker)
    async with db_sessionmaker() as session:
        with pytest.raises(DBAPIError):
            await run_readonly(session, alice_id, sql)


async def test_views_only_return_the_callers_rows(client, db_sessionmaker):
    alice_id, bob_id = await _two_users_with_private_expenses(client, db_sessionmaker)
    async with db_sessionmaker() as session:
        sql = validate_sql("SELECT description, my_share FROM my_expenses", 200)
        _, alice_rows = await run_readonly(session, alice_id, sql)
        _, bob_rows = await run_readonly(session, bob_id, sql)
    assert [r[0] for r in alice_rows] == ["alice-secret"]
    assert [r[0] for r in bob_rows] == ["bob-secret"]


async def test_reference_queries_execute(client, db_sessionmaker):
    alice_id, _ = await _two_users_with_private_expenses(client, db_sessionmaker)
    async with db_sessionmaker() as session:
        for sql in _reference_queries():
            await run_readonly(session, alice_id, validate_sql(sql, 200))
