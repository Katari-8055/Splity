from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Unauthorized
from app.core.security import decode_access_token
from app.db.models import User
from app.db.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    session: SessionDep,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    """Identity comes only from a verified JWT. Client-sent user IDs are never trusted."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise Unauthorized("Authentication required. Missing Authorization header.")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise Unauthorized("Authentication failed. Invalid or expired token.")
    user = await session.get(User, payload["userId"])
    if user is None:
        raise Unauthorized("Authentication failed. User no longer exists.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
