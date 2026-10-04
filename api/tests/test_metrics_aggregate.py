from datetime import UTC, datetime, timedelta

from api.services.metrics.aggregate import aggregate, bucket_starts, success_of
from api.services.metrics.pricing import estimate_cost

T0 = datetime(2026, 10, 1, 4, 0, tzinfo=UTC)  # 09:30 in Asia/Kolkata


def row(i, at, seconds=60, **kw):
    return {
        "id": i,
        "workflow_id": kw.pop("workflow_id", 1),
        "workflow_name": kw.pop("workflow_name", "Clinic"),
        "created_at": at,
        "mode": kw.pop("mode", "smallwebrtc"),
        "state": "completed",
        "is_completed": kw.pop("is_completed", True),
        "ended_reason": kw.pop("ended_reason", "user_hangup"),
        "duration_seconds": seconds,
        "charge_usd": kw.pop("charge_usd", None),
        "usage_info": kw.pop("usage_info", {"call_duration_seconds": seconds}),
        "qa_score": kw.pop("qa_score", None),
    }


def run(rows, days=3, group_by="day", tz="Asia/Kolkata"):
    return aggregate(
        rows,
        start=T0 - timedelta(days=1),
        end=T0 + timedelta(days=days - 1),
        group_by=group_by,
        timezone=tz,
        now=T0 + timedelta(days=days),
    )


def test_llm_cost_uses_model_prices_and_text_chats_skip_voice_costs():
    usage = {
        "llm": {
            "OpenRouterLLMService#1|||openai/gpt-4.1-mini": {
                "prompt_tokens": 1_000_000,
                "completion_tokens": 0,
            }
        },
        "call_duration_seconds": 60,
    }
    chat = estimate_cost("textchat", usage)
    assert chat == {"llm": 0.4, "stt": 0.0, "tts": 0.0, "telephony": 0.0}
    phone = estimate_cost(
        "twilio", {**usage, "tts": {"SarvamTTSService#2|||bulbul:v2": 900}}
    )
    assert phone["tts"] == 0.01 and phone["telephony"] == 0.01 and phone["stt"] == 0.006


def test_day_buckets_follow_the_timezone_and_include_empty_days():
    starts = bucket_starts(
        T0 - timedelta(days=1),
        T0 + timedelta(days=2),
        "day",
        __import__("zoneinfo").ZoneInfo("Asia/Kolkata"),
    )
    assert [s.strftime("%Y-%m-%d %H:%M %z") for s in starts] == [
        "2026-09-30 00:00 +0530",
        "2026-10-01 00:00 +0530",
        "2026-10-02 00:00 +0530",
        "2026-10-03 00:00 +0530",  # the range ends at 09:30 that day
    ]


def test_totals_buckets_and_recorded_charge_wins_over_estimate():
    out = run([row(1, T0, 120, charge_usd=0.5), row(2, T0 + timedelta(hours=1), 60)])
    t = out["totals"]
    assert t["calls"] == 2 and t["minutes"] == 3.0
    assert t["cost_estimated"] is True  # call 2 had no recorded charge
    day = out["buckets"][1]
    assert day["calls"] == 2 and day["avg_duration_seconds"] == 90.0
    assert out["buckets"][0]["calls"] == 0


def test_success_buckets_from_qa_scores():
    assert [success_of(s) for s in (None, 9, 5, 2)] == [
        "not_reviewed",
        "pass",
        "needs_review",
        "fail",
    ]
    out = run([row(1, T0, qa_score=8), row(2, T0, qa_score=2), row(3, T0)])
    assert out["success"] == {
        "pass": 1,
        "needs_review": 0,
        "fail": 1,
        "not_reviewed": 1,
    }
    assert out["totals"]["success_rate"] == 0.5


def test_peak_concurrency_counts_overlapping_calls():
    out = run(
        [
            row(1, T0, 600),
            row(2, T0 + timedelta(minutes=5), 60),
            row(3, T0 + timedelta(minutes=20), 60),
        ]
    )
    assert out["totals"]["peak_concurrency"] == 2


def test_call_running_across_midnight_counts_in_the_next_bucket():
    late = datetime(2026, 9, 30, 18, 25, tzinfo=UTC)  # 23:55 IST
    out = run([row(1, late, 900)])
    assert [b["peak_concurrency"] for b in out["buckets"]] == [1, 1, 0, 0]


def test_unsuccessful_calls_cover_errors_low_scores_and_stale_unfinished_calls():
    out = run(
        [
            row(1, T0, ended_reason="pipeline_error"),
            row(2, T0, qa_score=2),
            row(3, T0, is_completed=False, ended_reason=None),
            row(4, T0),
        ]
    )
    reasons = {u["id"]: u["reason"] for u in out["unsuccessful_calls"]}
    assert reasons == {
        1: "pipeline_error",
        2: "Low QA score (2/10)",
        3: "Never completed",
    }


def test_agents_and_per_bucket_average_duration():
    out = run(
        [
            row(1, T0, 60),
            row(2, T0, 120, workflow_id=2, workflow_name="Sales"),
            row(3, T0, 180, workflow_id=2, workflow_name="Sales"),
        ]
    )
    assert [a["name"] for a in out["agents"]] == ["Sales", "Clinic"]
    assert out["buckets"][1]["avg_duration_by_agent"] == {"1": 60.0, "2": 150.0}
