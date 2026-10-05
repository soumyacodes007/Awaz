from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class TestBehaviorIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=1000)


class TestBehavior(BaseModel):
    id: str
    name: str
    description: str


class AgentTestIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scenario: str = Field(min_length=1, max_length=8000)
    behaviors: list[TestBehaviorIn] = Field(min_length=1, max_length=20)


class TestLastResult(BaseModel):
    status: str
    run_id: int
    finished_at: datetime | None = None


class AgentTestResponse(BaseModel):
    id: int
    name: str
    scenario: str
    behaviors: list[TestBehavior]
    last_result: TestLastResult | None = None
    created_at: datetime
    updated_at: datetime


class GenerateTestsRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=10)


class CreateTestRunRequest(BaseModel):
    test_ids: list[int] = Field(
        default_factory=list, max_length=200, description="Empty runs every test."
    )
    runs_per_test: Literal[1, 2, 3, 5] = 1


class TestRunSummary(BaseModel):
    id: int
    number: int
    status: str
    runs_per_test: int
    version_number: int | None = None
    simulator_model: str | None = None
    judge_model: str | None = None
    total: int
    passed: int
    failed: int
    errored: int
    pending: int
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class TestTranscriptItem(BaseModel):
    role: Literal["agent", "user", "tool", "end", "caller_end"]
    text: str | None = None
    name: str | None = None
    arguments: dict[str, Any] | None = None
    result: str | None = None


class TestVerdict(BaseModel):
    behavior_id: str
    name: str
    passed: bool
    reasoning: str


class TestResultResponse(BaseModel):
    id: int
    test_id: int | None = None
    iteration: int
    test_name: str
    scenario: str
    behaviors: list[TestBehavior]
    status: str
    transcript: list[TestTranscriptItem]
    verdicts: list[TestVerdict]
    workflow_run_id: int | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class TestRunDetail(TestRunSummary):
    results: list[TestResultResponse]


class TestConfigResponse(BaseModel):
    configured: bool
    simulator_model: str
    judge_model: str
