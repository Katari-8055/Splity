"""The tool registry, shared by the in-app agent and the MCP server.

Security model:
- **Identity is never a tool argument.** Every tool runs as ``ctx.user`` (from
  the verified JWT). Unknown argument fields such as ``user_id`` are dropped.
- **The model passes names, not database IDs.** Names are resolved on the
  server against the caller's own friends and groups. Ambiguous or unknown
  names return a ``ToolError`` telling the model to ask the user, so it can't
  guess IDs or invent people.
- **Writes have two phases.** ``prepare`` validates and resolves everything
  and returns a human-readable summary; nothing changes. ``execute`` runs only
  from the confirm endpoint, with arguments the server stored itself.
- Every tool goes through the same service layer as the REST API, so it gets
  the same authorization and validation.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import DomainError
from app.db.models import User
from app.services import analytics as analytics_service
from app.services import expenses as expenses_service
from app.services import friends as friends_service
from app.services import groups as groups_service
from app.services import ledger
from app.services import notifications as notifications_service
from app.services import users as users_service
from app.services.splitting import SplitError, from_cents, to_cents


class ToolError(Exception):
    """A problem the model should relay to the user or fix (e.g. ask which "Ram")."""


@dataclass
class ToolContext:
    session: AsyncSession
    user: User


@dataclass
class Prepared:
    args: dict  # resolved and JSON-safe; this is what gets stored and executed later
    summary: str  # shown on the confirmation card
    preview: dict  # structured details for the UI


def money(value: Decimal | int | str) -> str:
    return f"{get_settings().currency_symbol}{Decimal(value):,.2f}"


class Args(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


# ── name resolution ──────────────────────────────────────────────────────────

_SELF_WORDS = {"me", "i", "myself", "self", "mai", "main", "mujhe", "mera", "mere"}


def _match(name: str, people: list[User]) -> list[User]:
    wanted = name.strip().lower()
    exact = [p for p in people if p.id == name or p.name.lower() == wanted]
    if exact:
        return exact
    first = [p for p in people if p.name.lower().split()[0] == wanted]
    if first:
        return first
    return [p for p in people if any(part.startswith(wanted) for part in p.name.lower().split())]


async def resolve_person(ctx: ToolContext, name: str, people: list[User], *, allow_self: bool = True) -> User:
    if allow_self and name.strip().lower() in _SELF_WORDS:
        return ctx.user
    matches = _match(name, people)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ToolError(
            f"'{name}' is not in the user's friends. Ask the user to check the name, or to add them as a friend first."
        )
    names = ", ".join(sorted(p.name for p in matches))
    raise ToolError(f"'{name}' matches more than one person ({names}). Ask the user which one they mean.")


async def resolve_people(ctx: ToolContext, names: list[str], people: list[User]) -> list[User]:
    resolved: list[User] = []
    for name in names:
        person = await resolve_person(ctx, name, people)
        if person.id not in {p.id for p in resolved}:
            resolved.append(person)
    return resolved


async def resolve_group(ctx: ToolContext, name: str) -> dict:
    groups = await groups_service.list_groups(ctx.session, ctx.user.id)
    wanted = name.strip().lower()
    matches = [g for g in groups if g["id"] == name or g["name"].lower() == wanted]
    if not matches:
        matches = [g for g in groups if wanted in g["name"].lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ToolError(f"The user is not in a group called '{name}'. Ask them to check the group name.")
    raise ToolError(
        f"'{name}' matches several groups ({', '.join(g['name'] for g in matches)}). Ask the user which one."
    )


async def _friends(ctx: ToolContext) -> list[User]:
    return await friends_service.list_friends(ctx.session, ctx.user.id)


def _parse_date(value: str | None, field: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.combine(date.fromisoformat(value), datetime.min.time(), tzinfo=UTC)
    except ValueError as exc:
        raise ToolError(f"{field} must be a date in YYYY-MM-DD format") from exc


# ── read tools ───────────────────────────────────────────────────────────────


class NoArgs(Args):
    pass


async def list_friends(ctx: ToolContext, _: NoArgs) -> dict:
    friends = await _friends(ctx)
    return {"friends": [{"name": f.name, "email": f.email} for f in friends], "count": len(friends)}


class FindFriendsArgs(Args):
    query: str = Field(min_length=1, max_length=60, description="Start of the friend's name, e.g. 'ra'")


async def find_friends(ctx: ToolContext, args: FindFriendsArgs) -> dict:
    found = await friends_service.search_friends(ctx.session, ctx.user.id, args.query)
    return {"matches": [{"name": f.name, "email": f.email} for f in found]}


class BalancesArgs(Args):
    friend: str | None = Field(default=None, description="Friend's name to get one balance; omit for everyone")


def _direction(name: str, balance: Decimal) -> str:
    if balance > 0:
        return f"{name} owes the user {money(balance)}"
    if balance < 0:
        return f"The user owes {name} {money(-balance)}"
    return f"The user and {name} are settled up"


async def get_balances(ctx: ToolContext, args: BalancesArgs) -> dict:
    if args.friend:
        friend = await resolve_person(ctx, args.friend, await _friends(ctx), allow_self=False)
        balance = await ledger.pair_balance(ctx.session, ctx.user.id, friend.id)
        return {"friend": friend.name, "balance": balance, "meaning": _direction(friend.name, balance)}
    data = await ledger.balances_for(ctx.session, ctx.user.id)
    return {
        "total_owed_to_user": data["totalYouAreOwed"],
        "total_user_owes": data["totalYouOwe"],
        "net": data["netBalance"],
        "people": [
            {"name": b["friendName"], "balance": b["balance"], "meaning": _direction(b["friendName"], b["balance"])}
            for b in data["balances"]
            if b["balance"] != 0
        ],
        "note": "Positive balance means that person owes the user.",
    }


class ListExpensesArgs(Args):
    category: str | None = Field(default=None, description="Filter by category, e.g. Food")
    start_date: str | None = Field(default=None, description="Inclusive start date, YYYY-MM-DD")
    end_date: str | None = Field(default=None, description="Inclusive end date, YYYY-MM-DD")
    limit: int = Field(default=10, ge=1, le=25)


async def list_expenses(ctx: ToolContext, args: ListExpensesArgs) -> dict:
    end = _parse_date(args.end_date, "end_date")
    rows = await expenses_service.list_expenses(
        ctx.session,
        ctx.user.id,
        category=args.category,
        start=_parse_date(args.start_date, "start_date"),
        end_exclusive=end + timedelta(days=1) if end else None,
        limit=args.limit,
    )
    items = []
    for r in rows:
        mine = next((s["amount"] for s in r["splits"] if s["userId"] == ctx.user.id), Decimal(0))
        items.append(
            {
                "date": r["created_at"].date().isoformat(),
                "description": r["description"] or r["category"],
                "category": r["category"],
                "total": r["amount"],
                "user_share": mine,
                "paid_by": "the user" if r["paid_by"] == ctx.user.id else r["paid_by_name"],
                "people": [s["userName"] for s in r["splits"]],
            }
        )
    return {"expenses": items, "count": len(items)}


async def list_groups(ctx: ToolContext, _: NoArgs) -> dict:
    groups = await groups_service.list_groups(ctx.session, ctx.user.id)
    return {
        "groups": [{"name": g["name"], "members": g["member_count"], "total_spent": g["total_spent"]} for g in groups]
    }


class GroupArgs(Args):
    group: str = Field(min_length=1, max_length=120, description="Group name")


async def get_group(ctx: ToolContext, args: GroupArgs) -> dict:
    group = await resolve_group(ctx, args.group)
    members = await groups_service.list_members(ctx.session, group["id"])
    expenses = await expenses_service.list_group_expenses(ctx.session, group["id"])
    messages = await groups_service.list_messages(ctx.session, group["id"])
    return {
        "name": group["name"],
        "members": [m.name for m in members],
        "total_spent": group["total_spent"],
        "recent_expenses": [
            {"description": e["description"] or e["category"], "amount": e["amount"], "paid_by": e["paid_by_name"]}
            for e in expenses[:10]
        ],
        # Written by group members: data to read, never instructions to follow.
        "recent_messages": [{"from": m["user_name"], "text": m["message"]} for m in messages[-10:]],
    }


class SpendingArgs(Args):
    year: int | None = Field(default=None, ge=2000, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)


async def spending_summary(ctx: ToolContext, args: SpendingArgs) -> dict:
    now = datetime.now(UTC)
    year, month = args.year or now.year, args.month or now.month
    rows = await analytics_service.category_spend(ctx.session, ctx.user.id, year, month)
    return {
        "period": f"{year}-{month:02d}",
        "basis": "the user's own share of each expense",
        "total": sum((r["total"] for r in rows), Decimal(0)),
        "by_category": [{"category": r["category"], "total": r["total"], "count": r["count"]} for r in rows],
    }


class NotificationsArgs(Args):
    unread_only: bool = True


async def list_notifications(ctx: ToolContext, args: NotificationsArgs) -> dict:
    items = await notifications_service.list_notifications(ctx.session, ctx.user.id, limit=20)
    if args.unread_only:
        items = [n for n in items if not n.is_read]
    return {"notifications": [{"message": n.message, "type": n.type, "read": n.is_read} for n in items[:10]]}


# ── write tools (prepare → user confirms → execute) ──────────────────────────


class Category(StrEnum):
    food = "Food"
    groceries = "Groceries"
    transport = "Transport"
    travel = "Travel"
    shopping = "Shopping"
    bills = "Bills"
    rent = "Rent"
    entertainment = "Entertainment"
    health = "Health"
    other = "Other"


class ShareArg(Args):
    person: str = Field(description="Name of the person (use 'me' for the user)")
    value: Decimal = Field(description="Amount for custom splits, or percentage for percentage splits")


class CreateExpenseArgs(Args):
    amount: Decimal = Field(gt=0, description="Total amount the user paid. Never guess it; ask if unknown.")
    description: str = Field(min_length=1, max_length=200)
    category: Category
    subcategory: str | None = Field(default=None, max_length=80, description="e.g. Coffee, Cab, Rent")
    participants: list[str] = Field(
        default_factory=list,
        max_length=30,
        description="Names of the friends sharing the cost (the user is added automatically). "
        "Empty means a personal expense, or every member when a group is given.",
    )
    group: str | None = Field(default=None, description="Group name, if this is a group expense")
    split_type: Literal["equal", "percentage", "custom"] = "equal"
    shares: list[ShareArg] = Field(
        default_factory=list, max_length=30, description="Required for percentage or custom splits, one per person"
    )


async def prepare_create_expense(ctx: ToolContext, args: CreateExpenseArgs) -> Prepared:
    try:
        total_cents = to_cents(args.amount)
    except SplitError as exc:
        raise ToolError(str(exc)) from exc

    group = await resolve_group(ctx, args.group) if args.group else None
    if group:
        pool = await groups_service.list_members(ctx.session, group["id"])
    else:
        pool = await _friends(ctx)

    shares: dict[str, Decimal] = {}
    if args.split_type == "equal":
        names = args.participants
        people = await resolve_people(ctx, names, pool) if names else ([] if not group else pool)
        friend_ids = [p.id for p in people if p.id != ctx.user.id]
    else:
        if not args.shares:
            raise ToolError(f"A {args.split_type} split needs a share for each person. Ask the user for them.")
        for share in args.shares:
            person = await resolve_person(ctx, share.person, pool)
            if person.id in shares:
                raise ToolError(f"{person.name} appears twice in the shares. Ask the user to clarify.")
            shares[person.id] = share.value
        friend_ids = [pid for pid in shares if pid != ctx.user.id]

    data = expenses_service.ExpenseInput(
        amount=from_cents(total_cents),
        category=args.category.value,
        subcategory=args.subcategory,
        description=args.description,
        friend_ids=friend_ids,
        split_type=args.split_type,
        shares=shares,
        group_id=group["id"] if group else None,
    )
    try:
        split_type, computed = expenses_service.compute_shares(data, ctx.user.id, total_cents)
    except SplitError as exc:
        raise ToolError(str(exc)) from exc

    names_by_id = {p.id: p.name for p in pool} | {ctx.user.id: "You"}
    breakdown = [{"name": names_by_id.get(s.user_id, "?"), "amount": s.amount} for s in computed]
    how = "only you (personal)" if split_type == "personal" else f"split {split_type}ly"
    where = f" in {group['name']}" if group else ""
    summary = (
        f"Add {money(data.amount)} for '{args.description}' ({args.category.value}){where}, paid by you, {how}: "
        + ", ".join(f"{b['name']} {money(b['amount'])}" for b in breakdown)
    )
    stored = {
        "amount": str(data.amount),
        "category": data.category,
        "subcategory": data.subcategory,
        "description": data.description,
        "friend_ids": friend_ids,
        "split_type": args.split_type,
        "shares": {k: str(v) for k, v in shares.items()},
        "group_id": data.group_id,
    }
    return Prepared(stored, summary, {"breakdown": breakdown, "total": data.amount, "group": where.strip() or None})


async def execute_create_expense(ctx: ToolContext, args: dict) -> dict:
    data = expenses_service.ExpenseInput(
        amount=Decimal(args["amount"]),
        category=args["category"],
        subcategory=args.get("subcategory"),
        description=args.get("description"),
        friend_ids=args.get("friend_ids", []),
        split_type=args.get("split_type", "equal"),
        shares={k: Decimal(v) for k, v in (args.get("shares") or {}).items()},
        group_id=args.get("group_id"),
    )
    result = await expenses_service.create_expense(ctx.session, ctx.user, data)
    return {"expense_id": result["expense"]["id"], "amount": result["expense"]["amount"]}


class SettleArgs(Args):
    friend: str = Field(min_length=1, description="Name of the friend to settle with")
    amount: Decimal | None = Field(default=None, gt=0, description="Partial amount; omit to settle in full")


async def prepare_settle_up(ctx: ToolContext, args: SettleArgs) -> Prepared:
    friend = await resolve_person(ctx, args.friend, await _friends(ctx), allow_self=False)
    balance = await ledger.pair_balance(ctx.session, ctx.user.id, friend.id)
    if balance == 0:
        raise ToolError(f"The user and {friend.name} are already settled up, so there is nothing to record.")
    outstanding = abs(balance)
    amount = args.amount if args.amount is not None else outstanding
    try:
        to_cents(amount)
    except SplitError as exc:
        raise ToolError(str(exc)) from exc
    if amount > outstanding:
        raise ToolError(f"{money(amount)} is more than the outstanding {money(outstanding)}. Ask the user to check.")
    user_pays = balance < 0
    summary = (
        f"Record that you paid {friend.name} {money(amount)}"
        if user_pays
        else f"Record that {friend.name} paid you {money(amount)}"
    ) + f" (outstanding: {money(outstanding)})"
    return Prepared(
        {"friend_id": friend.id, "amount": str(amount), "user_pays": user_pays},
        summary,
        {"friend": friend.name, "amount": amount, "outstanding": outstanding},
    )


async def execute_settle_up(ctx: ToolContext, args: dict) -> dict:
    balance = await ledger.pair_balance(ctx.session, ctx.user.id, args["friend_id"])
    if (balance < 0) != args["user_pays"] or balance == 0:
        raise ToolError("The balance changed since this was proposed. Please ask again.")
    result = await ledger.settle(ctx.session, ctx.user, args["friend_id"], Decimal(args["amount"]))
    return {"settled": result["settledAmount"], "new_balance": result["newBalance"]}


class CreateGroupArgs(Args):
    name: str = Field(min_length=1, max_length=120, description="The group's name, e.g. 'Goa Trip'")
    members: list[str] = Field(default_factory=list, max_length=30, description="Friend names to add")


async def prepare_create_group(ctx: ToolContext, args: CreateGroupArgs) -> Prepared:
    people = await resolve_people(ctx, args.members, await _friends(ctx))
    members = [p for p in people if p.id != ctx.user.id]
    names = ", ".join(p.name for p in members) or "no one else yet"
    return Prepared(
        {"name": args.name, "member_ids": [p.id for p in members]},
        f"Create group '{args.name}' with you and {names}",
        {"name": args.name, "members": [p.name for p in members]},
    )


async def execute_create_group(ctx: ToolContext, args: dict) -> dict:
    group, members = await groups_service.create_group(ctx.session, ctx.user, args["name"], args["member_ids"])
    return {"group": group.name, "members": len(members)}


class AddFriendArgs(Args):
    email: str = Field(min_length=3, max_length=255, description="The friend's exact email address")


async def prepare_add_friend(ctx: ToolContext, args: AddFriendArgs) -> Prepared:
    friend = await users_service.get_by_email(ctx.session, args.email)
    if friend is None or friend.id == ctx.user.id:
        raise ToolError("No other Splity account uses that email. Ask the user to check it.")
    if friend.id in await friends_service.friend_ids(ctx.session, ctx.user.id):
        raise ToolError(f"{friend.name} is already the user's friend.")
    return Prepared({"friend_id": friend.id}, f"Add {friend.name} ({friend.email}) as a friend", {"name": friend.name})


async def execute_add_friend(ctx: ToolContext, args: dict) -> dict:
    friend = await friends_service.add_friend(ctx.session, ctx.user, friend_id=args["friend_id"])
    return {"friend": friend.name}


class PostMessageArgs(Args):
    group: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=500)


async def prepare_post_group_message(ctx: ToolContext, args: PostMessageArgs) -> Prepared:
    group = await resolve_group(ctx, args.group)
    return Prepared(
        {"group_id": group["id"], "message": args.message},
        f'Post in {group["name"]}: "{args.message}"',
        {"group": group["name"], "message": args.message},
    )


async def execute_post_group_message(ctx: ToolContext, args: dict) -> dict:
    await groups_service.require_membership(ctx.session, args["group_id"], ctx.user.id)
    await groups_service.post_message(ctx.session, args["group_id"], ctx.user, args["message"])
    return {"posted": True}


# ── registry ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[Args]
    run: Callable[[ToolContext, Any], Awaitable[dict]] | None = None  # read tools
    prepare: Callable[[ToolContext, Any], Awaitable[Prepared]] | None = None  # write tools
    execute: Callable[[ToolContext, dict], Awaitable[dict]] | None = None

    @property
    def mutates(self) -> bool:
        return self.prepare is not None


TOOLS: dict[str, ToolSpec] = {
    t.name: t
    for t in [
        ToolSpec("list_friends", "List the user's friends.", NoArgs, run=list_friends),
        ToolSpec("find_friends", "Find the user's friends whose name starts with some text.", FindFriendsArgs,
                 run=find_friends),
        ToolSpec("get_balances", "Who owes whom. Positive balance = that person owes the user.", BalancesArgs,
                 run=get_balances),
        ToolSpec("list_expenses", "Recent expenses the user paid for or shares, newest first.", ListExpensesArgs,
                 run=list_expenses),
        ToolSpec("list_groups", "List the user's groups.", NoArgs, run=list_groups),
        ToolSpec("get_group", "Members, totals, recent expenses and messages of one group.", GroupArgs,
                 run=get_group),
        ToolSpec("spending_summary", "The user's spending by category for one month (their own share).",
                 SpendingArgs, run=spending_summary),
        ToolSpec("list_notifications", "The user's recent notifications.", NotificationsArgs,
                 run=list_notifications),
        ToolSpec("create_expense", "Propose adding an expense the user paid for, optionally split. "
                 "The user must confirm before it is saved.", CreateExpenseArgs,
                 prepare=prepare_create_expense, execute=execute_create_expense),
        ToolSpec("settle_up", "Propose recording a repayment between the user and a friend. "
                 "The user must confirm.", SettleArgs, prepare=prepare_settle_up, execute=execute_settle_up),
        ToolSpec("create_group", "Propose creating a group with some friends. The user must confirm.",
                 CreateGroupArgs, prepare=prepare_create_group, execute=execute_create_group),
        ToolSpec("add_friend", "Propose adding a friend by exact email. The user must confirm.", AddFriendArgs,
                 prepare=prepare_add_friend, execute=execute_add_friend),
        ToolSpec("post_group_message", "Propose posting a message in a group. The user must confirm.",
                 PostMessageArgs, prepare=prepare_post_group_message, execute=execute_post_group_message),
    ]
}  # fmt: skip


def get_tool(name: str) -> ToolSpec:
    tool = TOOLS.get(name)
    if tool is None:
        raise ToolError(f"There is no tool called '{name}'.")
    return tool


def parse_args(tool: ToolSpec, raw: dict) -> Args:
    if "__invalid_json__" in raw:
        raise ToolError("The tool arguments were not valid JSON. Try again.")
    try:
        return tool.args_model.model_validate(raw)
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'args'}: {e['msg']}" for e in exc.errors())
        raise ToolError(f"Invalid arguments for {tool.name}: {problems}") from exc


async def run_read(ctx: ToolContext, name: str, raw: dict) -> dict:
    tool = get_tool(name)
    if tool.mutates:
        raise ToolError(f"{name} changes data and must go through confirmation.")
    try:
        return jsonable_encoder(await tool.run(ctx, parse_args(tool, raw)))
    except DomainError as exc:
        raise ToolError(exc.message) from exc


async def prepare_write(ctx: ToolContext, name: str, raw: dict) -> Prepared:
    tool = get_tool(name)
    if not tool.mutates:
        raise ToolError(f"{name} does not change data.")
    try:
        prepared = await tool.prepare(ctx, parse_args(tool, raw))
    except DomainError as exc:
        raise ToolError(exc.message) from exc
    return Prepared(jsonable_encoder(prepared.args), prepared.summary, jsonable_encoder(prepared.preview))


async def execute_write(ctx: ToolContext, name: str, stored_args: dict) -> dict:
    tool = get_tool(name)
    try:
        return jsonable_encoder(await tool.execute(ctx, stored_args))
    except DomainError as exc:
        raise ToolError(exc.message) from exc


# ── schemas for the model ────────────────────────────────────────────────────


def _inline(schema: dict, defs: dict) -> dict:
    """Flatten a Pydantic JSON schema into the subset every provider accepts:
    no $ref, no anyOf-with-null, no titles."""
    if "$ref" in schema:
        return _inline(defs[schema["$ref"].split("/")[-1]], defs)
    out: dict = {}
    for key, value in schema.items():
        if key in ("title", "$defs", "default"):
            continue
        if key == "anyOf":
            options = [o for o in value if o.get("type") != "null"]
            # Decimal fields render as number-or-string; the model should just send a number.
            numeric = [o for o in options if o.get("type") == "number"]
            if len(options) == 1 or numeric:
                out.update(_inline((numeric or options)[0], defs))
                continue
        if isinstance(value, dict):
            out[key] = _inline(value, defs) if key != "properties" else {k: _inline(v, defs) for k, v in value.items()}
        elif isinstance(value, list):
            out[key] = [_inline(v, defs) if isinstance(v, dict) else v for v in value]
        else:
            out[key] = value
    if out.get("type") == "string" and "pattern" in out and "format" not in out:
        out.pop("pattern")  # Decimal patterns confuse some providers; values are re-validated server-side
    return out


def model_schema(model: type[BaseModel]) -> dict:
    raw = model.model_json_schema()
    schema = _inline(raw, raw.get("$defs", {}))
    schema.setdefault("properties", {})
    schema["type"] = "object"
    return schema


def openai_tools(names: list[str] | None = None) -> list[dict]:
    selected = [TOOLS[n] for n in names] if names else list(TOOLS.values())
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": model_schema(t.args_model)},
        }
        for t in selected
    ]
