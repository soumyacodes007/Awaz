"""Dashboard metrics: call volume, minutes, spend, outcomes, quality and
concurrency for a time range, bucketed by hour, day or week."""

from datetime import UTC, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime

from api.db import db_client
from api.db.models import UserModel
from api.routes.logs import private_response
from api.schemas.metrics import GroupBy, MetricsResponse
from api.sdk_expose import sdk_expose
from api.services.auth.depends import get_user_with_selected_organization
from api.services.metrics.aggregate import aggregate

router = APIRouter(
    prefix="/metrics", tags=["metrics"], dependencies=[Depends(private_response)]
)
User = Annotated[UserModel, Depends(get_user_with_selected_organization)]

MAX_RANGE = timedelta(days=366)
MAX_BUCKETS = 400


@router.get(
    "",
    response_model=MetricsResponse,
    **sdk_expose(
        method="get_metrics",
        description="Call metrics for a time range, bucketed by hour, day or week.",
    ),
)
async def get_metrics(
    user: User,
    start_at: AwareDatetime | None = Query(
        default=None, description="Inclusive. Defaults to 30 days before end_at."
    ),
    end_at: AwareDatetime | None = Query(
        default=None, description="Exclusive. Defaults to now."
    ),
    group_by: GroupBy = "day",
    timezone: str = Query(
        default="UTC",
        max_length=64,
        description="IANA zone for bucket boundaries, e.g. Asia/Kolkata.",
    ),
    workflow_ids: list[int] = Query(default_factory=list, max_length=100),
):
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Unknown timezone {timezone!r}") from None
    now = datetime.now(UTC)
    end = end_at or now
    start = start_at or end - timedelta(days=30)
    if start >= end:
        raise HTTPException(422, "end_at must be after start_at")
    if end - start > MAX_RANGE:
        raise HTTPException(422, "The range can be at most one year")
    step = {
        "hour": timedelta(hours=1),
        "day": timedelta(days=1),
        "week": timedelta(days=7),
    }[group_by]
    if (end - start) / step > MAX_BUCKETS:
        raise HTTPException(
            422, f"Too many {group_by} buckets for this range; group by a longer period"
        )

    rows, truncated = await db_client.list_metric_rows(
        user.selected_organization_id, start, end, workflow_ids
    )
    return aggregate(
        rows,
        start=start,
        end=end,
        group_by=group_by,
        timezone=timezone,
        now=now,
        truncated=truncated,
    )
