from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.api.schemas import AddFriendIn, ReminderIn
from app.db.models import User
from app.services import friends as friends_service

router = APIRouter(prefix="/friends", tags=["friends"])


def _friend(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "phone": u.phone}


@router.get("")
async def list_friends(user: CurrentUser, session: SessionDep):
    return [_friend(f) for f in await friends_service.list_friends(session, user.id)]


@router.get("/search")
async def search_friends(
    user: CurrentUser,
    session: SessionDep,
    prefix: str = Query(default="", max_length=100),
    q: str = Query(default="", max_length=100),
):
    found = await friends_service.search_friends(session, user.id, prefix or q)
    return [_friend(f) for f in found]


@router.post("/add")
async def add_friend(body: AddFriendIn, user: CurrentUser, session: SessionDep):
    friend = await friends_service.add_friend(
        session, user, friend_id=body.friend_id, email=body.friend_email, phone=body.friend_phone
    )
    return {
        "message": "Friend added successfully",
        "friendship": {"user_id": user.id, "friend_id": friend.id},
        "friend": _friend(friend),
    }


@router.post("/send-reminder")
async def send_reminder(body: ReminderIn, user: CurrentUser, session: SessionDep):
    await friends_service.send_reminder(session, user, body.friend_id, body.message)
    return {"success": True, "message": "Reminder sent successfully"}
