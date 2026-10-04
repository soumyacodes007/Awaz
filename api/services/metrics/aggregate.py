"""Turn per-call rows into the metrics dashboard: totals, time buckets, and
breakdowns. Pure functions over plain dicts, so they're unit-tested without a DB.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from api.services.metrics.pricing import COMPONENTS, estimate_cost

# QA scores are 1–10 (Dograh's reviewer prompt asks for call_quality_score).
PASS_SCORE = 7
FAIL_SCORE = 3
SUCCESS_KEYS = ("pass", "needs_review", "fail", "not_reviewed")
FAILED_REASON_WORDS = (
    "error",
    "fail",
    "busy",
    "no_answer",
    "no-answer",
    "rejected",
    "timeout",
)
UNSUCCESSFUL_LIMIT = 8


def bucket_start(at: datetime, group_by: str, tz: ZoneInfo) -> datetime:
    local = at.astimezone(tz)
    if group_by == "hour":
        return local.replace(minute=0, second=0, microsecond=0)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if group_by == "week":
        day -= timedelta(days=day.weekday())  # Monday
    return day


def bucket_starts(
    start: datetime, end: datetime, group_by: str, tz: ZoneInfo
) -> list[datetime]:
    """Every bucket from start's bucket up to end (exclusive), so empty days show as zero."""
    out, cur = [], bucket_start(start, group_by, tz)
    while cur < end:
        out.append(cur)
        if group_by == "hour":
            cur += timedelta(hours=1)
        else:
            # Step in local calendar days so DST changes don't drift the bucket.
            nxt = (
                cur + timedelta(days=7 if group_by == "week" else 1, hours=12)
            ).replace(hour=0)
            cur = nxt.replace(tzinfo=tz)
    return out


def success_of(score: float | None) -> str:
    if score is None:
        return "not_reviewed"
    if score >= PASS_SCORE:
        return "pass"
    if score <= FAIL_SCORE:
        return "fail"
    return "needs_review"


def unsuccessful_reason(row: dict, now: datetime) -> str | None:
    """Why a call counts as unsuccessful, or None. Calls still in their first
    hour may simply be live, so only older unfinished calls count."""
    reason = (row.get("ended_reason") or "").lower()
    if any(word in reason for word in FAILED_REASON_WORDS):
        return row["ended_reason"]
    score = row.get("qa_score")
    if score is not None and score <= FAIL_SCORE:
        return f"Low QA score ({score:g}/10)"
    if not row.get("is_completed") and now - row["created_at"] > timedelta(hours=1):
        return "Never completed"
    return None


def _peaks(
    rows: list[dict], starts: list[datetime], group_by: str, tz: ZoneInfo
) -> list[int]:
    """Most calls running at once within each bucket (sweep over start/end events)."""
    events: list[tuple[datetime, int]] = []
    for r in rows:
        begin = r["created_at"]
        seconds = r.get("duration_seconds") or 0
        events.append((begin, 1))
        events.append((begin + timedelta(seconds=max(seconds, 1)), -1))
    events.sort(key=lambda e: (e[0], e[1]))  # ends before starts at the same instant

    index = {s: i for i, s in enumerate(starts)}
    peaks = [0] * len(starts)
    running = 0
    boundary = 0
    for at, delta in events:
        # Calls still running when a bucket opens count toward that bucket.
        while boundary < len(starts) and starts[boundary] <= at:
            peaks[boundary] = max(peaks[boundary], running)
            boundary += 1
        running += delta
        if delta > 0:
            i = index.get(bucket_start(at, group_by, tz))
            if i is not None:
                peaks[i] = max(peaks[i], running)
    return peaks


def _round(value: float, digits: int = 4) -> float:
    return round(value, digits)


def aggregate(
    rows: list[dict],
    *,
    start: datetime,
    end: datetime,
    group_by: str,
    timezone: str,
    now: datetime,
    truncated: bool = False,
) -> dict:
    tz = ZoneInfo(timezone)
    starts = bucket_starts(start, end, group_by, tz)
    index = {s: i for i, s in enumerate(starts)}

    blank = lambda: {  # noqa: E731
        "calls": 0,
        "seconds": 0.0,
        "spend": 0.0,
        "components": dict.fromkeys(COMPONENTS, 0.0),
        "reasons": Counter(),
        "success": dict.fromkeys(SUCCESS_KEYS, 0),
        "agent_seconds": defaultdict(lambda: [0.0, 0]),
    }
    buckets = [blank() for _ in starts]
    agents: dict[int, dict] = {}
    estimated = False
    unsuccessful = []

    for r in rows:
        i = index.get(bucket_start(r["created_at"], group_by, tz))
        seconds = float(r.get("duration_seconds") or 0)
        parts = estimate_cost(r.get("mode"), r.get("usage_info"))
        charge = r.get("charge_usd")
        if charge is None:
            estimated = True
            charge = sum(parts.values())
        outcome = success_of(r.get("qa_score"))

        agent = agents.setdefault(
            r["workflow_id"],
            {
                "workflow_id": r["workflow_id"],
                "name": r["workflow_name"],
                "calls": 0,
                "seconds": 0.0,
                "spend": 0.0,
            },
        )
        agent["calls"] += 1
        agent["seconds"] += seconds
        agent["spend"] += charge

        if i is not None:
            b = buckets[i]
            b["calls"] += 1
            b["seconds"] += seconds
            b["spend"] += charge
            for k, v in parts.items():
                b["components"][k] += v
            b["reasons"][r.get("ended_reason") or "unknown"] += 1
            b["success"][outcome] += 1
            acc = b["agent_seconds"][str(r["workflow_id"])]
            acc[0] += seconds
            acc[1] += 1

        reason = unsuccessful_reason(r, now)
        if reason:
            unsuccessful.append(
                {
                    "id": r["id"],
                    "workflow_id": r["workflow_id"],
                    "workflow_name": r["workflow_name"],
                    "created_at": r["created_at"],
                    "reason": reason,
                    "duration_seconds": r.get("duration_seconds"),
                    "qa_score": r.get("qa_score"),
                }
            )

    peaks = _peaks(rows, starts, group_by, tz)
    calls = sum(b["calls"] for b in buckets)
    seconds = sum(b["seconds"] for b in buckets)
    spend = sum(b["spend"] for b in buckets)
    reasons = sum((b["reasons"] for b in buckets), Counter())
    success = {k: sum(b["success"][k] for b in buckets) for k in SUCCESS_KEYS}
    reviewed = calls - success["not_reviewed"]

    return {
        "start_at": start,
        "end_at": end,
        "group_by": group_by,
        "timezone": timezone,
        "truncated": truncated,
        "totals": {
            "calls": calls,
            "minutes": _round(seconds / 60, 2),
            "spend_usd": _round(spend),
            "avg_cost_usd": _round(spend / calls) if calls else None,
            "avg_duration_seconds": _round(seconds / calls, 1) if calls else None,
            "reviewed_calls": reviewed,
            "success_rate": _round(success["pass"] / reviewed, 3) if reviewed else None,
            "peak_concurrency": max(peaks, default=0),
            "cost_estimated": estimated,
        },
        "buckets": [
            {
                "start": s,
                "calls": b["calls"],
                "minutes": _round(b["seconds"] / 60, 2),
                "spend_usd": _round(b["spend"]),
                "avg_cost_usd": _round(b["spend"] / b["calls"]) if b["calls"] else None,
                "avg_duration_seconds": _round(b["seconds"] / b["calls"], 1)
                if b["calls"]
                else None,
                "peak_concurrency": peaks[i],
                "cost_by_component": {k: _round(v) for k, v in b["components"].items()},
                "ended_reasons": dict(b["reasons"]),
                "success": b["success"],
                "avg_duration_by_agent": {
                    k: _round(v[0] / v[1], 1) for k, v in b["agent_seconds"].items()
                },
            }
            for i, (s, b) in enumerate(zip(starts, buckets))
        ],
        "agents": sorted(
            (
                {
                    "workflow_id": a["workflow_id"],
                    "name": a["name"],
                    "calls": a["calls"],
                    "minutes": _round(a["seconds"] / 60, 2),
                    "avg_duration_seconds": _round(a["seconds"] / a["calls"], 1),
                    "spend_usd": _round(a["spend"]),
                }
                for a in agents.values()
            ),
            key=lambda a: -a["calls"],
        ),
        "ended_reasons": [{"key": k, "count": v} for k, v in reasons.most_common()],
        "cost_breakdown": {
            k: _round(sum(b["components"][k] for b in buckets)) for k in COMPONENTS
        },
        "success": success,
        "unsuccessful_calls": sorted(
            unsuccessful, key=lambda u: u["created_at"], reverse=True
        )[:UNSUCCESSFUL_LIMIT],
    }
