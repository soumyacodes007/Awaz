"""Flat, single-prompt agent shape used by the /agents API.

Dograh stores every agent as a workflow graph (``{nodes, edges}``). Awaz
agents are one conversation node plus optional side nodes, so this module
describes that agent directly; ``api.services.agents.spec`` converts it to
and from the stored graph. Clients never see nodes or edges.
"""

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from api.schemas.workflow_configurations import WorkflowConfigurationDefaults


class Greeting(BaseModel):
    """What the agent says when the call connects."""

    type: Literal["text", "audio"] = "text"
    text: Optional[str] = Field(default=None, description="Spoken via TTS when type is text. Supports {{variables}}.")
    recording_id: Optional[str] = Field(default=None, description="Audio clip played when type is audio.")


class ExtractionVariable(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: Literal["string", "number", "boolean"] = "string"
    prompt: Optional[str] = Field(default=None, description="What to look for in the conversation.")


class Extraction(BaseModel):
    """Structured outputs pulled from every call."""

    enabled: bool = False
    prompt: Optional[str] = None
    variables: list[ExtractionVariable] = Field(default_factory=list)


class PreCallFetch(BaseModel):
    """POST to your API before the call opens, to enrich the call context."""

    mode: Literal["disabled", "always", "inbound", "outbound"] = "disabled"
    url: Optional[str] = None
    credential_uuid: Optional[str] = None


class ApiTrigger(BaseModel):
    """Public URL that starts an outbound call with this agent."""

    enabled: bool = False
    path: Optional[str] = Field(default=None, description="Generated on save when empty.")


class WebhookHeader(BaseModel):
    key: str
    value: str


class Webhook(BaseModel):
    """Sends call results to your systems after the call."""

    id: Optional[str] = Field(default=None, description="Stable id; generated when empty.")
    name: str = "Webhook"
    enabled: bool = True
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "POST"
    url: str = ""
    credential_uuid: Optional[str] = None
    headers: list[WebhookHeader] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)


class QualityReview(BaseModel):
    """LLM review of every finished call."""

    enabled: bool = True
    system_prompt: Optional[str] = Field(default=None, description="Empty uses Dograh's default reviewer prompt.")
    min_call_duration: int = Field(default=15, ge=0)
    sample_rate: int = Field(default=100, ge=1, le=100)
    include_voicemail: bool = False


class AgentSpec(BaseModel):
    """Everything that defines how an agent behaves on a call."""

    prompt: str = ""
    greeting: Greeting = Field(default_factory=Greeting)
    allow_interrupt: bool = True
    tool_uuids: list[str] = Field(default_factory=list)
    document_uuids: list[str] = Field(default_factory=list)
    extraction: Extraction = Field(default_factory=Extraction)
    delayed_start: bool = False
    delayed_start_duration: Optional[float] = Field(default=None, ge=0.1, le=10)
    pre_call_fetch: PreCallFetch = Field(default_factory=PreCallFetch)
    api_trigger: ApiTrigger = Field(default_factory=ApiTrigger)
    webhooks: list[Webhook] = Field(default_factory=list)
    quality_review: Optional[QualityReview] = None


class CreateAgentRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    agent: AgentSpec = Field(default_factory=AgentSpec)
    settings: Optional[WorkflowConfigurationDefaults] = None
    attach_end_call_tool: bool = Field(
        default=True,
        description="Attach the workspace's shared End call tool so the agent can hang up.",
    )


class UpdateAgentRequest(BaseModel):
    """Saves a draft. ``agent`` and ``settings`` replace their stored values when sent."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    agent: Optional[AgentSpec] = None
    settings: Optional[WorkflowConfigurationDefaults] = None


class ModelSummary(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    voice: Optional[str] = None
    language: Optional[str] = None


class AgentModels(BaseModel):
    """Effective models (agent override or workspace default), without keys."""

    custom: bool
    stt: ModelSummary
    llm: ModelSummary
    tts: ModelSummary


class AgentListItem(BaseModel):
    id: int
    uuid: Optional[str]
    name: str
    status: str
    created_at: datetime
    total_runs: int
    kind: Literal["agent", "multi_step"]
    version_number: Optional[int]
    version_status: Optional[str]
    models: AgentModels


class AgentResponse(BaseModel):
    id: int
    uuid: Optional[str]
    name: str
    status: str
    created_at: datetime
    kind: Literal["agent", "multi_step"] = Field(
        description="multi_step agents were built as a graph and must be converted before editing.",
    )
    version_number: Optional[int]
    version_status: Optional[str]
    agent: AgentSpec
    settings: dict[str, Any]
    models: AgentModels
    multi_step_nodes: int = Field(default=0, description="Conversation steps in a legacy flow.")


class AgentVersion(BaseModel):
    id: int
    version_number: Optional[int]
    status: str
    created_at: datetime
    published_at: Optional[datetime]
    kind: Literal["agent", "multi_step"]
    agent: AgentSpec
    settings: dict[str, Any]


class PublishAgentResponse(BaseModel):
    id: int
    version_number: Optional[int]
    status: str
    published_at: Optional[datetime]
