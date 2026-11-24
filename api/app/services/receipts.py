"""Receipts: storage, OCR, and turning a receipt into a per-item split expense."""

import asyncio
import math
import uuid
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import rag
from app.ai.llm import LLMClient
from app.ai.ocr import read_receipt, sniff_image
from app.core.config import get_settings
from app.core.errors import BadRequest, NotFound
from app.db.models import Receipt, ReceiptItem, User
from app.services import expenses as expenses_service
from app.services.splitting import from_cents, to_cents

EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def _store(data: bytes, extension: str) -> Path:
    root = Path(get_settings().upload_dir).resolve() / "receipts"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{uuid.uuid4()}{extension}"
    path.write_bytes(data)
    return path


async def upload_and_parse(
    session: AsyncSession, llm: LLMClient, user: User, filename: str, data: bytes
) -> tuple[Receipt, list[ReceiptItem]]:
    if len(data) > get_settings().max_receipt_bytes:
        raise BadRequest("Receipt image is too large (max 8 MB)")
    mime = sniff_image(data)
    if mime is None:
        raise BadRequest("Upload a JPEG, PNG or WebP image")

    # Random server-side name: the user's filename is never used as a path.
    path = await asyncio.to_thread(_store, data, EXTENSIONS[mime])

    parsed, issues = await read_receipt(llm, data, mime)
    receipt = Receipt(
        user_id=user.id,
        filename=Path(filename or "receipt").name[:255],
        storage_path=str(path),
        mime_type=mime,
        status="failed" if parsed is None else ("needs_review" if issues else "parsed"),
        issues=issues,
    )
    items: list[ReceiptItem] = []
    if parsed:
        receipt.merchant = (parsed.merchant or "")[:200] or None
        receipt.bill_date = (parsed.date or "")[:20] or None
        receipt.currency = (parsed.currency or "")[:10] or None
        receipt.subtotal, receipt.tax, receipt.tip = parsed.subtotal, parsed.tax, parsed.tip
        receipt.discount, receipt.total = parsed.discount, parsed.total
        receipt.raw_text = (parsed.raw_text or "")[:20000] or None
    session.add(receipt)
    await session.flush()
    if parsed:
        items = [
            ReceiptItem(
                receipt_id=receipt.id,
                position=i,
                name=item.name,
                quantity=item.quantity,
                amount=item.amount.quantize(Decimal("0.01")),
                category=(item.category or "")[:50] or None,
            )
            for i, item in enumerate(parsed.items)
        ]
        session.add_all(items)
    await session.commit()
    if parsed:
        rag.schedule_index("receipt", receipt.id)
    return receipt, items


async def get_owned(session: AsyncSession, user_id: str, receipt_id: str) -> tuple[Receipt, list[ReceiptItem]]:
    receipt = await session.get(Receipt, receipt_id)
    if receipt is None or receipt.user_id != user_id:
        raise NotFound("Receipt not found")
    items = list(
        await session.scalars(
            select(ReceiptItem).where(ReceiptItem.receipt_id == receipt_id).order_by(ReceiptItem.position)
        )
    )
    return receipt, items


async def list_for_user(session: AsyncSession, user_id: str, limit: int = 50) -> list[Receipt]:
    result = await session.scalars(
        select(Receipt).where(Receipt.user_id == user_id).order_by(Receipt.created_at.desc()).limit(limit)
    )
    return list(result)


def receipt_dict(receipt: Receipt, items: list[ReceiptItem]) -> dict:
    return {
        "id": receipt.id,
        "status": receipt.status,
        "issues": receipt.issues,
        "merchant": receipt.merchant,
        "billDate": receipt.bill_date,
        "currency": receipt.currency,
        "subtotal": receipt.subtotal,
        "tax": receipt.tax,
        "tip": receipt.tip,
        "discount": receipt.discount,
        "total": receipt.total,
        "expenseId": receipt.expense_id,
        "imageUrl": f"/api/receipts/{receipt.id}/image",
        "createdAt": receipt.created_at,
        "items": [
            {"id": i.id, "position": i.position, "name": i.name, "quantity": i.quantity, "amount": i.amount,
             "category": i.category}
            for i in items
        ],
        # Legacy keys read by the existing Bills page.
        "merchant_name": receipt.merchant,
        "total_amount": receipt.total,
        "image_url": f"/api/receipts/{receipt.id}/image",
        "created_at": receipt.created_at,
    }  # fmt: skip


def allocate(items: list[ReceiptItem], receipt: Receipt, assignments: dict[str, list[str]]) -> dict[str, int]:
    """Per-person cents for an item-level split.

    Each item is split equally among the people assigned to it. Tax, tip and
    discount are shared in proportion to each person's item subtotal. The
    result always adds up to the receipt total exactly (largest remainder).
    """
    if not items:
        raise BadRequest("This receipt has no line items to split")
    missing = [i.name for i in items if not assignments.get(i.id)]
    if missing:
        raise BadRequest(f"Assign every item to at least one person (missing: {', '.join(missing[:5])})")

    item_cents: dict[str, int] = {}
    for item in items:
        people = list(dict.fromkeys(assignments[item.id]))
        base, extra = divmod(int(item.amount * 100), len(people))
        for n, person in enumerate(people):
            item_cents[person] = item_cents.get(person, 0) + base + (1 if n < extra else 0)

    items_total = sum(item_cents.values())
    grand_total = to_cents(receipt.total) if receipt.total else items_total
    adjustment = grand_total - items_total  # tax + tip - discount, or rounding
    if items_total <= 0:
        raise BadRequest("Item amounts must be positive")

    exact = {p: Decimal(adjustment) * c / items_total for p, c in item_cents.items()}
    floors = {p: math.floor(v) for p, v in exact.items()}  # true floor, also for negative adjustments
    leftover = adjustment - sum(floors.values())
    for p in sorted(exact, key=lambda k: exact[k] - floors[k], reverse=True)[:leftover]:
        floors[p] += 1
    return {p: item_cents[p] + floors[p] for p in item_cents}


async def split_receipt(
    session: AsyncSession, user: User, receipt_id: str, assignments: dict[str, list[str]], group_id: str | None = None
) -> dict:
    """Create one custom-split expense from item assignments (item id → user ids). Paid by ``user``."""
    receipt, items = await get_owned(session, user.id, receipt_id)
    if receipt.expense_id:
        raise BadRequest("This receipt has already been turned into an expense")
    if receipt.total is None:
        raise BadRequest("This receipt has no total; fix it before splitting")
    shares = allocate(items, receipt, assignments)
    data = expenses_service.ExpenseInput(
        amount=receipt.total,
        category="Food",
        description=receipt.merchant or "Receipt",
        split_type="custom",
        shares={pid: from_cents(c) for pid, c in shares.items()},
        friend_ids=[pid for pid in shares if pid != user.id],
        group_id=group_id,
    )
    result = await expenses_service.create_expense(session, user, data)
    receipt = await session.get(Receipt, receipt_id)
    receipt.expense_id = result["expense"]["id"]
    await session.commit()
    return result
