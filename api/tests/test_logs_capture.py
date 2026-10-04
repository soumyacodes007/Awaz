"""Production capture behavior: bounds, redaction, timings, and failure isolation."""

import io
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest
from opentelemetry.sdk.trace import TracerProvider
from pipecat.utils.run_context import set_current_org_id, set_current_run_id

from api.services.observability import api_logs, local_trace
from api.services.observability.logs import (
    csv_chunk,
    evaluation_outputs,
    latency,
    transcript,
)
from api.services.observability.redaction import redact
from api.services.observability.waveform import waveform_metadata
from api.services.pipecat.tracing_config import _OrgAttributeSpanProcessor


def test_sensitive_values_redacted_in_nested_serialized_content():
    value = {
        "accessToken": "secret",
        "input": '{"messages": [{"apiKey": "secret", "content": "hi"}]}',
        "endpoint": "https://user:password@example.com/hook?accessToken=secret&safe=1",
        "error": "Authorization Bearer abcdef",
    }
    result = redact(value)
    assert "secret" not in str(result)
    assert "password" not in result["endpoint"]
    assert "safe=1" in result["endpoint"] and "hi" in result["input"]
    assert "abcdef" not in result["error"]
    assert (
        redact('{"api_key": "secret", "payload": "' + "x" * 70000 + '"}')
        == "[structured payload exceeds display limit]"
    )


def test_precomputed_waveform_signed_pcm_and_bound():
    audio = io.BytesIO()
    with wave.open(audio, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(8000)
        recording.writeframes(
            np.array([-32768, 32767, 0] * 8000, dtype="<i2").tobytes()
        )
    result = waveform_metadata(audio.getvalue())
    assert result["duration_seconds"] == 3
    assert len(result["waveform"]) == 2000
    assert max(result["waveform"]) == 1
    assert all(0 <= value <= 1 for value in result["waveform"])


def test_actual_model_spans_are_captured_without_external_exporter():
    provider = TracerProvider()
    provider.add_span_processor(_OrgAttributeSpanProcessor())
    set_current_org_id(7)
    set_current_run_id(42000)
    try:
        with provider.get_tracer("logs-test").start_as_current_span("llm") as span:
            span.set_attribute(
                "input",
                '{"messages": [{"role": "user", "content": "hello", "api_key": "secret"}]}',
            )
            span.set_attribute("output", "hi")
            span.set_attribute("gen_ai.request.model", "test-model")
        snapshot = local_trace.finish(42000)
        assert snapshot["spans"][0]["attributes"]["output"] == "hi"
        assert "secret" not in str(snapshot)
        assert snapshot["spans"][0]["duration_ms"] >= 0
    finally:
        local_trace.finish(42000)
        set_current_org_id(None)
        set_current_run_id(None)
        provider.shutdown()


def test_trace_capture_and_multi_turn_merge_are_bounded(monkeypatch):
    monkeypatch.setattr(local_trace, "MAX_SPANS", 1)
    local_trace.start(42001)
    span = SimpleNamespace(
        attributes={"dograh.run_id": "42001", "input": "hello"},
        context=SimpleNamespace(span_id=1, trace_id=2),
        parent=None,
        name="llm",
        start_time=1,
        end_time=2,
        status=SimpleNamespace(status_code=SimpleNamespace(name="OK")),
    )
    local_trace.capture(span)
    local_trace.capture(span)
    snapshot = local_trace.finish(42001)
    assert len(snapshot["spans"]) == 1 and snapshot["dropped_spans"] == 1
    merged = local_trace.merge(snapshot, snapshot)
    assert len(merged["spans"]) == 1 and merged["dropped_spans"] == 3


def test_latency_uses_native_details_and_never_fills_missing_measurements():
    result = latency(
        {
            "events": [
                {
                    "event": "latency_breakdown",
                    "turn": 1,
                    "detail": {
                        "llm_ttfb_ms": 200,
                        "tts_ttfb_ms": 20,
                        "turn_to_audio_ms": 300,
                    },
                }
            ],
            "dropped_events": 0,
        },
        [],
    )
    assert result["detailed_breakdown_available"]
    assert result["averages_ms"]["llm_ttfb_ms"] == 200
    assert result["averages_ms"]["stt_ttfb_ms"] is None
    assert not latency(None, [])["available"]


def test_transcript_does_not_invent_recording_origin():
    events = [
        {
            "type": "rtf-bot-text",
            "timestamp": "2026-10-04T10:00:05Z",
            "payload": {"text": "Hello", "timestamp": "2026-10-04T10:00:01Z"},
        }
    ]
    assert transcript(events, None)[0]["start_seconds"] is None
    assert transcript(events, "2026-10-04T10:00:00Z")[0]["start_seconds"] == 1


@pytest.mark.parametrize(
    "value", ["=SUM(A1:A2)", "+CMD()", "-CMD()", "@CMD()", " \t=CMD()"]
)
def test_export_neutralizes_spreadsheet_formulas(value):
    assert csv_chunk([value]).startswith("'")


def test_structured_outputs_preserve_custom_judge_fields():
    result = evaluation_outputs(
        {
            "qa_1": {
                "node_results": {
                    "node_a": {"output": {"custom_score": 42, "compliant": True}}
                }
            }
        }
    )
    assert result[0]["output"] == {"custom_score": 42, "compliant": True}


async def test_api_metadata_writer_is_bounded_and_drains(monkeypatch):
    record = AsyncMock()
    prune = AsyncMock(return_value=0)
    monkeypatch.setattr(api_logs.db_client, "record_api_request", record)
    monkeypatch.setattr(api_logs.db_client, "prune_api_request_logs", prune)
    writer = api_logs.APIRequestLogWriter(max_pending=1)
    writer.start()
    writer.submit({"request_id": "one"})
    writer.submit({"request_id": "two"})
    assert writer.dropped == 1
    await writer.shutdown()
    record.assert_awaited_once_with(request_id="one")


async def test_realtime_capture_is_bounded_and_preserves_existing_events():
    from api.services.pipecat.in_memory_buffers import InMemoryLogsBuffer

    buffer = InMemoryLogsBuffer(workflow_run_id=123)
    buffer.max_events = 1
    await buffer.append({"type": "rtf-bot-text", "payload": {"text": "First"}})
    await buffer.append({"type": "rtf-bot-text", "payload": {"text": "Second"}})
    assert buffer.dropped_events == 1
    assert buffer.get_events()[0]["payload"]["text"] == "First"


async def test_metadata_persistence_failure_does_not_kill_consumer(monkeypatch):
    record = AsyncMock(side_effect=[RuntimeError("db unavailable"), None])
    monkeypatch.setattr(api_logs.db_client, "record_api_request", record)
    monkeypatch.setattr(
        api_logs.db_client, "prune_api_request_logs", AsyncMock(return_value=0)
    )
    writer = api_logs.APIRequestLogWriter()
    writer.start()
    writer.submit({"request_id": "one"})
    writer.submit({"request_id": "two"})
    await writer.shutdown()
    assert record.await_count == 2


async def test_asgi_metadata_middleware_records_only_authenticated_route_metadata(
    monkeypatch,
):
    captured = []
    monkeypatch.setattr(api_logs, "writer", SimpleNamespace(submit=captured.append))

    async def app(scope, receive, send):
        scope["state"]["organization_id"] = 7
        scope["route"] = SimpleNamespace(path="/api/v1/workflow/{workflow_id}")
        await send({"type": "http.response.start", "status": 201, "headers": []})
        await send({"type": "http.response.body", "body": b"okay"})

    sent = []

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "path": "/api/v1/workflow/123",
        "method": "POST",
        "query_string": b"api_key=secret",
        "headers": [(b"authorization", b"secret")],
    }
    await api_logs.APIRequestLogMiddleware(app)(scope, AsyncMock(), send)
    assert captured[0]["path"] == "/api/v1/workflow/{workflow_id}"
    assert captured[0]["status_code"] == 201 and captured[0]["organization_id"] == 7
    assert "secret" not in str(captured)
    assert dict(sent[0]["headers"])[b"x-request-id"]


@pytest.mark.parametrize("failure", [None, "judge", "configuration", "integration"])
async def test_analysis_worker_persists_processing_state(monkeypatch, failure):
    from api.tasks import run_integrations as task

    run = SimpleNamespace(
        workflow=SimpleNamespace(id=3),
        campaign_id=None,
        extra={"analysis_status": "pending"},
        definition=SimpleNamespace(id=4, workflow_json={"nodes": [{"type": "qa"}]}),
    )
    update = AsyncMock()
    monkeypatch.setattr(
        task.db_client,
        "get_workflow_run_with_context",
        AsyncMock(return_value=(run, 7)),
    )
    monkeypatch.setattr(
        task.db_client,
        "get_configuration_value",
        AsyncMock(
            return_value=None,
            side_effect=RuntimeError("configuration failed")
            if failure == "configuration"
            else None,
        ),
    )
    monkeypatch.setattr(
        task.db_client, "ensure_public_access_token", AsyncMock(return_value="public")
    )
    monkeypatch.setattr(task.db_client, "update_workflow_run", update)
    monkeypatch.setattr(
        task,
        "run_completion_handlers",
        AsyncMock(
            return_value={},
            side_effect=RuntimeError("integration failed")
            if failure == "integration"
            else None,
        ),
    )
    monkeypatch.setattr(
        task,
        "_run_qa_nodes",
        AsyncMock(
            side_effect=RuntimeError("judge failed") if failure == "judge" else None,
            return_value={},
        ),
    )
    try:
        if failure:
            with pytest.raises(RuntimeError, match=f"{failure} failed"):
                await task.run_integrations_post_workflow_run({}, 987654)
        else:
            await task.run_integrations_post_workflow_run({}, 987654)
        statuses = [
            call.kwargs["extra"]["analysis_status"] for call in update.await_args_list
        ]
        assert statuses == (
            ["failed"]
            if failure == "configuration"
            else ["running", "failed" if failure == "judge" else "completed"]
        )
    finally:
        local_trace.finish(987654)
        set_current_org_id(None)
        set_current_run_id(None)
