from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.services.splitting import (
    SplitError,
    custom_split,
    equal_split,
    from_cents,
    percentage_split,
    to_cents,
)

ids = st.lists(st.text(min_size=1, max_size=6), min_size=1, max_size=20, unique=True)
cents = st.integers(min_value=1, max_value=1_000_000_000)


# ── to_cents ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("value", "expected"),
    [("60", 6000), ("0.01", 1), (Decimal("99.99"), 9999), (60.1, 6010), (12, 1200)],
)
def test_to_cents_accepts_valid_amounts(value, expected):
    assert to_cents(value) == expected


@pytest.mark.parametrize("value", ["0", "-5", "1.005", "NaN", "Infinity", "abc", "10000000.01"])
def test_to_cents_rejects_invalid_amounts(value):
    with pytest.raises(SplitError):
        to_cents(value)


# ── equal ────────────────────────────────────────────────────────────────────


def test_equal_split_gives_leftover_cents_to_first_participants():
    shares = equal_split(10000, ["payer", "a", "b"])  # 100.00 / 3
    assert [s.cents for s in shares] == [3334, 3333, 3333]
    assert shares[0].user_id == "payer"


def test_equal_split_rejects_duplicates_and_empty():
    with pytest.raises(SplitError):
        equal_split(100, ["a", "a"])
    with pytest.raises(SplitError):
        equal_split(100, [])


@given(total=cents, participants=ids)
def test_equal_split_always_sums_to_total_and_is_fair(total, participants):
    shares = equal_split(total, participants)
    values = [s.cents for s in shares]
    assert sum(values) == total
    assert max(values) - min(values) <= 1  # nobody pays more than 1 cent extra


# ── percentage ───────────────────────────────────────────────────────────────


def test_percentage_split_60_40():
    shares = percentage_split(150000, {"me": Decimal(60), "priya": Decimal(40)})
    assert {s.user_id: s.cents for s in shares} == {"me": 90000, "priya": 60000}


def test_percentage_split_thirds_rounds_without_losing_cents():
    pct = Decimal("33.33")
    shares = percentage_split(100, {"a": pct, "b": pct, "c": Decimal("33.34")})
    assert sum(s.cents for s in shares) == 100


@pytest.mark.parametrize(
    "pcts",
    [
        {"a": Decimal(50), "b": Decimal(40)},
        {"a": Decimal(110), "b": Decimal(-10)},
        {"a": Decimal(0), "b": Decimal(100)},
    ],
)
def test_percentage_split_rejects_bad_percentages(pcts):
    with pytest.raises(SplitError):
        percentage_split(1000, pcts)


@given(total=cents, weights=st.lists(st.integers(1, 1000), min_size=1, max_size=10))
def test_percentage_split_always_sums_to_total(total, weights):
    # Build percentages that add up to exactly 100 (2 decimal places), with the
    # last one absorbing the rounding.
    raw = [Decimal(w) * 100 / sum(weights) for w in weights]
    pcts = [p.quantize(Decimal("0.01")) for p in raw[:-1]]
    pcts.append(Decimal(100) - sum(pcts))
    if any(p <= 0 for p in pcts):
        return
    shares = percentage_split(total, {f"u{i}": p for i, p in enumerate(pcts)})
    assert sum(s.cents for s in shares) == total


# ── custom ───────────────────────────────────────────────────────────────────


def test_custom_split_must_match_total():
    assert [s.cents for s in custom_split(10000, {"a": "70", "b": "30"})] == [7000, 3000]
    with pytest.raises(SplitError, match="add up to"):
        custom_split(10000, {"a": "70", "b": "20"})


def test_custom_split_rejects_negative_and_sub_cent_amounts():
    with pytest.raises(SplitError):
        custom_split(100, {"a": "-1", "b": "2.00"})
    with pytest.raises(SplitError):
        custom_split(100, {"a": "0.995", "b": "0.005"})


def test_from_cents_round_trip():
    assert from_cents(to_cents("123.45")) == Decimal("123.45")
