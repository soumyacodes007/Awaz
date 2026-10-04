from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

GroupBy = Literal["hour", "day", "week"]


class MetricsTotals(BaseModel):
    calls: int
    minutes: float
    spend_usd: float = Field(
        description="Recorded charge, or an estimate when none was recorded."
    )
    avg_cost_usd: float | None
    avg_duration_seconds: float | None
    reviewed_calls: int = Field(description="Calls with a QA score.")
    success_rate: float | None = Field(
        description="Share of reviewed calls scoring 7 or more (0–1)."
    )
    peak_concurrency: int
    cost_estimated: bool = Field(
        description="True when any cost came from list prices rather than billing."
    )


class MetricsBucket(BaseModel):
    start: datetime = Field(description="Bucket start in the requested timezone.")
    calls: int
    minutes: float
    spend_usd: float
    avg_cost_usd: float | None
    avg_duration_seconds: float | None
    peak_concurrency: int
    cost_by_component: dict[str, float] = Field(
        description="llm, stt, tts, telephony in USD."
    )
    ended_reasons: dict[str, int]
    success: dict[str, int] = Field(
        description="pass, needs_review, fail, not_reviewed."
    )
    avg_duration_by_agent: dict[str, float] = Field(
        description="Agent id → average seconds, agents with calls in this bucket."
    )


class AgentMetrics(BaseModel):
    workflow_id: int
    name: str
    calls: int
    minutes: float
    avg_duration_seconds: float | None
    spend_usd: float


class CountItem(BaseModel):
    key: str
    count: int


class UnsuccessfulCall(BaseModel):
    id: int
    workflow_id: int
    workflow_name: str
    created_at: datetime
    reason: str
    duration_seconds: float | None
    qa_score: float | None


class MetricsResponse(BaseModel):
    start_at: datetime
    end_at: datetime
    group_by: GroupBy
    timezone: str
    truncated: bool = Field(
        description="True when the range held more calls than one response aggregates."
    )
    totals: MetricsTotals
    buckets: list[MetricsBucket]
    agents: list[AgentMetrics]
    ended_reasons: list[CountItem]
    cost_breakdown: dict[str, float]
    success: dict[str, int]
    unsuccessful_calls: list[UnsuccessfulCall]
