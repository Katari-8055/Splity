from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.api.routes.auth import public_user
from app.services import users as users_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/profile")
async def profile(user: CurrentUser):
    return public_user(user)


@router.get("/search")
async def search(user: CurrentUser, session: SessionDep, q: str = Query(default="", max_length=100)):
    if len(q.strip()) < 2:
        return []
    found = await users_service.search_users(session, q, exclude_id=user.id)
    return [{"id": u.id, "name": u.name, "email": u.email} for u in found]
