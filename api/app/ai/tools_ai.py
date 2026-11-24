"""Tools backed by AI subsystems: text-to-SQL, RAG search and receipts.

Registered into the shared TOOLS registry (imported at the bottom of tools.py),
so the agent and the MCP server both get them.
"""

from pydantic import Field
from sqlalchemy import select

from app.ai.llm import get_llm
from app.ai.tools import TOOLS, Args, NoArgs, Prepared, ToolContext, ToolError, ToolSpec, money
from app.core.errors import DomainError
from app.db.models import Receipt

# ── analytics (text-to-SQL) ──────────────────────────────────────────────────


class AnalyticsArgs(Args):
    question: str = Field(min_length=3, max_length=500, description="The user's analytics question, in full")


async def ask_analytics(ctx: ToolContext, args: AnalyticsArgs) -> dict:
    from app.ai.sql_agent import UnsafeSQL, answer_question

    try:
        result = await answer_question(ctx.session, get_llm(), ctx.user.id, args.question)
    except UnsafeSQL as exc:
        raise ToolError(f"Couldn't answer that from the data: {exc}") from exc
    return {
        "sql": result.sql,
        "columns": result.columns,
        "rows": result.rows[:50],
        "row_count": result.row_count,
        "note": "Amounts are the user's own share unless the column says otherwise.",
    }


# ── RAG ──────────────────────────────────────────────────────────────────────


class SearchArgs(Args):
    query: str = Field(min_length=2, max_length=300, description="What to look for, in natural language")


async def search_documents(ctx: ToolContext, args: SearchArgs) -> dict:
    from app.ai.rag import search

    hits = await search(ctx.session, get_llm(), ctx.user.id, args.query)
    return {
        "results": [
            {
                "citation": h.citation(),
                "type": h.source_type,
                "date": h.meta.get("date"),
                "title": h.meta.get("title"),
                "text": h.content[:800],
            }
            for h in hits
        ],
        "how_to_cite": "Answer only from these results and put the citation, e.g. [receipt:1a2b3c4d], after each fact. "
        "If nothing relevant is found, say so.",
    }


# ── receipts ─────────────────────────────────────────────────────────────────


async def list_receipts(ctx: ToolContext, _: NoArgs) -> dict:
    from app.services.receipts import list_for_user

    receipts = await list_for_user(ctx.session, ctx.user.id, limit=10)
    return {
        "receipts": [
            {
                "merchant": r.merchant,
                "date": r.bill_date,
                "total": r.total,
                "status": r.status,
                "already_split": bool(r.expense_id),
                "uploaded": r.created_at.date().isoformat(),
            }
            for r in receipts
        ]
    }


async def _find_receipt(ctx: ToolContext, merchant: str | None) -> Receipt:
    query = select(Receipt).where(Receipt.user_id == ctx.user.id, Receipt.expense_id.is_(None))
    if merchant and merchant.lower() not in ("latest", "last", "recent"):
        query = query.where(Receipt.merchant.ilike(f"%{merchant}%"))
    receipt = await ctx.session.scalar(query.order_by(Receipt.created_at.desc()).limit(1))
    if receipt is None:
        raise ToolError("No unsplit receipt matches that. Ask the user to upload the receipt first.")
    return receipt


class SplitReceiptArgs(Args):
    receipt: str | None = Field(default=None, description="Merchant name, or 'latest' for the newest receipt")
    instruction: str = Field(min_length=3, max_length=1000, description="Who had what, in the user's words")


async def prepare_split_receipt(ctx: ToolContext, args: SplitReceiptArgs) -> Prepared:
    from app.ai.receipt_assign import assign_items
    from app.services.receipts import get_owned

    receipt = await _find_receipt(ctx, args.receipt)
    if receipt.status == "failed":
        raise ToolError("That receipt couldn't be read. Ask the user to retake the photo.")
    receipt, items = await get_owned(ctx.session, ctx.user.id, receipt.id)
    try:
        plan = await assign_items(ctx.session, get_llm(), ctx, receipt, items, args.instruction)
    except DomainError as exc:
        raise ToolError(exc.message) from exc
    warning = " (receipt totals didn't add up; double-check)" if receipt.status == "needs_review" else ""
    summary = f"Split the {receipt.merchant or 'receipt'} bill ({money(receipt.total)}) by item{warning}: " + ", ".join(
        f"{s['name']} {money(s['amount'])}" for s in plan["shares"]
    )
    return Prepared(
        {"receipt_id": receipt.id, "assignments": plan["assignments"]},
        summary,
        {"breakdown": [{"name": s["name"], "amount": s["amount"]} for s in plan["shares"]], "items": plan["items"],
         "unclear": plan["unclear"]},
    )  # fmt: skip


async def execute_split_receipt(ctx: ToolContext, args: dict) -> dict:
    from app.services.receipts import split_receipt

    result = await split_receipt(ctx.session, ctx.user, args["receipt_id"], args["assignments"])
    return {"expense_id": result["expense"]["id"]}


TOOLS.update(
    {
        t.name: t
        for t in [
            ToolSpec("ask_analytics", "Answer any question about the user's spending, trends or comparisons "
                     "(totals, categories, months, weekdays, friends) by querying their data with SQL. "
                     "Use this for every numeric or 'how much' question.", AnalyticsArgs, run=ask_analytics),
            ToolSpec("search_documents", "Search receipts, expense notes and group chat by meaning, e.g. "
                     "'what did I order at Barbeque Nation' or 'what did we decide about the Airbnb'. "
                     "Not for totals.", SearchArgs, run=search_documents),
            ToolSpec("list_receipts", "The user's recently uploaded receipts.", NoArgs, run=list_receipts),
            ToolSpec("split_receipt", "Propose splitting an uploaded receipt item by item from the user's "
                     "description of who had what. The user must confirm.", SplitReceiptArgs,
                     prepare=prepare_split_receipt, execute=execute_split_receipt),
        ]
    }
)  # fmt: skip
