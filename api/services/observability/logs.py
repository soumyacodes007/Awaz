"""Read models for the Logs workspace, including historical-data availability."""

import base64
import csv
import hashlib
import io
import json
import math
from datetime import datetime

from api.schemas.logs import CallLogQuery, CallLogSummary
from api.services.observability.redaction import redact


def fingerprint(query: CallLogQuery) -> str:
    values = query.model_dump(mode="json", exclude={"cursor", "page", "limit"})
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def encode_cursor(query, row, snapshot, max_id):
    value = (
        row["created_at"].isoformat()
        if query.sort_by == "created_at"
        else row["duration_seconds"]
    )
    data = {
        "v": 1,
        "fingerprint": fingerprint(query),
        "id": row["id"],
        "value": value,
        "snapshot": snapshot.isoformat(),
        "max_id": max_id,
    }
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(query):
    if not query.cursor:
        return None
    try:
        data = json.loads(base64.b64decode(query.cursor, altchars=b"-_", validate=True))
        if data["v"] != 1 or data["fingerprint"] != fingerprint(query):
            raise ValueError()
        if (
            any(
                type(data[k]) is not int or not 0 < data[k] <= 2147483647
                for k in ("id", "max_id")
            )
            or data["id"] > data["max_id"]
        ):
            raise ValueError()
        if datetime.fromisoformat(data["snapshot"]).tzinfo is None:
            raise ValueError()
        if query.sort_by == "created_at":
            if datetime.fromisoformat(data["value"]).tzinfo is None:
                raise ValueError()
        elif data["value"] is not None and (
            type(data["value"]) not in (float, int)
            or not math.isfinite(data["value"])
            or data["value"] < 0
        ):
            raise ValueError()
        return data
    except (ValueError, TypeError, KeyError, OverflowError):
        raise ValueError("Invalid cursor or cursor does not match filters") from None


def summary(row):
    return CallLogSummary.model_validate(row)


def page(items, offset, limit, *, available, truncated=False):
    return {
        "items": redact(items[offset : offset + limit]),
        "total_count": len(items),
        "offset": offset,
        "limit": limit,
        "has_more": offset + limit < len(items),
        "available": available,
        "truncated": truncated,
    }


def parse_timestamp(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo else None
    except (AttributeError, TypeError, ValueError):
        return None


def transcript(events, recording_started_at):
    origin = parse_timestamp(recording_started_at)
    result = []
    for index, event in enumerate(events or []):
        if not isinstance(event, dict):
            continue
        payload = event.get("payload") or {}
        kind = event.get("type")
        if kind not in ("rtf-user-transcription", "rtf-bot-text") or (
            kind == "rtf-user-transcription" and not payload.get("final")
        ):
            continue
        start = parse_timestamp(payload.get("timestamp"))
        end = parse_timestamp(payload.get("end_timestamp"))
        offset = (start - origin).total_seconds() if start and origin else None
        end_offset = (end - origin).total_seconds() if end and origin else None
        result.append(
            {
                "event_id": f"rtf:{index}",
                "role": "user" if kind == "rtf-user-transcription" else "assistant",
                "text": payload.get("text", ""),
                "timestamp": start,
                "end_timestamp": end,
                "start_seconds": offset if offset is not None and offset >= 0 else None,
                "end_seconds": end_offset
                if end_offset is not None and end_offset >= 0
                else None,
                "turn": event.get("turn"),
                "node_id": event.get("node_id"),
            }
        )
    return result


def analysis(annotations, completed, *, configured=None, processing=None):
    evaluators = []
    for key, result in (annotations or {}).items():
        if not key.startswith("qa_") or not isinstance(result, dict):
            continue
        evaluators.append(
            {
                "id": key,
                "status": "skipped"
                if result.get("skipped")
                else "failed"
                if result.get("error")
                else "completed",
                "result": redact(result),
            }
        )
    return {
        "status": "available"
        if evaluators
        else "not_configured"
        if configured is False
        else "failed"
        if processing == "failed"
        else "pending"
        if processing in ("pending", "running") or not completed
        else "unavailable",
        "evaluators": evaluators,
    }


def evaluation_outputs(annotations):
    outputs = []
    for key, value in (annotations or {}).items():
        if not key.startswith("qa_") or not isinstance(value, dict):
            continue
        for node_id, result in (value.get("node_results") or {}).items():
            if isinstance(result, dict) and "output" in result:
                outputs.append(
                    {
                        "evaluator_id": key,
                        "node_id": node_id,
                        "output": redact(result["output"]),
                    }
                )
    return outputs


def latency(diagnostics, events):
    measurements = []
    for event in (diagnostics or {}).get("events", []):
        if event.get("event") == "latency_breakdown":
            measurements.append(
                {
                    **(event.get("detail") or {}),
                    "turn": event.get("turn"),
                    "timestamp": event.get("ts"),
                }
            )
    detailed = bool(measurements)
    if not measurements:
        for event in events or []:
            if event.get("type") == "rtf-ttfb-metric":
                payload = event.get("payload") or {}
                value = payload.get("ttfb_seconds")
                if (
                    isinstance(value, (int, float))
                    and math.isfinite(value)
                    and value >= 0
                ):
                    measurements.append(
                        {
                            f"{payload.get('kind', 'llm')}_ttfb_ms": value * 1000,
                            "turn": event.get("turn"),
                        }
                    )
    names = (
        "turn_to_audio_ms",
        "e2e_ms",
        "user_turn_ms",
        "stt_ttfb_ms",
        "llm_ttfb_ms",
        "tts_ttfb_ms",
        "text_aggregation_ms",
        "function_calls_ms",
    )
    averages = {}
    for name in names:
        values = [
            item[name]
            for item in measurements
            if isinstance(item.get(name), (int, float))
            and math.isfinite(item[name])
            and item[name] >= 0
        ]
        averages[name] = sum(values) / len(values) if values else None
    return {
        "available": bool(measurements),
        "detailed_breakdown_available": detailed,
        "averages_ms": averages,
        "turns": redact(measurements[:500]),
        "truncated": bool((diagnostics or {}).get("dropped_events"))
        or len(measurements) > 500,
    }


def cost(row):
    usage = row.get("usage_info") or {}
    billing = row.get("cost_info") or {}
    charge, credits = row.get("charge_usd"), row.get("credits_used")
    components = [
        {"service": key, "usage": redact(usage[key]), "charge_usd": None}
        for key in ("llm", "stt", "tts")
        if key in usage
    ]
    return {
        "status": "available"
        if charge is not None
        else "partial"
        if usage or billing
        else "unavailable",
        "charge_usd": charge,
        "credits_used": credits,
        "duration_seconds": row.get("duration_seconds"),
        "usage": redact(usage),
        "components": components,
        "source": "recorded_billing" if billing else "recorded_usage",
    }


def csv_chunk(values):
    # Neutralize spreadsheet formulas in user-controlled strings.
    safe = [
        "'" + value
        if isinstance(value, str)
        and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r"))
        else value
        for value in values
    ]
    buffer = io.StringIO(newline="")
    csv.writer(buffer).writerow(safe)
    return buffer.getvalue()
