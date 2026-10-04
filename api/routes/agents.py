"""Agents API: single-prompt agents without nodes or edges.

Each agent is still one Dograh workflow (same table, same versioning, same
runtime). These routes translate between the flat :class:`AgentSpec` and the
stored graph with :mod:`api.services.agents.spec`, then delegate storage,
validation and publishing to the workflow routes so every existing check
(trigger paths, tool-name collisions, model-key validation, masked-secret
merging) still applies.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger

from api.db import db_client
from api.db.models import UserModel
from api.routes import workflow as workflow_routes
from api.schemas.agent import (
    AgentListItem,
    AgentModels,
    AgentResponse,
    AgentVersion,
    CreateAgentRequest,
    ModelSummary,
    PublishAgentResponse,
    UpdateAgentRequest,
)
from api.schemas.ai_model_configuration import (
    OrganizationAIModelConfigurationV2,
    compile_ai_model_configuration_v2,
)
from api.schemas.tool import CreateToolRequest
from api.schemas.workflow_configurations import WorkflowConfigurationDefaults
from api.sdk_expose import sdk_expose
from api.services.agents.spec import (
    MultiStepAgentError,
    flatten,
    is_multi_step,
    multi_step_count,
    normalize,
    read_agent,
    write_agent,
)
from api.services.auth.depends import get_user
from api.services.configuration.ai_model_configuration import (
    WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY,
    get_resolved_ai_model_configuration,
)
from api.services.configuration.masking import mask_workflow_configurations
from api.services.tool_management import create_tool_for_user
from api.services.workflow.dto import sanitize_workflow_definition

router = APIRouter(prefix="/agents", tags=["agents"])

END_CALL_TOOL = {
    "name": "End call",
    "description": "Hang up once the conversation is complete or the caller says goodbye.",
    "category": "end_call",
    "icon": "phone-off",
    "definition": {"type": "end_call", "config": {"messageType": "none", "endCallReason": True}},
}


# ── helpers ──────────────────────────────────────────────────────────────


async def _load(workflow_id: int, user: UserModel):
    """The workflow and the version an editor works on (draft, else published)."""
    workflow = await db_client.get_workflow(workflow_id, organization_id=user.selected_organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail=f"Agent {workflow_id} not found")
    draft = await db_client.get_draft_version(workflow_id)
    return workflow, draft or workflow.released_definition


def _summary(service) -> ModelSummary:
    if service is None:
        return ModelSummary()
    get = lambda name: getattr(service, name, None)  # noqa: E731
    provider = get("provider")
    return ModelSummary(
        provider=getattr(provider, "value", provider),
        model=get("model"),
        voice=get("voice"),
        language=get("language"),
    )


def _models(configs: Optional[dict], org_effective) -> AgentModels:
    """Effective models: the agent's own override, else the workspace default."""
    override = (configs or {}).get(WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY)
    effective = org_effective
    if override:
        try:
            effective = compile_ai_model_configuration_v2(OrganizationAIModelConfigurationV2.model_validate(override))
        except Exception as exc:  # a broken override shouldn't break listing
            logger.warning(f"Invalid agent model override: {exc}")
    return AgentModels(
        custom=bool(override),
        stt=_summary(getattr(effective, "stt", None)),
        llm=_summary(getattr(effective, "llm", None)),
        tts=_summary(getattr(effective, "tts", None)),
    )


async def _org_effective(user: UserModel):
    return (await get_resolved_ai_model_configuration(organization_id=user.selected_organization_id)).effective


async def _response(workflow, version, user: UserModel, org_effective=None) -> AgentResponse:
    definition = normalize(version.workflow_json if version else {})
    configs = (version.workflow_configurations if version else None) or {}
    return AgentResponse(
        id=workflow.id,
        uuid=workflow.workflow_uuid,
        name=workflow.name,
        status=workflow.status,
        created_at=workflow.created_at,
        kind="multi_step" if is_multi_step(definition) else "agent",
        version_number=version.version_number if version else None,
        version_status=version.status if version else None,
        agent=read_agent(definition),
        settings=mask_workflow_configurations(configs) or {},
        models=_models(configs, org_effective if org_effective is not None else await _org_effective(user)),
        multi_step_nodes=multi_step_count(definition),
    )


async def _end_call_tool_uuid(user: UserModel) -> Optional[str]:
    tools = await db_client.get_tools_for_organization(user.selected_organization_id, status="active", category="end_call")
    if tools:
        return tools[0].tool_uuid
    try:
        created = await create_tool_for_user(CreateToolRequest.model_validate(END_CALL_TOOL), user, source="api")
        return created.tool_uuid
    except Exception as exc:
        logger.warning(f"Couldn't create the End call tool: {exc}")
        return None


async def _save(workflow_id: int, user: UserModel, *, name=None, definition=None, settings=None):
    """Save a draft through the workflow route so all its validation runs."""
    request = workflow_routes.UpdateWorkflowRequest(
        name=name,
        workflow_definition=definition,
        workflow_configurations=settings,
    )
    await workflow_routes.update_workflow(workflow_id, request, user)


def _settings_model(settings: dict | WorkflowConfigurationDefaults | None):
    if settings is None or isinstance(settings, WorkflowConfigurationDefaults):
        return settings
    return WorkflowConfigurationDefaults.model_validate(settings)


# ── routes ───────────────────────────────────────────────────────────────


@router.get("", **sdk_expose(method="list_agents", description="List agents with their versions and effective models."))
async def list_agents(
    status: str = Query("active", pattern="^(active|archived)$"),
    user: UserModel = Depends(get_user),
) -> list[AgentListItem]:
    workflows = await db_client.get_all_workflows_for_listing(organization_id=user.selected_organization_id, status=status)
    counts = await db_client.get_workflow_run_counts([w.id for w in workflows])
    org_effective = await _org_effective(user)
    items = []
    for w in sorted(workflows, key=lambda w: w.created_at, reverse=True):
        _, version = await _load(w.id, user)
        definition = normalize(version.workflow_json if version else {})
        configs = (version.workflow_configurations if version else None) or {}
        items.append(
            AgentListItem(
                id=w.id,
                uuid=w.workflow_uuid,
                name=w.name,
                status=w.status,
                created_at=w.created_at,
                total_runs=counts.get(w.id, 0),
                kind="multi_step" if is_multi_step(definition) else "agent",
                version_number=version.version_number if version else None,
                version_status=version.status if version else None,
                models=_models(configs, org_effective),
            )
        )
    return items


@router.post("", **sdk_expose(method="create_agent", description="Create a single-prompt agent."))
async def create_agent(request: CreateAgentRequest, user: UserModel = Depends(get_user)) -> AgentResponse:
    agent = request.agent
    if request.attach_end_call_tool:
        uuid = await _end_call_tool_uuid(user)
        if uuid and uuid not in agent.tool_uuids:
            agent = agent.model_copy(update={"tool_uuids": [*agent.tool_uuids, uuid]})

    created = await workflow_routes.create_workflow(
        workflow_routes.CreateWorkflowRequest(name=request.name, workflow_definition=write_agent(agent)),
        user,
    )
    if request.settings is not None:
        await _save(created["id"], user, settings=request.settings)
    workflow, version = await _load(created["id"], user)
    return await _response(workflow, version, user)


@router.get("/{agent_id}", **sdk_expose(method="get_agent", description="Get an agent (its draft if one exists)."))
async def get_agent(agent_id: int, user: UserModel = Depends(get_user)) -> AgentResponse:
    workflow, version = await _load(agent_id, user)
    return await _response(workflow, version, user)


@router.put("/{agent_id}", **sdk_expose(method="update_agent", description="Save changes to an agent as a draft."))
async def update_agent(agent_id: int, request: UpdateAgentRequest, user: UserModel = Depends(get_user)) -> AgentResponse:
    _, version = await _load(agent_id, user)
    definition = None
    if request.agent is not None:
        # Work from the stored, unmasked graph so integration nodes and their
        # secrets survive; the workflow route merges any masked values back.
        try:
            definition = write_agent(request.agent, version.workflow_json if version else None)
        except MultiStepAgentError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _save(agent_id, user, name=request.name, definition=definition, settings=request.settings)
    workflow, version = await _load(agent_id, user)
    return await _response(workflow, version, user)


@router.post("/{agent_id}/publish", **sdk_expose(method="publish_agent", description="Publish an agent's draft."))
async def publish_agent(agent_id: int, user: UserModel = Depends(get_user)) -> PublishAgentResponse:
    published = await workflow_routes.publish_workflow(agent_id, user)
    return PublishAgentResponse(**published)


@router.post("/{agent_id}/convert", **sdk_expose(method="convert_agent", description="Turn a multi-step flow into a single-prompt agent (saved as a draft)."))
async def convert_agent(agent_id: int, user: UserModel = Depends(get_user)) -> AgentResponse:
    workflow, version = await _load(agent_id, user)
    definition = normalize(version.workflow_json if version else {})
    if not is_multi_step(definition):
        return await _response(workflow, version, user)
    await _save(agent_id, user, definition=sanitize_workflow_definition(flatten(definition)))
    workflow, version = await _load(agent_id, user)
    return await _response(workflow, version, user)


@router.get("/{agent_id}/versions", **sdk_expose(method="list_agent_versions", description="Every saved version of an agent, newest first."))
async def list_agent_versions(agent_id: int, user: UserModel = Depends(get_user)) -> list[AgentVersion]:
    await _load(agent_id, user)
    versions = await db_client.get_workflow_versions(agent_id)
    out = []
    for v in versions:
        definition = normalize(v.workflow_json)
        out.append(
            AgentVersion(
                id=v.id,
                version_number=v.version_number,
                status=v.status,
                created_at=v.created_at,
                published_at=v.published_at,
                kind="multi_step" if is_multi_step(definition) else "agent",
                agent=read_agent(definition),
                settings=mask_workflow_configurations(v.workflow_configurations or {}) or {},
            )
        )
    return out
