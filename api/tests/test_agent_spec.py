"""Unit tests for the flat agent <-> workflow graph conversion."""

import pytest

from api.schemas.agent import (
    AgentSpec,
    ApiTrigger,
    Extraction,
    ExtractionVariable,
    Greeting,
    QualityReview,
    Webhook,
)
from api.services.agents.spec import (
    MultiStepAgentError,
    flatten,
    is_multi_step,
    read_agent,
    start_node,
    write_agent,
)
from api.services.workflow.dto import ReactFlowDTO
from api.services.workflow.node_specs.constants import DEFAULT_QA_SYSTEM_PROMPT


def _agent(**kw) -> AgentSpec:
    base = dict(
        prompt="You are a receptionist.",
        greeting=Greeting(text="Namaste!"),
        tool_uuids=["t1"],
        extraction=Extraction(enabled=True, variables=[ExtractionVariable(name="date", prompt="Visit date")]),
    )
    base.update(kw)
    return AgentSpec(**base)


def test_new_agent_is_one_start_node_and_valid():
    d = write_agent(_agent())
    assert [n["type"] for n in d["nodes"]] == ["startCall"]
    assert d["edges"] == []
    ReactFlowDTO.model_validate(d)  # Dograh's own schema accepts it


def test_round_trip_preserves_fields():
    agent = _agent(
        allow_interrupt=False,
        api_trigger=ApiTrigger(enabled=True, path="clinic-inbound"),
        webhooks=[Webhook(id="hook-1", url="https://crm.example.com", payload={"id": "{{workflow_run_id}}"})],
        quality_review=QualityReview(system_prompt="Score politeness.", sample_rate=50),
    )
    back = read_agent(write_agent(agent))
    assert back == agent


def test_quality_review_without_prompt_gets_the_default():
    d = write_agent(_agent(quality_review=QualityReview()))
    qa = next(n for n in d["nodes"] if n["type"] == "qa")
    assert qa["data"]["qa_system_prompt"] == DEFAULT_QA_SYSTEM_PROMPT


def test_write_keeps_integration_nodes_unknown_keys_and_secrets():
    existing = {
        "nodes": [
            {"id": "s", "type": "startCall", "position": {"x": 5, "y": 5}, "data": {"name": "Hi", "prompt": "old", "mcp_tool_filters": {"x": ["a"]}}},
            {"id": "q", "type": "qa", "position": {"x": 1, "y": 1}, "data": {"qa_api_key": "sk-secret", "qa_use_workflow_llm": False}},
            {"id": "n", "type": "noveum", "position": {"x": 2, "y": 2}, "data": {"api_key": "nv"}},
        ],
        "edges": [],
    }
    d = write_agent(_agent(quality_review=QualityReview()), existing)
    by_type = {n["type"]: n for n in d["nodes"]}
    assert by_type["startCall"]["id"] == "s" and by_type["startCall"]["position"] == {"x": 5, "y": 5}
    assert by_type["startCall"]["data"]["mcp_tool_filters"] == {"x": ["a"]}
    assert by_type["qa"]["data"]["qa_api_key"] == "sk-secret"
    assert by_type["qa"]["data"]["qa_use_workflow_llm"] is False
    assert by_type["noveum"]["data"] == {"api_key": "nv"}


def test_disabling_trigger_keeps_its_path():
    d1 = write_agent(_agent(api_trigger=ApiTrigger(enabled=True, path="keep-me")))
    d2 = write_agent(_agent(api_trigger=ApiTrigger(enabled=False)), d1)
    trigger = next(n for n in d2["nodes"] if n["type"] == "trigger")
    assert trigger["data"] == {"name": "API Trigger", "enabled": False, "trigger_path": "keep-me"}


LEGACY = {
    "nodes": [
        {"id": "g", "type": "globalNode", "position": {"x": 0, "y": -200}, "data": {"name": "Persona", "prompt": "Be warm."}},
        {"id": "s", "type": "startCall", "position": {"x": 0, "y": 0}, "data": {"name": "Greeting", "prompt": "Greet the caller.", "tool_uuids": ["t1"]}},
        {"id": "e", "type": "endCall", "position": {"x": 400, "y": 0}, "data": {"name": "Goodbye", "prompt": "Say bye."}},
        {"id": "a", "type": "agentNode", "position": {"x": 200, "y": 0}, "data": {"name": "Collect", "prompt": "Get the name.", "tool_uuids": ["t2", "t1"], "document_uuids": ["d1"]}},
        {"id": "w", "type": "webhook", "position": {"x": 0, "y": 300}, "data": {"name": "CRM", "endpoint_url": "https://x"}},
    ],
    "edges": [
        {"id": "s-a", "source": "s", "target": "a", "data": {"label": "reason given"}},
        {"id": "a-e", "source": "a", "target": "e", "data": {"label": "done"}},
    ],
}


def test_multi_step_is_read_only():
    assert is_multi_step(LEGACY)
    with pytest.raises(MultiStepAgentError):
        write_agent(_agent(), LEGACY)


def test_flatten_merges_steps_in_graph_order():
    d = flatten(LEGACY)
    assert not is_multi_step(d)
    assert [n["type"] for n in d["nodes"]] == ["startCall", "webhook"]
    assert d["edges"] == []
    agent = read_agent(d)
    assert agent.prompt == "Be warm.\n\n## Greeting\nGreet the caller.\n\n## Collect\nGet the name.\n\n## Goodbye\nSay bye."
    assert agent.tool_uuids == ["t1", "t2"]
    assert agent.document_uuids == ["d1"]
    assert agent.webhooks[0].url == "https://x"
    assert start_node(d)["id"] == "s"
    ReactFlowDTO.model_validate(d)


def test_flatten_is_a_no_op_for_single_agents():
    single = write_agent(_agent())
    assert flatten(single) == single
