"""Organization-scoped queries for call and operational logs.

List queries project scalar fields only. Large JSON payloads are fetched solely
for the selected call/tab. Exports use keyset batches and release each session.
"""

from datetime import UTC, datetime

from sqlalchemy import (
    Float,
    String,
    and_,
    case,
    cast,
    func,
    literal_column,
    or_,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB, JSONPATH, insert

from api.db.base_client import BaseDBClient
from api.db.models import (
    APIRequestLogModel,
    CallFeedbackModel,
    WebhookDeliveryModel,
    WorkflowDefinitionModel,
    WorkflowModel,
    WorkflowRunModel,
    WorkflowRunTextSessionModel,
)
from api.enums import WORKFLOW_RUN_MODES_BY_CHANNEL
from api.schemas.logs import CallLogQuery, OperationalLogQuery

R = WorkflowRunModel
W = WorkflowModel
D = WorkflowDefinitionModel
CUSTOMER_NUMBER_SQL = "coalesce(nullif(gathered_context->>'customer_phone_number', ''), CASE WHEN call_type = 'inbound' THEN nullif(initial_context->>'caller_number', '') ELSE coalesce(nullif(initial_context->>'called_number', ''), nullif(initial_context->>'phone_number', '')) END)"
ASSISTANT_NUMBER_SQL = "CASE WHEN call_type = 'inbound' THEN coalesce(nullif(initial_context->>'called_number', ''), nullif(initial_context->>'phone_number', '')) ELSE nullif(initial_context->>'caller_number', '') END"


def _number(column, key):
    value = column.op("->>")(key)
    # Historical JSON may contain empty strings or non-numbers. Never cast those.
    return case(
        (
            and_(
                func.length(value) <= 50,
                value.op("~")(r"^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]{1,2})?$"),
            ),
            cast(value, Float),
        ),
        else_=None,
    )


def _phone_expressions():
    # Match the indexed expressions exactly; JSON-key bind parameters prevent
    # PostgreSQL generic plans from recognizing functional indexes.
    return literal_column(CUSTOMER_NUMBER_SQL, String), literal_column(
        ASSISTANT_NUMBER_SQL, String
    )


def _summary_columns():
    customer, assistant = _phone_expressions()
    channel = case(
        *[
            (R.mode.in_(modes), name)
            for name, modes in WORKFLOW_RUN_MODES_BY_CHANNEL.items()
        ],
        else_="unknown",
    )
    return [
        R.id,
        R.workflow_id,
        W.name.label("workflow_name"),
        R.definition_id,
        D.version_number,
        D.status.label("version_status"),
        R.created_at,
        cast(R.state, String).label("state"),
        func.coalesce(R.is_completed, False).label("is_completed"),
        channel.label("channel"),
        R.mode.label("provider"),
        cast(R.call_type, String).label("direction"),
        customer.label("customer_number"),
        assistant.label("assistant_number"),
        R.gathered_context.op("->>")("call_id").label("provider_call_id"),
        func.coalesce(
            R.gathered_context.op("->>")("call_status"),
            R.gathered_context.op("->>")("call_disposition"),
        ).label("ended_reason"),
        R.gathered_context.op("->>")("mapped_call_disposition").label("disposition"),
        _number(R.usage_info, "call_duration_seconds").label("duration_seconds"),
        _number(R.cost_info, "charge_usd").label("charge_usd"),
        _number(R.cost_info, "dograh_token_usage").label("credits_used"),
        or_(
            R.recording_url.isnot(None),
            R.extra["recordings"]["user"]["storage_key"].as_string().isnot(None),
            R.extra["recordings"]["bot"]["storage_key"].as_string().isnot(None),
        ).label("has_recording"),
        R.transcript_url.isnot(None).label("has_transcript"),
    ]


def _base(organization_id, *columns):
    if not organization_id:
        raise ValueError("organization_id is required")
    return (
        select(*columns)
        .select_from(R)
        .join(W, W.id == R.workflow_id)
        .outerjoin(D, and_(D.id == R.definition_id, D.workflow_id == R.workflow_id))
        .where(W.organization_id == organization_id)
    )


def _filtered(query, filters: CallLogQuery):
    customer, assistant = _phone_expressions()
    if filters.start_at:
        query = query.where(R.created_at >= filters.start_at)
    if filters.end_at:
        query = query.where(R.created_at < filters.end_at)
    if filters.workflow_ids:
        query = query.where(R.workflow_id.in_(filters.workflow_ids))
    if filters.definition_ids:
        query = query.where(R.definition_id.in_(filters.definition_ids))
    if filters.channels:
        modes = [
            mode
            for channel in filters.channels
            for mode in WORKFLOW_RUN_MODES_BY_CHANNEL[channel]
        ]
        query = query.where(R.mode.in_(modes))
    if filters.directions:
        query = query.where(R.call_type.in_(filters.directions))
    if filters.ended_reasons:
        reason = func.coalesce(
            R.gathered_context.op("->>")("call_status"),
            R.gathered_context.op("->>")("call_disposition"),
        )
        query = query.where(reason.in_(filters.ended_reasons))
    if filters.run_id is not None:
        query = query.where(R.id == filters.run_id)
    if filters.provider_call_id:
        query = query.where(
            R.gathered_context.op("->>")("call_id") == filters.provider_call_id
        )
    if filters.customer_number:
        query = query.where(customer.contains(filters.customer_number, autoescape=True))
    if filters.assistant_number:
        query = query.where(
            assistant.contains(filters.assistant_number, autoescape=True)
        )
    if filters.completed is not None:
        query = query.where(R.is_completed == filters.completed)
    duration = _number(R.usage_info, "call_duration_seconds")
    if filters.min_duration is not None:
        query = query.where(duration >= filters.min_duration)
    if filters.max_duration is not None:
        query = query.where(duration <= filters.max_duration)
    return query


def _operational_filters(query, model, filters):
    if filters.start_at:
        query = query.where(model.created_at >= filters.start_at)
    if filters.end_at:
        query = query.where(model.created_at < filters.end_at)
    if filters.run_id:
        query = query.where(model.workflow_run_id == filters.run_id)
    return query


class LogsClient(BaseDBClient):
    async def list_call_logs(
        self, organization_id: int, filters: CallLogQuery, cursor: dict | None = None
    ):
        snapshot = (
            datetime.fromisoformat(cursor["snapshot"]) if cursor else datetime.now(UTC)
        )
        query = _filtered(_base(organization_id, *_summary_columns()), filters).where(
            R.created_at <= snapshot
        )
        async with self.async_session() as session:
            if cursor:
                query = query.where(R.id <= cursor["max_id"])
            scoped = query.with_only_columns(R.id).subquery()
            stats = await session.execute(
                select(func.count(), func.max(scoped.c.id)).select_from(scoped)
            )
            total, max_id = stats.one()
            max_id = cursor["max_id"] if cursor else max_id or 0
            query = query.where(R.id <= max_id)
            key = (
                R.created_at
                if filters.sort_by == "created_at"
                else _number(R.usage_info, "call_duration_seconds")
            )
            ascending = filters.sort_order == "asc"
            if cursor:
                value = cursor["value"]
                if filters.sort_by == "created_at":
                    value = datetime.fromisoformat(value)
                tie = R.id > cursor["id"] if ascending else R.id < cursor["id"]
                if value is None:
                    query = query.where(and_(key.is_(None), tie))
                else:
                    comparison = key > value if ascending else key < value
                    query = query.where(
                        or_(comparison, and_(key == value, tie), key.is_(None))
                    )
            query = query.order_by(
                key.asc().nullslast() if ascending else key.desc().nullslast(),
                R.id.asc() if ascending else R.id.desc(),
            )
            result = await session.execute(
                query.limit(filters.limit + 1).offset(
                    0 if cursor else (filters.page - 1) * filters.limit
                )
            )
            rows = [dict(row) for row in result.mappings()]
        has_more = len(rows) > filters.limit
        return rows[: filters.limit], total, has_more, snapshot, max_id

    async def get_call_log(self, run_id: int, organization_id: int):
        query = _base(
            organization_id,
            *_summary_columns(),
            R.initial_context,
            R.gathered_context,
            R.extra,
            R.recording_url,
            R.transcript_url,
            R.storage_backend,
            R.usage_info,
            R.cost_info,
            func.coalesce(
                func.jsonb_path_exists(
                    cast(D.workflow_json, JSONB),
                    cast(
                        '$.nodes[*] ? (@.type == "qa" && (!exists(@.data.qa_enabled) || @.data.qa_enabled == true))',
                        JSONPATH,
                    ),
                ),
                False,
            ).label("analysis_configured"),
            R.logs["realtime_feedback_events"].isnot(None).label("events_available"),
            R.logs["diagnostics"].isnot(None).label("diagnostics_available"),
            R.logs["local_trace"].isnot(None).label("messages_available"),
        ).where(R.id == run_id)
        async with self.async_session() as session:
            row = (await session.execute(query)).mappings().first()
            return dict(row) if row else None

    async def get_call_log_payload(
        self, run_id: int, organization_id: int, section: str
    ):
        columns = {
            "events": R.logs["realtime_feedback_events"],
            "diagnostics": R.logs["diagnostics"],
            "trace": R.logs["local_trace"],
            "analysis": R.annotations,
            "event_meta": R.logs["realtime_feedback_meta"],
        }
        column = columns[section]
        async with self.async_session() as session:
            row = (
                await session.execute(
                    _base(organization_id, column.label("payload")).where(
                        R.id == run_id
                    )
                )
            ).first()
            return (False, None) if row is None else (True, row.payload)

    async def log_workflow_options(self, organization_id: int, search: str, limit: int):
        async with self.async_session() as session:
            rows = await session.execute(
                select(W.id, W.name)
                .where(
                    W.organization_id == organization_id,
                    W.name.icontains(search, autoescape=True),
                )
                .order_by(W.name, W.id)
                .limit(limit)
            )
            return [dict(row) for row in rows.mappings()]

    async def iter_call_export(
        self,
        organization_id: int,
        filters: CallLogQuery,
        *,
        snapshot,
        max_id,
        max_rows: int = 100000,
    ):
        # Never hold an open transaction while the client is downloading.
        filters = filters.model_copy(
            update={
                "page": 1,
                "limit": 100,
                "sort_by": "created_at",
                "sort_order": "desc",
                "cursor": None,
            }
        )
        emitted = 0
        last = None
        while True:
            query = _filtered(
                _base(organization_id, *_summary_columns()), filters
            ).where(R.created_at <= snapshot, R.id <= max_id)
            if last:
                query = query.where(
                    or_(
                        R.created_at < last["created_at"],
                        and_(R.created_at == last["created_at"], R.id < last["id"]),
                    )
                )
            async with self.async_session() as session:
                result = await session.execute(
                    query.order_by(R.created_at.desc(), R.id.desc()).limit(100)
                )
                rows = [dict(row) for row in result.mappings()]
            for row in rows:
                emitted += 1
                if emitted > max_rows:
                    return
                yield row
            if len(rows) < 100:
                return
            last = rows[-1]

    async def list_log_sessions(self, organization_id: int, query: OperationalLogQuery):
        S = WorkflowRunTextSessionModel
        base = (
            select(
                S.workflow_run_id.label("id"),
                S.workflow_run_id,
                R.workflow_id,
                W.name.label("workflow_name"),
                R.definition_id,
                D.version_number,
                S.revision,
                S.created_at,
                S.updated_at,
                cast(R.state, String).label("state"),
                R.is_completed,
            )
            .select_from(S)
            .join(R, R.id == S.workflow_run_id)
            .join(W, W.id == R.workflow_id)
            .outerjoin(D, and_(D.id == R.definition_id, D.workflow_id == R.workflow_id))
            .where(W.organization_id == organization_id)
        )
        base = _operational_filters(base, S, query)
        if query.status:
            base = base.where(cast(R.state, String) == query.status)
        return await self._operational_page(base, S, query)

    async def list_log_webhooks(self, organization_id: int, query: OperationalLogQuery):
        M = WebhookDeliveryModel
        base = (
            select(
                M.id,
                M.workflow_run_id,
                M.webhook_name,
                M.http_method,
                M.endpoint_url,
                M.status,
                M.attempt_count,
                M.max_attempts,
                M.scheduled_for,
                M.last_status_code,
                M.last_error,
                M.created_at,
                M.updated_at,
            )
            .join(R, R.id == M.workflow_run_id)
            .join(W, W.id == R.workflow_id)
            .where(
                M.organization_id == organization_id,
                W.organization_id == organization_id,
            )
        )
        base = _operational_filters(base, M, query)
        if query.status:
            base = base.where(cast(M.status, String) == query.status)
        return await self._operational_page(base, M, query)

    async def get_log_webhook(self, delivery_id: int, organization_id: int):
        M = WebhookDeliveryModel
        async with self.async_session() as session:
            row = (
                (
                    await session.execute(
                        select(
                            M.id,
                            M.workflow_run_id,
                            M.webhook_name,
                            M.http_method,
                            M.endpoint_url,
                            M.payload,
                            M.status,
                            M.attempt_count,
                            M.max_attempts,
                            M.scheduled_for,
                            M.last_status_code,
                            M.last_error,
                            M.created_at,
                            M.updated_at,
                        )
                        .join(R, R.id == M.workflow_run_id)
                        .join(W, W.id == R.workflow_id)
                        .where(
                            M.id == delivery_id,
                            M.organization_id == organization_id,
                            W.organization_id == organization_id,
                        )
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    async def list_log_api_requests(
        self, organization_id: int, query: OperationalLogQuery
    ):
        M = APIRequestLogModel
        base = select(
            M.id,
            M.request_id,
            M.method,
            M.path,
            M.status_code,
            M.duration_ms,
            M.created_at,
        ).where(M.organization_id == organization_id)
        if query.start_at:
            base = base.where(M.created_at >= query.start_at)
        if query.end_at:
            base = base.where(M.created_at < query.end_at)
        if query.status:
            base = base.where(M.status_code == int(query.status))
        return await self._operational_page(base, M, query)

    async def get_log_api_request(self, log_id: int, organization_id: int):
        M = APIRequestLogModel
        async with self.async_session() as session:
            row = (
                (
                    await session.execute(
                        select(
                            M.id,
                            M.request_id,
                            M.method,
                            M.path,
                            M.status_code,
                            M.duration_ms,
                            M.query,
                            M.created_at,
                        ).where(M.id == log_id, M.organization_id == organization_id)
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    async def get_log_session(self, run_id: int, organization_id: int):
        S = WorkflowRunTextSessionModel
        query = (
            _base(
                organization_id,
                S.workflow_run_id.label("id"),
                S.workflow_run_id,
                R.workflow_id,
                W.name.label("workflow_name"),
                R.definition_id,
                D.version_number,
                S.revision,
                S.created_at,
                S.updated_at,
                cast(R.state, String).label("state"),
                func.coalesce(R.is_completed, False).label("is_completed"),
            )
            .join(S, S.workflow_run_id == R.id)
            .where(R.id == run_id)
        )
        async with self.async_session() as session:
            row = (await session.execute(query)).mappings().first()
            return dict(row) if row else None

    async def _operational_page(self, base, model, query):
        async with self.async_session() as session:
            total = (
                await session.execute(select(func.count()).select_from(base.subquery()))
            ).scalar_one()
            identity = (
                model.workflow_run_id
                if model is WorkflowRunTextSessionModel
                else model.id
            )
            result = await session.execute(
                base.order_by(model.created_at.desc(), identity.desc())
                .limit(query.limit)
                .offset((query.page - 1) * query.limit)
            )
            return [dict(row) for row in result.mappings()], total

    async def record_api_request(self, **values):
        async with self.async_session() as session:
            session.add(APIRequestLogModel(**values))
            await session.commit()

    async def save_call_feedback(self, run_id, organization_id, user_id, feedback):
        # Establish ownership inside the same transaction as the write.
        async with self.async_session() as session:
            owned = (
                await session.execute(
                    select(R.id)
                    .join(W, W.id == R.workflow_id)
                    .where(R.id == run_id, W.organization_id == organization_id)
                )
            ).scalar_one_or_none()
            if owned is None:
                return None
            now = datetime.now(UTC)
            values = {
                "workflow_run_id": run_id,
                "organization_id": organization_id,
                "user_id": user_id,
                "event_id": feedback.event_id,
                "rating": feedback.rating,
                "note": feedback.note,
                "updated_at": now,
            }
            stmt = (
                insert(CallFeedbackModel)
                .values(**values)
                .on_conflict_do_update(
                    constraint="uq_call_feedback_run_user_event",
                    set_={
                        "rating": feedback.rating,
                        "note": feedback.note,
                        "updated_at": now,
                    },
                )
                .returning(
                    CallFeedbackModel.id,
                    CallFeedbackModel.event_id,
                    CallFeedbackModel.rating,
                    CallFeedbackModel.note,
                    CallFeedbackModel.user_id,
                    CallFeedbackModel.created_at,
                    CallFeedbackModel.updated_at,
                )
            )
            row = (await session.execute(stmt)).mappings().one()
            await session.commit()
            return dict(row)

    async def list_call_feedback(self, run_id: int, organization_id: int):
        M = CallFeedbackModel
        async with self.async_session() as session:
            result = await session.execute(
                select(
                    M.id,
                    M.event_id,
                    M.rating,
                    M.note,
                    M.user_id,
                    M.created_at,
                    M.updated_at,
                )
                .join(R, R.id == M.workflow_run_id)
                .join(W, W.id == R.workflow_id)
                .where(
                    M.workflow_run_id == run_id,
                    M.organization_id == organization_id,
                    W.organization_id == organization_id,
                )
                .order_by(M.id)
                .limit(1000)
            )
            return [dict(row) for row in result.mappings()]

    async def prune_api_request_logs(self, before: datetime, batch_size: int = 1000):
        from sqlalchemy import delete

        M = APIRequestLogModel
        async with self.async_session() as session:
            stmt = delete(M).where(
                M.id.in_(
                    select(M.id)
                    .where(M.created_at < before)
                    .order_by(M.created_at)
                    .limit(batch_size)
                )
            )
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount
