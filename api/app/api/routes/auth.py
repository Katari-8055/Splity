from fastapi import APIRouter, Depends, status

from app.api.deps import SessionDep
from app.api.schemas import SignInIn, SignUpIn
from app.core.rate_limit import limit_login
from app.core.security import create_access_token
from app.db.models import User
from app.services import users as users_service

router = APIRouter(prefix="/auth", tags=["auth"])


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "created_at": user.created_at,
    }


def _session_payload(user: User) -> dict:
    return {"user": public_user(user), "token": create_access_token(user.id, user.email)}


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignUpIn, session: SessionDep):
    user = await users_service.create_user(
        session, name=body.name, email=body.email, password=body.password, phone=body.phone, role=body.role
    )
    return _session_payload(user)


@router.post("/signin", dependencies=[Depends(limit_login)])
async def signin(body: SignInIn, session: SessionDep):
    user = await users_service.authenticate(session, body.email, body.password)
    return _session_payload(user)
