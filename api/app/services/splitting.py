"""Pure split arithmetic in integer paise/cents, with no I/O.

Invariant for every function: the shares always add up to exactly the total.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MAX_AMOUNT = Decimal("10000000.00")
HUNDRED = Decimal(100)


class SplitError(ValueError):
    pass


@dataclass(frozen=True)
class Share:
    user_id: str
    cents: int

    @property
    def amount(self) -> Decimal:
        return Decimal(self.cents) / HUNDRED


def to_cents(amount: Decimal | int | float | str) -> int:
    """Convert a money amount to integer cents, rejecting sub-cent precision."""
    try:
        value = Decimal(str(amount))
    except (InvalidOperation, ValueError) as exc:
        raise SplitError(f"Invalid amount: {amount!r}") from exc
    if not value.is_finite():
        raise SplitError("Amount must be a finite number")
    if value != value.quantize(Decimal("0.01")):
        raise SplitError("Amount cannot have more than 2 decimal places")
    if value <= 0:
        raise SplitError("Amount must be greater than 0")
    if value > MAX_AMOUNT:
        raise SplitError(f"Amount cannot exceed {MAX_AMOUNT}")
    return int(value * 100)


def from_cents(cents: int) -> Decimal:
    return (Decimal(cents) / HUNDRED).quantize(Decimal("0.01"))


def _unique(participant_ids: list[str]) -> list[str]:
    if not participant_ids:
        raise SplitError("At least one participant is required")
    seen: set[str] = set()
    for pid in participant_ids:
        if pid in seen:
            raise SplitError(f"Duplicate participant: {pid}")
        seen.add(pid)
    return participant_ids


def equal_split(total_cents: int, participant_ids: list[str]) -> list[Share]:
    """Split evenly. Leftover cents go one each to the first participants (payer first)."""
    ids = _unique(participant_ids)
    base, remainder = divmod(total_cents, len(ids))
    return [Share(pid, base + (1 if i < remainder else 0)) for i, pid in enumerate(ids)]


def percentage_split(total_cents: int, percentages: dict[str, Decimal]) -> list[Share]:
    """Split by percentages that sum to exactly 100.

    Uses the largest-remainder method so the rounded shares still add up to
    the total exactly.
    """
    ids = _unique(list(percentages))
    pcts = {pid: Decimal(str(percentages[pid])) for pid in ids}
    if any(p <= 0 for p in pcts.values()):
        raise SplitError("Every percentage must be greater than 0")
    if sum(pcts.values()) != HUNDRED:
        raise SplitError(f"Percentages must add up to 100 (got {sum(pcts.values())})")

    exact = {pid: Decimal(total_cents) * pcts[pid] / HUNDRED for pid in ids}
    floors = {pid: int(exact[pid]) for pid in ids}
    leftover = total_cents - sum(floors.values())
    # Largest fractional part first; ties resolved by input order (stable sort).
    by_fraction = sorted(ids, key=lambda pid: exact[pid] - floors[pid], reverse=True)
    for pid in by_fraction[:leftover]:
        floors[pid] += 1
    return [Share(pid, floors[pid]) for pid in ids]


def custom_split(total_cents: int, amounts: dict[str, Decimal | int | float | str]) -> list[Share]:
    """Use explicit per-person amounts, which must add up to the total exactly."""
    ids = _unique(list(amounts))
    shares = []
    for pid in ids:
        value = Decimal(str(amounts[pid]))
        if value != value.quantize(Decimal("0.01")):
            raise SplitError(f"Share for {pid} cannot have more than 2 decimal places")
        if value < 0:
            raise SplitError(f"Share for {pid} cannot be negative")
        shares.append(Share(pid, int(value * 100)))
    total = sum(s.cents for s in shares)
    if total != total_cents:
        raise SplitError(f"Shares add up to {from_cents(total)} but the expense total is {from_cents(total_cents)}")
    return shares


def round_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
