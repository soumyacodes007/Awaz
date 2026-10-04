"""Logs contracts against PostgreSQL, including cross-organization requests."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.db.models import (
    APIRequestLogModel,
    OrganizationModel,
    UserModel,
    WebhookDeliveryModel,
    WorkflowDefinitionModel,
    WorkflowModel,
    WorkflowRunModel,
    WorkflowRunTextSessionModel,
)
from api.routes.logs import router
from api.services.auth.depends import get_user_with_selected_organization


@pytest.fixture
async def logs_data(async_session, db_session):
    orgs = [OrganizationModel(provider_id=f"logs-org-{index}") for index in range(2)]
    async_session.add_all(orgs)
    await async_session.flush()
    users = [
        UserModel(provider_id=f"logs-user-{index}", selected_organization_id=org.id)
        for index, org in enumerate(orgs)
    ]
    async_session.add_all(users)
    await async_session.flush()
    workflows = [
        WorkflowModel(name=f"Agent {index}", organization_id=org.id, user_id=user.id)
        for index, (org, user) in enumerate(zip(orgs, users, strict=True))
    ]
    async_session.add_all(workflows)
    await async_session.flush()
    definitions = [
        WorkflowDefinitionModel(
            workflow_id=w.id, version_number=2, status="published", workflow_json={}
        )
        for w in workflows
    ]
    async_session.add_all(definitions)
    await async_session.flush()
    now = datetime.now(UTC) - timedelta(minutes=1)
    events = [
        {
            "type": "rtf-user-transcription",
            "payload": {
                "text": "Hello",
                "final": True,
                "timestamp": now.isoformat(),
                "end_timestamp": (now + timedelta(seconds=1)).isoformat(),
            },
        },
        {
            "type": "rtf-bot-text",
            "payload": {
                "text": "Hi",
                "timestamp": (now + timedelta(seconds=2)).isoformat(),
            },
        },
        {"type": "rtf-ttfb-metric", "payload": {"kind": "llm", "ttfb_seconds": 0.2}},
    ]
    runs = []
    for index in range(6):
        owner = 1 if index == 5 else 0
        run = WorkflowRunModel(
            name="call",
            workflow_id=workflows[owner].id,
            definition_id=definitions[owner].id,
            mode="textchat" if index == 4 else "smallwebrtc",
            call_type="inbound",
            state="completed",
            is_completed=True,
            created_at=now,
            usage_info={"call_duration_seconds": index + 1, "llm": {"tokens": 10}},
            cost_info={"charge_usd": 0.02, "dograh_token_usage": 2}
            if index == 0
            else {},
            initial_context={
                "caller_number": "+12025550101",
                "called_number": "+12025550202",
                "api_key": "secret",
            },
            gathered_context={
                "call_id": f"provider-{index}",
                "call_status": "customer_ended",
                "answer": "yes",
            },
            logs={
                "realtime_feedback_events": events,
                "local_trace": {
                    "spans": [
                        {
                            "name": "llm",
                            "attributes": {"input": "hello", "api_key": "hidden"},
                        }
                    ]
                },
            },
            annotations={
                "qa_judge": {
                    "node_results": {
                        "whole_call": {"score": 9, "output": {"custom_score": 42}}
                    }
                }
            },
            extra={
                "recording_started_at": (now - timedelta(seconds=1)).isoformat(),
                "recordings": {
                    "mixed": {
                        "storage_key": f"recordings/{index}.wav",
                        "storage_backend": "minio",
                        "waveform": [0, 0.5],
                        "duration_seconds": 10,
                        "sample_rate": 16000,
                        "channels": 1,
                    }
                },
            },
            recording_url=f"recordings/{index}.wav",
        )
        runs.append(run)
    async_session.add_all(runs)
    await async_session.flush()
    async_session.add_all(
        [
            WorkflowRunTextSessionModel(workflow_run_id=runs[4].id, revision=2),
            WorkflowRunTextSessionModel(workflow_run_id=runs[5].id, revision=1),
        ]
    )
    webhooks = [
        WebhookDeliveryModel(
            organization_id=orgs[owner].id,
            workflow_run_id=runs[0 if owner == 0 else 5].id,
            webhook_name="complete",
            webhook_node_id="node",
            endpoint_url="https://example.com/hook?token=hidden",
            http_method="POST",
            payload={"authorization": "secret", "answer": "yes"},
            status="pending",
            scheduled_for=now,
        )
        for owner in (0, 1)
    ]
    requests = [
        APIRequestLogModel(
            organization_id=org.id,
            request_id=f"request-{index}",
            method="GET",
            path="/api/v1/workflow/{workflow_id}",
            status_code=200,
            duration_ms=1,
            query={"token": "secret"},
        )
        for index, org in enumerate(orgs)
    ]
    async_session.add_all([*webhooks, *requests])
    await async_session.flush()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_user_with_selected_organization] = lambda: users[0]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SimpleNamespace(
            client=client,
            app=app,
            users=users,
            orgs=orgs,
            runs=runs,
            workflows=workflows,
            definitions=definitions,
            webhooks=webhooks,
            requests=requests,
            db=db_session,
            session=async_session,
        )


async def test_list_scope_projection_versions_and_cost(logs_data):
    response = await logs_data.client.get("/api/v1/logs/calls")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_count"] == 5
    assert all(
        item["workflow_id"] == logs_data.workflows[0].id for item in body["items"]
    )
    assert all(item["version_number"] == 2 for item in body["items"])
    assert not any(
        "logs" in item or "initial_context" in item for item in body["items"]
    )
    charged = next(item for item in body["items"] if item["id"] == logs_data.runs[0].id)
    assert charged["charge_usd"] == 0.02 and charged["credits_used"] == 2
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize(
    "endpoint",
    [
        "",
        "/transcript",
        "/events",
        "/messages",
        "/analysis",
        "/structured-outputs",
        "/cost",
        "/latency",
        "/waveform/mixed",
        "/artifacts/mixed",
        "/feedback",
    ],
)
async def test_call_drawer_tenant_isolation(logs_data, endpoint):
    response = await logs_data.client.get(
        f"/api/v1/logs/calls/{logs_data.runs[5].id}{endpoint}"
    )
    assert response.status_code == 404


@pytest.mark.parametrize(
    "query",
    [
        "limit=101",
        "page=0",
        "workflow_ids=-1",
        "channels=invalid",
        "start_at=2026-01-01T00:00:00",
        "start_at=2026-02-01T00:00:00Z&end_at=2026-01-01T00:00:00Z",
        "min_duration=10&max_duration=2",
        "min_duration=NaN",
        "cursor=not-base64",
        "unknown=1",
        "ended_reasons=",
        "directions=invalid",
    ],
)
async def test_invalid_filters(logs_data, query):
    response = await logs_data.client.get(f"/api/v1/logs/calls?{query}")
    assert response.status_code == 422, response.text


async def test_cursor_ties_and_boundaries(logs_data):
    first = (await logs_data.client.get("/api/v1/logs/calls?limit=2")).json()
    ids = [item["id"] for item in first["items"]]
    cursor = first["next_cursor"]
    while cursor:
        response = await logs_data.client.get(
            "/api/v1/logs/calls", params={"cursor": cursor, "limit": 2}
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["total_count"] == 5
        ids.extend(item["id"] for item in data["items"])
        cursor = data["next_cursor"]
    assert ids == sorted([run.id for run in logs_data.runs[:5]], reverse=True)
    assert len(set(ids)) == 5
    invalid = await logs_data.client.get(
        "/api/v1/logs/calls", params={"cursor": first["next_cursor"], "min_duration": 2}
    )
    assert invalid.status_code == 422


async def test_filters_and_export(logs_data):
    result = await logs_data.client.get(
        "/api/v1/logs/calls",
        params={
            "provider_call_id": "provider-0",
            "directions": "inbound",
            "min_duration": 1,
            "max_duration": 1,
            "customer_number": "0101",
            "workflow_ids": logs_data.workflows[0].id,
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["total_count"] == 1
    escaped = await logs_data.client.get("/api/v1/logs/calls?customer_number=%25")
    assert escaped.json()["total_count"] == 0
    export = await logs_data.client.get("/api/v1/logs/calls/export")
    assert export.status_code == 200, export.text
    assert len(export.text.splitlines()) == 6
    assert "provider-5" not in export.text


async def test_detail_tabs_and_feedback(logs_data):
    path = f"/api/v1/logs/calls/{logs_data.runs[0].id}"
    detail = (await logs_data.client.get(path)).json()
    assert detail["initial_context"]["api_key"] == "[redacted]"
    assert detail["artifacts"]["mixed"]["waveform_available"]
    transcript = (await logs_data.client.get(path + "/transcript?limit=1")).json()
    assert transcript["total_count"] == 2 and transcript["has_more"]
    assert transcript["items"][0]["start_seconds"] == 1
    assert transcript["items"][0]["end_seconds"] == 2
    latency = (await logs_data.client.get(path + "/latency")).json()
    assert latency["averages_ms"]["llm_ttfb_ms"] == 200
    assert not latency["detailed_breakdown_available"]
    costs = (await logs_data.client.get(path + "/cost")).json()
    assert costs["charge_usd"] == 0.02
    assert costs["components"][0]["charge_usd"] is None
    output = (await logs_data.client.get(path + "/structured-outputs")).json()
    assert output["extracted_variables"]["answer"] == "yes"
    waveform = (await logs_data.client.get(path + "/waveform/mixed")).json()
    assert waveform["peaks"] == [0, 0.5]
    for rating in ("negative", "positive"):
        response = await logs_data.client.put(
            path + "/feedback",
            json={"event_id": "rtf:0", "rating": rating, "note": "review"},
        )
        assert response.status_code == 200, response.text
    feedback = (await logs_data.client.get(path + "/feedback")).json()["items"]
    assert len(feedback) == 1 and feedback[0]["rating"] == "positive"
    invalid = await logs_data.client.put(
        path + "/feedback", json={"event_id": "rtf:99", "rating": "negative"}
    )
    assert invalid.status_code == 422
    forbidden = await logs_data.client.put(
        f"/api/v1/logs/calls/{logs_data.runs[5].id}/feedback",
        json={"rating": "negative"},
    )
    assert forbidden.status_code == 404


async def test_operational_logs(logs_data):
    for tab in ("sessions", "webhooks", "api"):
        response = await logs_data.client.get(f"/api/v1/logs/{tab}")
        assert response.status_code == 200, response.text
        assert response.json()["total_count"] == 1
    webhook = await logs_data.client.get(
        f"/api/v1/logs/webhooks/{logs_data.webhooks[0].id}"
    )
    assert webhook.json()["payload"]["authorization"] == "[redacted]"
    assert "hidden" not in webhook.text
    for tab, identifier in (
        ("webhooks", logs_data.webhooks[1].id),
        ("api", logs_data.requests[1].id),
    ):
        assert (
            await logs_data.client.get(f"/api/v1/logs/{tab}/{identifier}")
        ).status_code == 404
    assert (
        await logs_data.client.get("/api/v1/logs/api?status=nope")
    ).status_code == 422
    assert (await logs_data.client.get("/api/v1/logs/api?run_id=1")).status_code == 422
    assert (
        await logs_data.client.get("/api/v1/logs/api?status=²²²")
    ).status_code == 422


async def test_unnamed_historical_webhook_and_nonfinal_feedback(logs_data):
    logs_data.webhooks[0].webhook_name = None
    logs_data.runs[0].logs = {
        "realtime_feedback_events": [
            {
                "type": "rtf-user-transcription",
                "payload": {"text": "Partial", "final": False},
            }
        ]
    }
    await logs_data.session.flush()
    response = await logs_data.client.get("/api/v1/logs/webhooks")
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["webhook_name"] is None
    feedback = await logs_data.client.put(
        f"/api/v1/logs/calls/{logs_data.runs[0].id}/feedback",
        json={"event_id": "rtf:0", "rating": "negative"},
    )
    assert feedback.status_code == 422


async def test_artifact_redirect_is_scoped_and_short_lived(logs_data, monkeypatch):
    signing = AsyncMock(
        return_value="https://storage.example/audio?signature=temporary"
    )
    monkeypatch.setattr(
        "api.routes.logs.get_storage_for_backend",
        lambda _: SimpleNamespace(aget_signed_url=signing),
    )
    response = await logs_data.client.get(
        f"/api/v1/logs/calls/{logs_data.runs[0].id}/artifacts/mixed"
    )
    assert response.status_code == 307
    signing.assert_awaited_once_with(
        "recordings/0.wav", expiration=300, force_inline=True
    )
    signing.side_effect = RuntimeError("storage unavailable")
    failed = await logs_data.client.get(
        f"/api/v1/logs/calls/{logs_data.runs[0].id}/artifacts/mixed"
    )
    assert failed.status_code == 503


async def test_malformed_historical_usage_and_unpinned_calls(logs_data):
    run = logs_data.runs[0]
    run.usage_info = {"call_duration_seconds": "not-a-number"}
    run.cost_info = {"dograh_token_usage": ""}
    run.definition_id = None
    run.extra = {}
    run.logs = {}
    await logs_data.session.flush()
    response = await logs_data.client.get(
        "/api/v1/logs/calls", params={"run_id": run.id}
    )
    assert response.status_code == 200, response.text
    row = response.json()["items"][0]
    assert (
        row["duration_seconds"] is None
        and row["credits_used"] is None
        and row["version_number"] is None
    )
    transcript = (
        await logs_data.client.get(f"/api/v1/logs/calls/{run.id}/transcript")
    ).json()
    assert not transcript["available"]


async def test_chats_and_channel_filters(logs_data):
    chats = await logs_data.client.get("/api/v1/logs/chats")
    assert chats.status_code == 200, chats.text
    assert chats.json()["total_count"] == 1
    assert chats.json()["items"][0]["channel"] == "chat"
    web = await logs_data.client.get("/api/v1/logs/calls?channels=web")
    assert web.json()["total_count"] == 4
    assert (
        await logs_data.client.get("/api/v1/logs/chats?channels=web")
    ).status_code == 422


async def test_date_boundaries_multi_select_and_duration_cursor(logs_data):
    created = logs_data.runs[0].created_at.isoformat()
    assert (
        await logs_data.client.get("/api/v1/logs/calls", params={"end_at": created})
    ).json()["total_count"] == 0
    assert (
        await logs_data.client.get("/api/v1/logs/calls", params={"start_at": created})
    ).json()["total_count"] == 5
    params = [
        ("workflow_ids", logs_data.workflows[0].id),
        ("workflow_ids", logs_data.workflows[1].id),
        ("definition_ids", logs_data.definitions[0].id),
        ("ended_reasons", "customer_ended"),
        ("assistant_number", "0202"),
    ]
    assert (await logs_data.client.get("/api/v1/logs/calls", params=params)).json()[
        "total_count"
    ] == 5
    logs_data.runs[0].usage_info = {}
    await logs_data.session.flush()
    for order in ("asc", "desc"):
        ids = []
        cursor = None
        while True:
            params = {"sort_by": "duration", "sort_order": order, "limit": 2}
            if cursor:
                params["cursor"] = cursor
            response = await logs_data.client.get("/api/v1/logs/calls", params=params)
            assert response.status_code == 200, response.text
            data = response.json()
            ids.extend(item["id"] for item in data["items"])
            cursor = data["next_cursor"]
            if not cursor:
                break
        expected = [run.id for run in logs_data.runs[1:5]]
        if order == "desc":
            expected.reverse()
        assert ids == [*expected, logs_data.runs[0].id]


async def test_signed_url_for_audio_element_and_auth_required(logs_data, monkeypatch):
    signing = AsyncMock(return_value="https://storage.example/audio")
    monkeypatch.setattr(
        "api.routes.logs.get_storage_for_backend",
        lambda _: SimpleNamespace(aget_signed_url=signing),
    )
    response = await logs_data.client.get(
        f"/api/v1/logs/calls/{logs_data.runs[0].id}/artifacts/mixed/url"
    )
    assert response.json() == {
        "url": "https://storage.example/audio",
        "expires_in_seconds": 300,
    }
    logs_data.app.dependency_overrides.clear()
    assert (await logs_data.client.get("/api/v1/logs/calls")).status_code == 401


async def test_large_export_reads_bounded_batches(logs_data):
    from sqlalchemy import event, insert

    now = datetime.now(UTC) - timedelta(minutes=2)
    await logs_data.session.execute(
        insert(WorkflowRunModel),
        [
            {
                "name": "batch",
                "workflow_id": logs_data.workflows[0].id,
                "mode": "smallwebrtc",
                "created_at": now,
            }
            for _ in range(205)
        ],
    )
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = logs_data.session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await logs_data.client.get("/api/v1/logs/calls/export")
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    assert len(response.text.splitlines()) == 211
    assert sum("count(" in statement.lower() for statement in statements) == 1
    assert all("workflow_runs.logs," not in statement for statement in statements)


async def test_recording_feedback_requires_stable_completed_transcript(logs_data):
    logs_data.runs[0].is_completed = False
    await logs_data.session.flush()
    path = f"/api/v1/logs/calls/{logs_data.runs[0].id}/feedback"
    assert (
        await logs_data.client.put(
            path, json={"event_id": "rtf:0", "rating": "negative"}
        )
    ).status_code == 422
    assert (
        await logs_data.client.put(path, json={"rating": "negative"})
    ).status_code == 200


async def test_session_detail_tenant_isolation(logs_data):
    own = await logs_data.client.get(f"/api/v1/logs/sessions/{logs_data.runs[4].id}")
    assert own.status_code == 200, own.text
    assert own.json()["workflow_run_id"] == logs_data.runs[4].id
    assert (
        await logs_data.client.get(f"/api/v1/logs/sessions/{logs_data.runs[5].id}")
    ).status_code == 404
    assert (
        await logs_data.client.get(f"/api/v1/logs/sessions/{logs_data.runs[0].id}")
    ).status_code == 404


@pytest.mark.parametrize(
    "enabled,processing,expected",
    [
        (True, "pending", "pending"),
        (True, "running", "pending"),
        (True, "failed", "failed"),
        (True, "completed", "unavailable"),
        (False, "pending", "not_configured"),
        (None, "pending", "pending"),
    ],
)
async def test_analysis_configuration_and_processing_status(
    logs_data, enabled, processing, expected
):
    node = {"id": "judge", "type": "qa", "data": {}}
    if enabled is not None:
        node["data"]["qa_enabled"] = enabled
    logs_data.definitions[0].workflow_json = {"nodes": [node]}
    logs_data.runs[0].annotations = {}
    logs_data.runs[0].extra = {"analysis_status": processing}
    await logs_data.session.flush()
    response = await logs_data.client.get(
        f"/api/v1/logs/calls/{logs_data.runs[0].id}/analysis"
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"status": expected, "evaluators": []}


async def test_payload_truncation_is_reported(logs_data):
    logs_data.runs[0].logs = {
        **logs_data.runs[0].logs,
        "realtime_feedback_meta": {"dropped_events": 3},
    }
    await logs_data.session.flush()
    path = f"/api/v1/logs/calls/{logs_data.runs[0].id}"
    assert (await logs_data.client.get(path + "/transcript")).json()["truncated"]
    assert (await logs_data.client.get(path + "/events")).json()["truncated"]


async def test_database_id_bounds_are_validated_before_query(logs_data):
    huge = str(2**100)
    for path in (
        f"/calls/{huge}",
        f"/sessions/{huge}",
        f"/api/{huge}",
        f"/webhooks/{huge}",
    ):
        assert (await logs_data.client.get("/api/v1/logs" + path)).status_code == 422
    for key in ("run_id", "workflow_ids", "definition_ids"):
        assert (
            await logs_data.client.get("/api/v1/logs/calls", params={key: huge})
        ).status_code == 422


def test_openapi_describes_csv_and_redirect_contracts():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    paths = app.openapi()["paths"]
    export = paths["/api/v1/logs/calls/export"]["get"]["responses"]["200"]
    assert set(export["content"]) == {"text/csv"}
    artifact = paths["/api/v1/logs/calls/{run_id}/artifacts/{track}"]["get"][
        "responses"
    ]
    assert "307" in artifact and "200" not in artifact and "503" in artifact
