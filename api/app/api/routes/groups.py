from fastapi import APIRouter, status

from app.api.deps import CurrentUser, SessionDep
from app.api.schemas import CreateGroupIn, GroupMessageIn
from app.services import expenses as expenses_service
from app.services import groups as groups_service

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("")
async def list_groups(user: CurrentUser, session: SessionDep):
    return await groups_service.list_groups(session, user.id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_group(body: CreateGroupIn, user: CurrentUser, session: SessionDep):
    group, members = await groups_service.create_group(session, user, body.name, body.members)
    return {
        "group": {"id": group.id, "name": group.name, "created_by": group.created_by, "created_at": group.created_at},
        "members": members,
    }


@router.get("/{group_id}")
async def group_details(group_id: str, user: CurrentUser, session: SessionDep):
    await groups_service.require_membership(session, group_id, user.id)
    summary = await groups_service.get_group_summary(session, group_id)
    members = await groups_service.list_members(session, group_id)
    return {**summary, "members": [{"id": m.id, "name": m.name, "email": m.email} for m in members]}


@router.get("/{group_id}/expenses")
async def group_expenses(group_id: str, user: CurrentUser, session: SessionDep):
    await groups_service.require_membership(session, group_id, user.id)
    return await expenses_service.list_group_expenses(session, group_id)


@router.get("/{group_id}/messages")
async def group_messages(group_id: str, user: CurrentUser, session: SessionDep):
    await groups_service.require_membership(session, group_id, user.id)
    return await groups_service.list_messages(session, group_id)


@router.post("/{group_id}/messages", status_code=status.HTTP_201_CREATED)
async def post_group_message(group_id: str, body: GroupMessageIn, user: CurrentUser, session: SessionDep):
    await groups_service.require_membership(session, group_id, user.id)
    return await groups_service.post_message(session, group_id, user, body.message)
