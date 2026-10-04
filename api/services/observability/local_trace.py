"""Bounded process-local capture of model spans for authenticated call logs."""

import json
import threading
import time

from api.services.observability.redaction import redact

_lock = threading.Lock()
_runs: dict[str, dict] = {}
MAX_SPANS = 1000
MAX_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024


def start(run_id):
    now = time.monotonic()
    with _lock:
        for key in [
            key for key, value in _runs.items() if now - value["started"] > 7200
        ]:
            _runs.pop(key, None)
        key = str(run_id)
        if key not in _runs and len(_runs) < 1000:
            _runs[key] = {"started": now, "spans": [], "size": 0, "dropped_spans": 0}


def capture(span):
    attributes = dict(span.attributes or {})
    run_id = attributes.get("dograh.run_id")
    if run_id is None:
        return
    # Retain model/tool spans; exclude infrastructure spans with no message data.
    allowed = {
        key: value
        for key, value in attributes.items()
        if key.startswith(("gen_ai.", "llm.", "tool."))
        or key in ("input", "output", "model", "service.name")
    }
    if not allowed:
        return
    context = span.context
    item = redact(
        {
            "name": span.name,
            "span_id": f"{context.span_id:016x}",
            "trace_id": f"{context.trace_id:032x}",
            "parent_span_id": f"{span.parent.span_id:016x}" if span.parent else None,
            "started_at_ns": span.start_time,
            "ended_at_ns": span.end_time,
            "duration_ms": (span.end_time - span.start_time) / 1e6
            if span.end_time and span.start_time
            else None,
            "attributes": allowed,
            "status": span.status.status_code.name,
        }
    )
    size = len(json.dumps(item, default=str).encode())
    with _lock:
        buffer = _runs.get(str(run_id))
        if buffer is None:
            return
        if (
            len(buffer["spans"]) >= MAX_SPANS
            or buffer["size"] + size > MAX_BYTES
            or sum(item["size"] for item in _runs.values()) + size > MAX_TOTAL_BYTES
        ):
            buffer["dropped_spans"] += 1
        else:
            buffer["spans"].append(item)
            buffer["size"] += size


def finish(run_id):
    with _lock:
        buffer = _runs.pop(str(run_id), None)
    if buffer is None:
        return None
    return {
        "spans": sorted(buffer["spans"], key=lambda span: span["started_at_ns"] or 0),
        "dropped_spans": buffer["dropped_spans"],
    }


def merge(previous, current):
    """Keep the most recent spans within the same per-call disk budget."""
    candidates = [*(previous or {}).get("spans", []), *(current or {}).get("spans", [])]
    kept = []
    size = 0
    for item in reversed(candidates):
        item_size = len(json.dumps(item, default=str).encode())
        if len(kept) >= MAX_SPANS or size + item_size > MAX_BYTES:
            break
        kept.append(item)
        size += item_size
    return {
        "spans": list(reversed(kept)),
        "dropped_spans": (previous or {}).get("dropped_spans", 0)
        + (current or {}).get("dropped_spans", 0)
        + len(candidates)
        - len(kept),
    }
