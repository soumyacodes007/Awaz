"""Organization-scoped APIs for the Logs table and call detail drawer."""

import asyncio
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import RedirectResponse, StreamingResponse
from loguru import logger

from api.db import db_client
from api.db.models import UserModel
from api.schemas.logs import (
    AnalysisResponse,
    APIRequestLogDetail,
    APIRequestLogPage,
    ArtifactURLResponse,
    CallFeedbackRequest,
    CallLogDetail,
    CallLogPage,
    CallLogQuery,
    CostResponse,
    EventPage,
    FeedbackItem,
    FeedbackPage,
    LatencyResponse,
    OperationalLogQuery,
    SessionLogPage,
    SessionLogSummary,
    StructuredOutputsResponse,
    TranscriptPage,
    WaveformResponse,
    WebhookLogDetail,
    WebhookLogPage,
    WorkflowLogOptions,
)
from api.services.auth.depends import get_user_with_selected_organization
from api.services.observability import logs as views
from api.services.observability.redaction import redact
from api.services.storage import get_storage_for_backend


async def private_response(response: Response):
    response.headers["Cache-Control"] = "private, no-store"


router = APIRouter(
    prefix="/logs", tags=["logs"], dependencies=[Depends(private_response)]
)
User = Annotated[UserModel, Depends(get_user_with_selected_organization)]
RunID = Annotated[int, Path(gt=0, le=2147483647)]
Filters = Annotated[CallLogQuery, Query()]
OperationalFilters = Annotated[OperationalLogQuery, Query()]
Offset = Annotated[int, Query(ge=0, le=20000)]
Limit = Annotated[int, Query(ge=1, le=500)]


async def _run(run_id, user):
    row = await db_client.get_call_log(run_id, user.selected_organization_id)
    if row is None:
        raise HTTPException(404, "Call not found")
    return row


async def _payload(run_id, user, section):
    found, payload = await db_client.get_call_log_payload(
        run_id, user.selected_organization_id, section
    )
    if not found:
        raise HTTPException(404, "Call not found")
    return payload


async def _calls(query, user):
    try:
        cursor = views.decode_cursor(query)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    rows, total, more, snapshot, max_id = await db_client.list_call_logs(
        user.selected_organization_id, query, cursor
    )
    return {
        "items": [views.summary(row) for row in rows],
        "total_count": total,
        "page": query.page,
        "limit": query.limit,
        "total_pages": (total + query.limit - 1) // query.limit,
        "has_more": more,
        "next_cursor": views.encode_cursor(query, rows[-1], snapshot, max_id)
        if more and rows
        else None,
        "snapshot_at": snapshot,
    }


@router.get("/calls", response_model=CallLogPage)
async def list_calls(query: Filters, user: User):
    return await _calls(query, user)


@router.get("/chats", response_model=CallLogPage)
async def list_chats(query: Filters, user: User):
    if query.channels and query.channels != ["chat"]:
        raise HTTPException(422, "The chats tab supports only the chat channel")
    return await _calls(query.model_copy(update={"channels": ["chat"]}), user)


@router.get(
    "/calls/export",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "CSV download",
            "content": {"text/csv": {"schema": {"type": "string"}}},
        }
    },
)
async def export_calls(query: Filters, user: User):
    if query.cursor or query.page != 1:
        raise HTTPException(422, "Export accepts filters, without pagination")
    checked = query.model_copy(update={"limit": 1})
    _, total, _, snapshot, max_id = await db_client.list_call_logs(
        user.selected_organization_id, checked
    )
    if total > 100000:
        raise HTTPException(
            422, "Export is limited to 100000 calls; narrow the time range"
        )
    fields = list(views.CallLogSummary.model_fields)

    async def stream():
        yield views.csv_chunk(fields)
        async for row in db_client.iter_call_export(
            user.selected_organization_id, query, snapshot=snapshot, max_id=max_id
        ):
            yield views.csv_chunk([row.get(field) for field in fields])

    return StreamingResponse(
        stream(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="call-logs.csv"',
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/workflows", response_model=WorkflowLogOptions)
async def workflow_options(
    user: User,
    search: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    return {
        "items": await db_client.log_workflow_options(
            user.selected_organization_id, search, limit
        )
    }


@router.get("/calls/{run_id}", response_model=CallLogDetail)
async def call_detail(run_id: RunID, user: User):
    row = await _run(run_id, user)
    extra = row.get("extra") or {}
    artifacts = {}
    for track, metadata in (extra.get("recordings") or {}).items():
        if track in ("mixed", "user", "bot") and metadata.get("storage_key"):
            artifacts[track] = {
                "download_path": f"/api/v1/logs/calls/{run_id}/artifacts/{track}",
                "waveform_available": bool(metadata.get("waveform")),
                "duration_seconds": metadata.get("duration_seconds"),
            }
    if row.get("recording_url") and "mixed" not in artifacts:
        artifacts["mixed"] = {
            "download_path": f"/api/v1/logs/calls/{run_id}/artifacts/mixed",
            "waveform_available": False,
        }
    if row.get("transcript_url"):
        artifacts["transcript"] = {
            "download_path": f"/api/v1/logs/calls/{run_id}/artifacts/transcript"
        }
    origin = views.parse_timestamp(extra.get("recording_started_at"))
    return {
        "call": views.summary(row),
        "recording_started_at": origin,
        "timing_available": origin is not None,
        "artifacts": artifacts,
        "initial_context": redact(row.get("initial_context") or {}),
        "gathered_context": redact(row.get("gathered_context") or {}),
        "trace_url": redact((row.get("gathered_context") or {}).get("trace_url")),
        "availability": {
            "recording": bool(artifacts.keys() & {"mixed", "user", "bot"}),
            "transcript_download": bool(row.get("transcript_url")),
            "transcript_events": bool(row.get("events_available")),
            "diagnostics": bool(row.get("diagnostics_available")),
            "messages": bool(row.get("messages_available")),
        },
    }


@router.get("/calls/{run_id}/transcript", response_model=TranscriptPage)
async def call_transcript(
    run_id: RunID, user: User, offset: Offset = 0, limit: Limit = 100
):
    row = await _run(run_id, user)
    events = await _payload(run_id, user, "events")
    items = views.transcript(
        events, (row.get("extra") or {}).get("recording_started_at")
    )
    metadata = await _payload(run_id, user, "event_meta")
    return views.page(
        items,
        offset,
        limit,
        available=bool(items),
        truncated=bool((metadata or {}).get("dropped_events")),
    )


@router.get("/calls/{run_id}/events", response_model=EventPage)
async def call_events(
    run_id: RunID,
    user: User,
    offset: Offset = 0,
    limit: Limit = 100,
    source: Literal["realtime", "diagnostics"] = "realtime",
):
    payload = await _payload(
        run_id, user, "events" if source == "realtime" else "diagnostics"
    )
    items = (
        (payload or []) if source == "realtime" else (payload or {}).get("events", [])
    )
    metadata = (
        await _payload(run_id, user, "event_meta") if source == "realtime" else payload
    )
    return views.page(
        items,
        offset,
        limit,
        available=payload is not None,
        truncated=bool((metadata or {}).get("dropped_events")),
    )


@router.get("/calls/{run_id}/messages", response_model=EventPage)
async def call_messages(
    run_id: RunID, user: User, offset: Offset = 0, limit: Limit = 100
):
    payload = await _payload(run_id, user, "trace")
    return views.page(
        (payload or {}).get("spans", []),
        offset,
        limit,
        available=payload is not None,
        truncated=bool((payload or {}).get("dropped_spans")),
    )


@router.get("/calls/{run_id}/analysis", response_model=AnalysisResponse)
async def call_analysis(run_id: RunID, user: User):
    row = await _run(run_id, user)
    return views.analysis(
        await _payload(run_id, user, "analysis"),
        row["is_completed"],
        configured=row["analysis_configured"],
        processing=(row.get("extra") or {}).get("analysis_status"),
    )


@router.get(
    "/calls/{run_id}/structured-outputs", response_model=StructuredOutputsResponse
)
async def call_outputs(run_id: RunID, user: User):
    row = await _run(run_id, user)
    annotations = await _payload(run_id, user, "analysis")
    evaluations = views.evaluation_outputs(annotations)
    return {
        "extracted_variables": redact(row.get("gathered_context") or {}),
        "evaluations": evaluations,
    }


@router.get("/calls/{run_id}/cost", response_model=CostResponse)
async def call_cost(run_id: RunID, user: User):
    return views.cost(await _run(run_id, user))


@router.get("/calls/{run_id}/latency", response_model=LatencyResponse)
async def call_latency(run_id: RunID, user: User):
    diagnostics = await _payload(run_id, user, "diagnostics")
    events = await _payload(run_id, user, "events")
    return views.latency(diagnostics, events)


@router.get("/calls/{run_id}/waveform/{track}", response_model=WaveformResponse)
async def waveform(run_id: RunID, track: Literal["mixed", "user", "bot"], user: User):
    row = await _run(run_id, user)
    metadata = ((row.get("extra") or {}).get("recordings") or {}).get(track) or {}
    return {
        "available": bool(metadata.get("waveform")),
        "peaks": metadata.get("waveform", []),
        "duration_seconds": metadata.get("duration_seconds"),
        "sample_rate": metadata.get("sample_rate"),
        "channels": metadata.get("channels"),
    }


async def _artifact_url(run_id, track, user):
    row = await _run(run_id, user)
    metadata = ((row.get("extra") or {}).get("recordings") or {}).get(track) or {}
    key = metadata.get("storage_key") or (
        row.get("transcript_url")
        if track == "transcript"
        else row.get("recording_url")
        if track == "mixed"
        else None
    )
    if not key:
        raise HTTPException(404, "Artifact not recorded")
    try:
        async with asyncio.timeout(10):
            storage = get_storage_for_backend(
                metadata.get("storage_backend") or row.get("storage_backend")
            )
            url = await storage.aget_signed_url(
                key, expiration=300, force_inline=track != "transcript"
            )
        if not url:
            raise ValueError("No URL")
    except Exception as exc:
        logger.warning("Log artifact URL unavailable ({})", type(exc).__name__)
        raise HTTPException(503, "Artifact storage temporarily unavailable") from None
    return url


@router.get(
    "/calls/{run_id}/artifacts/{track}/url",
    response_model=ArtifactURLResponse,
    responses={503: {"description": "Artifact storage temporarily unavailable"}},
)
async def artifact_url(
    run_id: RunID, track: Literal["mixed", "user", "bot", "transcript"], user: User
):
    return {"url": await _artifact_url(run_id, track, user), "expires_in_seconds": 300}


@router.get(
    "/calls/{run_id}/artifacts/{track}",
    response_class=RedirectResponse,
    status_code=307,
    responses={503: {"description": "Artifact storage temporarily unavailable"}},
)
async def artifact(
    run_id: RunID, track: Literal["mixed", "user", "bot", "transcript"], user: User
):
    return RedirectResponse(
        await _artifact_url(run_id, track, user),
        status_code=307,
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/calls/{run_id}/feedback", response_model=FeedbackPage)
async def get_feedback(run_id: RunID, user: User):
    await _run(run_id, user)
    return {
        "items": await db_client.list_call_feedback(
            run_id, user.selected_organization_id
        )
    }


@router.put("/calls/{run_id}/feedback", response_model=FeedbackItem)
async def put_feedback(run_id: RunID, feedback: CallFeedbackRequest, user: User):
    if feedback.event_id != "call":
        row = await _run(run_id, user)
        if not row["is_completed"]:
            raise HTTPException(
                422, "Message feedback is available after the call completes"
            )
        events = await _payload(run_id, user, "events")
        index = int(feedback.event_id.split(":")[1])
        event = events[index] if index < len(events or []) else None
        if (
            not isinstance(event, dict)
            or (event.get("type") not in ("rtf-user-transcription", "rtf-bot-text"))
            or (
                event.get("type") == "rtf-user-transcription"
                and not (event.get("payload") or {}).get("final")
            )
        ):
            raise HTTPException(422, "Feedback event is not a transcript message")
    result = await db_client.save_call_feedback(
        run_id, user.selected_organization_id, user.id, feedback
    )
    if result is None:
        raise HTTPException(404, "Call not found")
    return result


async def _operational(kind, query, user):
    if kind == "api":
        if query.run_id or (
            query.status
            and (
                not query.status.isascii()
                or not query.status.isdigit()
                or not 100 <= int(query.status) <= 599
            )
        ):
            raise HTTPException(
                422, "API logs accept HTTP status 100–599, without run_id"
            )
    elif query.status:
        allowed = (
            {"pending", "succeeded", "dead_letter"}
            if kind == "webhooks"
            else {"initialized", "running", "completed"}
        )
        if query.status not in allowed:
            raise HTTPException(422, "Unsupported status")
    method = getattr(
        db_client,
        {
            "sessions": "list_log_sessions",
            "webhooks": "list_log_webhooks",
            "api": "list_log_api_requests",
        }[kind],
    )
    items, total = await method(user.selected_organization_id, query)
    return {
        "items": redact(items),
        "total_count": total,
        "page": query.page,
        "limit": query.limit,
        "total_pages": (total + query.limit - 1) // query.limit,
    }


@router.get("/sessions", response_model=SessionLogPage)
async def sessions(query: OperationalFilters, user: User):
    return await _operational("sessions", query, user)


@router.get("/sessions/{run_id}", response_model=SessionLogSummary)
async def session_detail(run_id: RunID, user: User):
    row = await db_client.get_log_session(run_id, user.selected_organization_id)
    if row is None:
        raise HTTPException(404, "Session not found")
    return row


@router.get("/webhooks", response_model=WebhookLogPage)
async def webhooks(query: OperationalFilters, user: User):
    return await _operational("webhooks", query, user)


@router.get("/webhooks/{delivery_id}", response_model=WebhookLogDetail)
async def webhook(delivery_id: Annotated[int, Path(gt=0, le=2147483647)], user: User):
    row = await db_client.get_log_webhook(delivery_id, user.selected_organization_id)
    if row is None:
        raise HTTPException(404, "Webhook not found")
    return redact(row)


@router.get("/api", response_model=APIRequestLogPage)
async def api_logs(query: OperationalFilters, user: User):
    return await _operational("api", query, user)


@router.get("/api/{log_id}", response_model=APIRequestLogDetail)
async def api_log(log_id: Annotated[int, Path(gt=0, le=2147483647)], user: User):
    row = await db_client.get_log_api_request(log_id, user.selected_organization_id)
    if row is None:
        raise HTTPException(404, "API request not found")
    return redact(row)
