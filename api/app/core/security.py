from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import get_settings

BCRYPT_ROUNDS = 12


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    """Accounts without a stored hash can never sign in with a password.

    The legacy Node backend let any password through for such accounts.
    """
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: str, email: str) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    # Claim names match the legacy backend so existing frontend sessions keep working.
    payload = {
        "userId": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict | None:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if not isinstance(payload.get("userId"), str):
        return None
    return payload
