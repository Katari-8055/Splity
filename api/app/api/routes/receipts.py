"""Receipt upload (OCR), review, AI item assignment, and splitting."""

import asyncio
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field

from app.ai.llm import get_llm
from app.ai.receipt_assign import assign_items
from app.ai.tools import ToolContext, ToolError
from app.api.deps import CurrentUser, SessionDep
from app.api.routes.ai import enforce_ai_limit
from app.api.schemas import CamelModel
from app.core.config import get_settings
from app.core.errors import BadRequest, NotFound
from app.services import receipts as receipts_service

router = APIRouter(tags=["receipts"])


class AssignIn(CamelModel):
    instruction: str = Field(min_length=3, max_length=1000)


class SplitIn(CamelModel):
    # item id → user ids who shared it (from /assign, possibly edited by the user)
    assignments: dict[str, list[str]]
    group_id: str | None = None


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(get_settings().max_receipt_bytes + 1)
    if not data:
        raise BadRequest("Empty upload")
    return data


@router.post("/receipts")
@router.post("/bills/ocr/upload")  # legacy path used by the Bills page
async def upload_receipt(user: CurrentUser, session: SessionDep, receipt: UploadFile = File(...)):
    enforce_ai_limit(user)
    data = await _read_upload(receipt)
    saved, items = await receipts_service.upload_and_parse(session, get_llm(), user, receipt.filename or "", data)
    body = receipts_service.receipt_dict(saved, items)
    # Legacy response shape for the existing page, plus the full receipt.
    return {
        "success": saved.status != "failed",
        "receipt": body,
        "bill": body,
        "imageUrl": body["imageUrl"],
        "parsedData": {
            "merchantName": saved.merchant,
            "totalAmount": saved.total,
            "items": [{"item_name": i.name, "price": i.amount, "quantity": i.quantity} for i in items],
        },
    }


@router.get("/receipts")
@router.get("/bills/user/me")
async def my_receipts(user: CurrentUser, session: SessionDep):
    rows = await receipts_service.list_for_user(session, user.id)
    return [receipts_service.receipt_dict(r, []) for r in rows]


@router.get("/receipts/{receipt_id}")
@router.get("/bills/{receipt_id}")
async def get_receipt(receipt_id: str, user: CurrentUser, session: SessionDep):
    receipt, items = await receipts_service.get_owned(session, user.id, receipt_id)
    return receipts_service.receipt_dict(receipt, items)


@router.get("/receipts/{receipt_id}/image")
async def receipt_image(receipt_id: str, user: CurrentUser, session: SessionDep):
    receipt, _ = await receipts_service.get_owned(session, user.id, receipt_id)

    def safe_path() -> Path | None:
        # Only serve files inside the upload folder (defends against a tampered storage_path).
        path = Path(receipt.storage_path).resolve()
        root = Path(get_settings().upload_dir).resolve() / "receipts"
        return path if root in path.parents and path.is_file() else None

    path = await asyncio.to_thread(safe_path)
    if path is None:
        raise NotFound("Image not found")
    return FileResponse(path, media_type=receipt.mime_type)


@router.post("/receipts/{receipt_id}/assign")
async def assign(receipt_id: str, body: AssignIn, user: CurrentUser, session: SessionDep):
    """Preview: turn "I had the paneer, Rahul and Priya shared the pizza" into item assignments."""
    enforce_ai_limit(user)
    receipt, items = await receipts_service.get_owned(session, user.id, receipt_id)
    try:
        return await assign_items(session, get_llm(), ToolContext(session, user), receipt, items, body.instruction)
    except ToolError as exc:
        raise BadRequest(str(exc)) from exc


@router.post("/receipts/{receipt_id}/split", status_code=201)
async def split(receipt_id: str, body: SplitIn, user: CurrentUser, session: SessionDep):
    return await receipts_service.split_receipt(session, user, receipt_id, body.assignments, body.group_id)
