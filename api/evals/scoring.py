"""Pure scoring functions (no I/O)."""

from decimal import Decimal, InvalidOperation


def _norm(value):
    if isinstance(value, bool) or value is None:
        return value
    try:
        return round(float(Decimal(str(value))), 2)
    except (InvalidOperation, ValueError):
        return str(value).strip().lower()


def args_match(expected: dict, actual: dict) -> tuple[bool, list[str]]:
    """Subset match: numbers equal, strings contained (case-insensitive), lists contain every expected item."""
    problems = []
    for key, want in expected.items():
        got = actual.get(key)
        if isinstance(want, list):
            got_items = [str(g).lower() for g in (got or [])]
            for w in want:
                if not any(str(w).lower() in g for g in got_items):
                    problems.append(f"{key}: expected {w!r} in {got!r}")
        elif isinstance(want, int | float):
            if _norm(got) != _norm(want):
                problems.append(f"{key}: expected {want}, got {got!r}")
        elif str(want).lower() not in str(got or "").lower():
            problems.append(f"{key}: expected {want!r}, got {got!r}")
    return not problems, problems


def score_agent_case(case: dict, result: dict) -> dict:
    """Score one chat turn against the case's expectations."""
    expect = case.get("expect", {})
    checks: dict[str, bool] = {}
    notes: list[str] = []
    if result.get("type") == "error":
        return {"pass": False, "checks": {"no_error": False}, "notes": [result.get("message", "error")]}

    tools = result.get("tools", [])
    called = [t["name"] for t in tools]
    proposal = result.get("confirmation")
    reply = (result.get("message") or "").lower()

    if "tools_any" in expect:
        checks["tool_selection"] = any(t in called for t in expect["tools_any"])
    if "tools_none" in expect:
        checks["forbidden_tools"] = not any(t in called for t in expect["tools_none"])
    if "proposal" in expect:
        checks["proposal"] = bool(proposal) and proposal.get("tool") == expect["proposal"]
        if "args" in expect:
            call_args = next((t.get("args", {}) for t in reversed(tools) if t["name"] == expect["proposal"]), {})
            ok, problems = args_match(expect["args"], call_args)
            checks["arguments"] = ok and checks["proposal"]
            notes += problems
    if expect.get("clarify"):
        checks["clarification"] = proposal is None and "?" in reply
    if expect.get("no_write"):
        checks["no_write"] = proposal is None
    if "contains_any" in expect:
        checks["content"] = any(s.lower() in reply for s in expect["contains_any"])
    if "not_contains" in expect:
        leaked = [s for s in expect["not_contains"] if s.lower() in reply]
        checks["no_leak"] = not leaked
        notes += [f"leaked {s!r}" for s in leaked]

    return {"pass": all(checks.values()) if checks else True, "checks": checks, "notes": notes, "tools": called}


def rows_equal(a: list[list], b: list[list]) -> bool:
    """Order-insensitive result-set comparison with 2-dp numeric normalisation; ignores column names."""

    def canon(rows):
        return sorted(tuple(sorted(str(_norm(v)) for v in row)) for row in rows)

    return canon(a) == canon(b)


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)
