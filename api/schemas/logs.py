"""Contracts for the Logs workspace. Unknown data is null, never a fake zero."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Channel = Literal["telephony", "web", "chat"]
PositiveID = Annotated[int, Field(gt=0, le=2147483647)]


class CallLogQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    workflow_ids: list[PositiveID] = Field(default_factory=list, max_length=100)
    definition_ids: list[PositiveID] = Field(default_factory=list, max_length=100)
    channels: list[Channel] = Field(default_factory=list, max_length=3)
    directions: list[Literal["inbound", "outbound"]] = Field(
        default_factory=list, max_length=2
    )
    ended_reasons: list[str] = Field(default_factory=list, max_length=50)
    run_id: PositiveID | None = None
    provider_call_id: str | None = Field(default=None, min_length=1, max_length=200)
    customer_number: str | None = Field(default=None, min_length=1, max_length=100)
    assistant_number: str | None = Field(default=None, min_length=1, max_length=100)
    completed: bool | None = None
    min_duration: float | None = Field(
        default=None, ge=0, le=86400, allow_inf_nan=False
    )
    max_duration: float | None = Field(
        default=None, ge=0, le=86400, allow_inf_nan=False
    )
    sort_by: Literal["created_at", "duration"] = "created_at"
    sort_order: Literal["asc", "desc"] = "desc"
    page: int = Field(default=1, ge=1, le=10000)
    limit: int = Field(default=25, ge=1, le=100)
    cursor: str | None = Field(default=None, max_length=2048)

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.start_at and self.end_at and self.start_at >= self.end_at:
            raise ValueError("end_at must be after start_at; the end is exclusive")
        if self.min_duration is not None and self.max_duration is not None:
            if self.min_duration > self.max_duration:
                raise ValueError("min_duration must not exceed max_duration")
        if any(not reason or len(reason) > 100 for reason in self.ended_reasons):
            raise ValueError("ended_reasons must contain strings of 1–100 characters")
        if self.cursor and self.page != 1:
            raise ValueError("Use cursor or numbered pagination, not both")
        return self


class CallLogSummary(BaseModel):
    id: int
    workflow_id: int
    workflow_name: str
    definition_id: int | None
    version_number: int | None
    version_status: str | None
    created_at: datetime
    state: str
    is_completed: bool
    channel: str
    provider: str
    direction: str
    customer_number: str | None
    assistant_number: str | None
    provider_call_id: str | None
    ended_reason: str | None
    disposition: str | None
    duration_seconds: float | None
    charge_usd: float | None = None
    credits_used: float | None = None
    has_recording: bool
    has_transcript: bool


class CallLogPage(BaseModel):
    items: list[CallLogSummary]
    total_count: int
    page: int
    limit: int
    total_pages: int
    has_more: bool
    next_cursor: str | None
    snapshot_at: datetime


class EventPage(BaseModel):
    items: list[dict[str, Any]]
    total_count: int
    offset: int
    limit: int
    has_more: bool
    available: bool
    truncated: bool = False


class CallLogDetail(BaseModel):
    call: CallLogSummary
    recording_started_at: datetime | None
    timing_available: bool
    artifacts: dict[str, Any]
    initial_context: dict[str, Any]
    gathered_context: dict[str, Any]
    availability: dict[str, bool]
    trace_url: str | None = None


class AnalysisResponse(BaseModel):
    status: Literal["available", "pending", "failed", "not_configured", "unavailable"]
    evaluators: list[dict[str, Any]]


class StructuredOutputsResponse(BaseModel):
    extracted_variables: dict[str, Any]
    evaluations: list[dict[str, Any]]


class LatencyResponse(BaseModel):
    available: bool
    detailed_breakdown_available: bool
    averages_ms: dict[str, float | None]
    turns: list[dict[str, Any]]
    truncated: bool = False


class CostResponse(BaseModel):
    status: Literal["available", "partial", "unavailable"]
    currency: Literal["USD"] = "USD"
    charge_usd: float | None
    credits_used: float | None
    duration_seconds: float | None
    usage: dict[str, Any]
    components: list[dict[str, Any]]
    source: Literal["recorded_usage", "recorded_billing"]


class CallFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(default="call", pattern=r"^(call|rtf:[0-9]+)$", max_length=32)
    rating: Literal["positive", "negative"]
    note: str | None = Field(default=None, max_length=2000)


class OperationalLogQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    run_id: PositiveID | None = None
    status: str | None = Field(default=None, max_length=32)
    page: int = Field(default=1, ge=1, le=10000)
    limit: int = Field(default=25, ge=1, le=100)

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.start_at and self.end_at and self.start_at >= self.end_at:
            raise ValueError("end_at must be after start_at")
        return self


class OperationalLogPage(BaseModel):
    items: list[dict[str, Any]]
    total_count: int
    page: int
    limit: int
    total_pages: int


class WaveformResponse(BaseModel):
    available: bool
    peaks: list[Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]] = Field(
        max_length=2000
    )
    duration_seconds: float | None
    sample_rate: int | None
    channels: int | None


class ArtifactURLResponse(BaseModel):
    url: str
    expires_in_seconds: int


class TranscriptItem(BaseModel):
    event_id: str
    role: Literal["user", "assistant"]
    text: str
    timestamp: datetime | None
    end_timestamp: datetime | None
    start_seconds: float | None
    end_seconds: float | None
    turn: int | None
    node_id: str | None


class TranscriptPage(EventPage):
    items: list[TranscriptItem]


class FeedbackItem(BaseModel):
    id: int
    event_id: str
    rating: Literal["positive", "negative"]
    note: str | None
    user_id: int
    created_at: datetime
    updated_at: datetime


class FeedbackPage(BaseModel):
    items: list[FeedbackItem]


class WorkflowLogOption(BaseModel):
    id: int
    name: str


class WorkflowLogOptions(BaseModel):
    items: list[WorkflowLogOption]


class SessionLogSummary(BaseModel):
    id: int
    workflow_run_id: int
    workflow_id: int
    workflow_name: str
    definition_id: int | None
    version_number: int | None
    revision: int
    created_at: datetime
    updated_at: datetime
    state: str
    is_completed: bool


class SessionLogPage(OperationalLogPage):
    items: list[SessionLogSummary]


class WebhookLogSummary(BaseModel):
    id: int
    workflow_run_id: int
    webhook_name: str | None
    http_method: str
    endpoint_url: str
    status: Literal["pending", "succeeded", "dead_letter"]
    attempt_count: int
    max_attempts: int
    scheduled_for: datetime | None
    last_status_code: int | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class WebhookLogDetail(WebhookLogSummary):
    payload: dict[str, Any]


class WebhookLogPage(OperationalLogPage):
    items: list[WebhookLogSummary]


class APIRequestLogSummary(BaseModel):
    id: int
    request_id: str
    method: str
    path: str
    status_code: int
    duration_ms: float
    created_at: datetime


class APIRequestLogDetail(APIRequestLogSummary):
    query: dict[str, Any]


class APIRequestLogPage(OperationalLogPage):
    items: list[APIRequestLogSummary]
