"""Organization-scoped rows for the metrics dashboard.

One scalar row per call in the range, plus `usage_info` (small: token, character
and second counts) so cost can be estimated per component. The QA score is
pulled out of `annotations` in SQL so the large JSON never leaves the database.
"""

from datetime import datetime

from sqlalchemy import Float, String, cast, func, literal_column

from api.db.base_client import BaseDBClient
from api.db.logs_client import _base, _number
from api.db.models import WorkflowModel, WorkflowRunModel

R = WorkflowRunModel
W = WorkflowModel

# Hard cap so a huge range can't load an unbounded result set. The response
# says when it was hit.
MAX_METRIC_ROWS = 20000

# First QA evaluator's score; non-numbers (old or malformed rows) become NULL.
_SCORE = "jsonb_path_query_first(workflow_runs.annotations::jsonb, '$.*.node_results.*.output.call_quality_score')"
QA_SCORE_SQL = (
    f"CASE WHEN jsonb_typeof({_SCORE}) = 'number' THEN ({_SCORE})::text::float END"
)


class MetricsClient(BaseDBClient):
    async def list_metric_rows(
        self,
        organization_id: int,
        start_at: datetime,
        end_at: datetime,
        workflow_ids: list[int],
    ) -> tuple[list[dict], bool]:
        query = (
            _base(
                organization_id,
                R.id,
                R.workflow_id,
                W.name.label("workflow_name"),
                R.created_at,
                R.mode,
                cast(R.state, String).label("state"),
                func.coalesce(R.is_completed, False).label("is_completed"),
                func.coalesce(
                    R.gathered_context.op("->>")("call_status"),
                    R.gathered_context.op("->>")("call_disposition"),
                ).label("ended_reason"),
                _number(R.usage_info, "call_duration_seconds").label(
                    "duration_seconds"
                ),
                _number(R.cost_info, "charge_usd").label("charge_usd"),
                R.usage_info,
                literal_column(QA_SCORE_SQL, Float).label("qa_score"),
            )
            .where(R.created_at >= start_at, R.created_at < end_at)
            .order_by(R.created_at.asc())
            .limit(MAX_METRIC_ROWS + 1)
        )
        if workflow_ids:
            query = query.where(R.workflow_id.in_(workflow_ids))
        async with self.async_session() as session:
            rows = [dict(r._mapping) for r in (await session.execute(query)).all()]
        return rows[:MAX_METRIC_ROWS], len(rows) > MAX_METRIC_ROWS
