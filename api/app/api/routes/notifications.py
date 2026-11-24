from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.api.schemas import AckIn
from app.db.models import Notification
from app.services import notifications as notifications_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _notification(n: Notification) -> dict:
    return {
        "id": n.id,
        "user_id": n.user_id,
        "type": n.type,
        "message": n.message,
        "data": n.data,
        "is_read": n.is_read,
        "created_at": n.created_at,
    }


@router.get("")
async def list_notifications(user: CurrentUser, session: SessionDep):
    return [_notification(n) for n in await notifications_service.list_notifications(session, user.id)]


@router.post("/ack")
async def acknowledge(body: AckIn, user: CurrentUser, session: SessionDep):
    return _notification(await notifications_service.acknowledge(session, user.id, body.notification_id))
