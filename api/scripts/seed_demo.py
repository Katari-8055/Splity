"""Seed a demo account with friends, a group and three months of expenses.

    uv run python -m scripts.seed_demo

Log in as demo@splity.app / Demo@12345. Safe to re-run: it does nothing if
the demo account already exists. Everything goes through the normal services,
so the data obeys the same rules as real usage.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import update

from app.db.models import Expense
from app.db.session import get_sessionmaker
from app.services import expenses, friends, groups, ledger, users

PASSWORD = "Demo@12345"
PEOPLE = ["Rahul Sharma", "Priya Patel", "Amit Verma", "Ram Kumar", "Ram Singh"]

# (days ago, paid by, amount, category, subcategory, description, split with, in group)
EXPENSES = [
    (2, "me", 600, "Food", "Dinner", "Dinner at Barbeque Nation", ["Rahul Sharma", "Priya Patel"], False),
    (3, "me", 240, "Food", "Coffee", "Starbucks coffee", ["Priya Patel"], False),
    (5, "Rahul Sharma", 450, "Transport", "Cab", "Uber to airport", ["me"], False),
    (6, "me", 180, "Food", "Coffee", "Third Wave coffee", [], False),
    (9, "me", 12000, "Travel", "Hotel", "Goa hotel 2 nights", None, True),
    (10, "Priya Patel", 3000, "Travel", "Flights", "Scooter rentals", None, True),
    (12, "me", 2200, "Groceries", "Groceries", "Monthly groceries", ["Amit Verma"], False),
    (35, "me", 20000, "Rent", "Rent", "Flat rent", ["Amit Verma"], False),
    (38, "Amit Verma", 1500, "Bills", "Electricity", "Electricity bill", ["me"], False),
    (40, "me", 900, "Entertainment", "Movies", "Movie night", ["Rahul Sharma", "Ram Kumar"], False),
    (44, "me", 320, "Food", "Coffee", "Blue Tokai coffee", [], False),
    (66, "me", 20000, "Rent", "Rent", "Flat rent", ["Amit Verma"], False),
    (70, "Ram Singh", 800, "Food", "Lunch", "Office lunch", ["me"], False),
    (72, "me", 1299, "Shopping", "Clothes", "T-shirts", [], False),
]


async def main() -> None:
    async with get_sessionmaker()() as session:
        if await users.get_by_email(session, "demo@splity.app"):
            print("Demo data already exists. Log in as demo@splity.app /", PASSWORD)
            return

        me = await users.create_user(
            session, name="Demo User", email="demo@splity.app", password=PASSWORD, phone=None, role="user"
        )
        people = {"me": me}
        for name in PEOPLE:
            email = name.lower().replace(" ", ".") + "@splity.app"
            people[name] = await users.create_user(
                session, name=name, email=email, password=PASSWORD, phone=None, role="user"
            )
            await friends.add_friend(session, me, friend_id=people[name].id)
        # Friends of each other too, so they can split with "me" and with one another.
        for a in PEOPLE:
            for b in PEOPLE:
                if a < b:
                    await friends.add_friend(session, people[a], friend_id=people[b].id)

        goa, _ = await groups.create_group(
            session, me, "Goa Trip", [people[n].id for n in ("Rahul Sharma", "Priya Patel", "Amit Verma")]
        )

        now = datetime.now(UTC)
        for days, payer, amount, category, sub, desc, with_, in_group in EXPENSES:
            created = await expenses.create_expense(
                session,
                people[payer],
                expenses.ExpenseInput(
                    amount=Decimal(amount),
                    category=category,
                    subcategory=sub,
                    description=desc,
                    friend_ids=[people[n].id for n in (with_ or [])],
                    group_id=goa.id if in_group else None,
                ),
            )
            await session.execute(
                update(Expense)
                .where(Expense.id == created["expense"]["id"])
                .values(created_at=now - timedelta(days=days, hours=3))
            )
            await session.commit()

        await ledger.settle(session, people["Ram Singh"], me.id, Decimal(200), note="Partial for lunch")
        await groups.post_message(session, goa.id, people["Priya Patel"], "Flight is at 6am, be on time!")
        await groups.post_message(session, goa.id, me, "Let's split the Airbnb equally, scooters by usage.")

    print("Seeded. Log in as demo@splity.app /", PASSWORD)


if __name__ == "__main__":
    asyncio.run(main())
