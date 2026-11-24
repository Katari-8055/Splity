from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import rag
from app.core.errors import BadRequest, NotFound
from app.db.models import Expense, Group, GroupMember, GroupMessage, User
from app.services.friends import friend_ids
from app.services.notifications import notify


async def is_member(session: AsyncSession, group_id: str, user_id: str) -> bool:
    found = await session.scalar(
        select(GroupMember.user_id).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
    )
    return found is not None


async def require_membership(session: AsyncSession, group_id: str, user_id: str) -> Group:
    """Look up the group by ID only (never by name), and check the user belongs to it.

    A group that doesn't exist and one the user isn't in both return 404, so
    the API never confirms that a group ID exists.
    """
    group = await session.get(Group, group_id)
    if group is None or not await is_member(session, group_id, user_id):
        raise NotFound("Group not found")
    return group


async def member_ids(session: AsyncSession, group_id: str) -> set[str]:
    result = await session.scalars(select(GroupMember.user_id).where(GroupMember.group_id == group_id))
    return set(result)


async def list_members(session: AsyncSession, group_id: str) -> list[User]:
    result = await session.scalars(
        select(User)
        .join(GroupMember, GroupMember.user_id == User.id)
        .where(GroupMember.group_id == group_id)
        .order_by(User.name)
    )
    return list(result)


def _summary_columns():
    member_count = (
        select(func.count())
        .where(GroupMember.group_id == Group.id)
        .correlate(Group)
        .scalar_subquery()
        .label("member_count")
    )
    total_spent = (
        select(func.coalesce(func.sum(Expense.amount), 0))
        .where(Expense.group_id == Group.id)
        .correlate(Group)
        .scalar_subquery()
        .label("total_spent")
    )
    return member_count, total_spent


async def list_groups(session: AsyncSession, user_id: str) -> list[dict]:
    member_count, total_spent = _summary_columns()
    rows = await session.execute(
        select(Group, member_count, total_spent)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user_id)
        .order_by(Group.created_at.desc())
    )
    return [_group_dict(g, mc, ts) for g, mc, ts in rows]


async def get_group_summary(session: AsyncSession, group_id: str) -> dict:
    member_count, total_spent = _summary_columns()
    row = (await session.execute(select(Group, member_count, total_spent).where(Group.id == group_id))).one()
    return _group_dict(*row)


def _group_dict(group: Group, member_count: int, total_spent: Decimal) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "created_by": group.created_by,
        "created_at": group.created_at,
        "member_count": member_count,
        "total_spent": total_spent,
    }


async def create_group(
    session: AsyncSession, creator: User, name: str, member_ids_in: list[str]
) -> tuple[Group, list[str]]:
    name = name.strip()
    if not name:
        raise BadRequest("Valid group name is required")

    requested = {m for m in member_ids_in if m and m != creator.id}
    strangers = requested - await friend_ids(session, creator.id)
    if strangers:
        raise BadRequest("You can only add friends to a group")

    group = Group(name=name, created_by=creator.id)
    session.add(group)
    await session.flush()

    members = [creator.id, *sorted(requested)]
    session.add_all(GroupMember(group_id=group.id, user_id=m) for m in members)
    for m in requested:
        notify(session, m, f"{creator.name} added you to group: {name}", "group_added", {"groupId": group.id})
    await session.commit()
    return group, members


async def list_messages(session: AsyncSession, group_id: str) -> list[dict]:
    rows = await session.execute(
        select(GroupMessage, User.name)
        .join(User, User.id == GroupMessage.user_id)
        .where(GroupMessage.group_id == group_id)
        .order_by(GroupMessage.created_at)
    )
    return [_message_dict(m, user_name) for m, user_name in rows]


async def post_message(session: AsyncSession, group_id: str, user: User, text: str) -> dict:
    text = text.strip()
    if not text:
        raise BadRequest("Message content is required")
    if len(text) > 2000:
        raise BadRequest("Message is too long (max 2000 characters)")
    message = GroupMessage(group_id=group_id, user_id=user.id, message=text)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    rag.schedule_index("group_message", message.id)
    return _message_dict(message, user.name)


def _message_dict(message: GroupMessage, user_name: str) -> dict:
    return {
        "id": message.id,
        "group_id": message.group_id,
        "user_id": message.user_id,
        "user_name": user_name,
        "message": message.message,
        "created_at": message.created_at,
    }
