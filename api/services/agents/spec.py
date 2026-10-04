"""Convert between a flat AgentSpec and Dograh's stored workflow graph.

An Awaz agent is stored as:

* exactly one ``startCall`` node holding the prompt, greeting, tools,
  documents and extraction settings (the whole conversation), and
* optional side nodes that never take part in the conversation:
  ``trigger`` (API trigger), ``webhook`` (post-call webhooks) and ``qa``
  (post-call quality review). Integration nodes (Noveum, Tuner, …) are kept
  untouched.

Graphs built with the old canvas also contain ``agentNode``, ``endCall`` and
``globalNode`` nodes joined by edges. Those are "multi-step" agents: they can
be read, and :func:`flatten` turns them into a single prompt, but they can't
be written through the agent API until converted.

Everything here is pure (no I/O), so it is unit-tested without a database.
"""

from __future__ import annotations

import copy
import uuid
from typing import Any

from api.schemas.agent import (
    AgentSpec,
    ApiTrigger,
    Extraction,
    ExtractionVariable,
    Greeting,
    PreCallFetch,
    QualityReview,
    Webhook,
    WebhookHeader,
)
from api.services.workflow.node_specs.constants import DEFAULT_QA_SYSTEM_PROMPT

START = "startCall"
MULTI_STEP_TYPES = frozenset({"agentNode", "endCall", "globalNode"})
MANAGED_SIDE_TYPES = frozenset({"trigger", "webhook", "qa"})

Definition = dict[str, Any]


class MultiStepAgentError(ValueError):
    """Raised when writing an agent whose graph still has multiple steps."""


# ── reading ──────────────────────────────────────────────────────────────


def normalize(definition: Any) -> Definition:
    d = copy.deepcopy(definition) if isinstance(definition, dict) else {}
    d["nodes"] = [n for n in d.get("nodes") or [] if isinstance(n, dict)]
    d["edges"] = [e for e in d.get("edges") or [] if isinstance(e, dict)]
    return d


def _data(node: dict | None) -> dict:
    return (node or {}).get("data") or {}


def start_node(definition: Definition) -> dict | None:
    return next((n for n in definition["nodes"] if n.get("type") == START), None)


def multi_step_count(definition: Definition) -> int:
    """Conversation steps beyond the start node (0 for a single-prompt agent)."""
    return sum(1 for n in definition["nodes"] if n.get("type") in MULTI_STEP_TYPES)


def is_multi_step(definition: Definition) -> bool:
    return multi_step_count(definition) > 0


def _str(v: Any) -> str | None:
    return v if isinstance(v, str) and v != "" else None


def _str_list(v: Any) -> list[str]:
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def read_agent(definition: Any) -> AgentSpec:
    """Read the flat agent out of a stored graph (single or multi-step)."""
    d = normalize(definition)
    s = _data(start_node(d))

    variables = []
    for v in s.get("extraction_variables") or []:
        if isinstance(v, dict) and _str(v.get("name")):
            kind = v.get("type") if v.get("type") in ("string", "number", "boolean") else "string"
            variables.append(ExtractionVariable(name=v["name"], type=kind, prompt=_str(v.get("prompt"))))

    trigger = next((n for n in d["nodes"] if n.get("type") == "trigger"), None)
    qa = next((n for n in d["nodes"] if n.get("type") == "qa"), None)
    qa_data = _data(qa)

    fetch_mode = s.get("pre_call_fetch_mode")
    duration = s.get("delayed_start_duration")

    return AgentSpec(
        prompt=s.get("prompt") or "",
        greeting=Greeting(
            type="audio" if s.get("greeting_type") == "audio" else "text",
            text=_str(s.get("greeting")),
            recording_id=_str(s.get("greeting_recording_id")),
        ),
        allow_interrupt=s.get("allow_interrupt") is not False,
        tool_uuids=_str_list(s.get("tool_uuids")),
        document_uuids=_str_list(s.get("document_uuids")),
        extraction=Extraction(
            enabled=s.get("extraction_enabled") is True,
            prompt=_str(s.get("extraction_prompt")),
            variables=variables,
        ),
        delayed_start=s.get("delayed_start") is True,
        delayed_start_duration=duration if isinstance(duration, (int, float)) and 0.1 <= duration <= 10 else None,
        pre_call_fetch=PreCallFetch(
            mode=fetch_mode if fetch_mode in ("always", "inbound", "outbound") else "disabled",
            url=_str(s.get("pre_call_fetch_url")),
            credential_uuid=_str(s.get("pre_call_fetch_credential_uuid")),
        ),
        api_trigger=ApiTrigger(
            enabled=trigger is not None and _data(trigger).get("enabled") is not False,
            path=_str(_data(trigger).get("trigger_path")),
        ),
        webhooks=[
            Webhook(
                id=n.get("id"),
                name=_data(n).get("name") or "Webhook",
                enabled=_data(n).get("enabled") is not False,
                method=_data(n).get("http_method") if _data(n).get("http_method") in ("GET", "POST", "PUT", "PATCH", "DELETE") else "POST",
                url=_data(n).get("endpoint_url") or "",
                credential_uuid=_str(_data(n).get("credential_uuid")),
                headers=[
                    WebhookHeader(key=h["key"], value=h.get("value", ""))
                    for h in _data(n).get("custom_headers") or []
                    if isinstance(h, dict) and _str(h.get("key"))
                ],
                payload=_data(n).get("payload_template") or {},
            )
            for n in d["nodes"]
            if n.get("type") == "webhook"
        ],
        quality_review=QualityReview(
            enabled=qa_data.get("qa_enabled") is not False,
            system_prompt=_str(qa_data.get("qa_system_prompt")),
            min_call_duration=qa_data.get("qa_min_call_duration") if isinstance(qa_data.get("qa_min_call_duration"), int) else 15,
            sample_rate=qa_data.get("qa_sample_rate") if isinstance(qa_data.get("qa_sample_rate"), int) and 1 <= qa_data["qa_sample_rate"] <= 100 else 100,
            include_voicemail=qa_data.get("qa_voicemail_calls") is True,
        )
        if qa
        else None,
    )


# ── writing ──────────────────────────────────────────────────────────────


def _start_data(agent: AgentSpec, previous: dict) -> dict:
    """Start-node data for ``agent``; keys this API doesn't manage are kept."""
    data = dict(previous)
    text = agent.greeting.type == "text"
    data.update(
        {
            "name": previous.get("name") or "Agent",
            "prompt": agent.prompt,
            "greeting_type": agent.greeting.type,
            "greeting": agent.greeting.text if text else None,
            "greeting_recording_id": None if text else agent.greeting.recording_id,
            "allow_interrupt": agent.allow_interrupt,
            "tool_uuids": list(dict.fromkeys(agent.tool_uuids)),
            "document_uuids": list(dict.fromkeys(agent.document_uuids)),
            "extraction_enabled": agent.extraction.enabled,
            "extraction_prompt": agent.extraction.prompt,
            "extraction_variables": [v.model_dump() for v in agent.extraction.variables],
            "delayed_start": agent.delayed_start,
            "delayed_start_duration": agent.delayed_start_duration if agent.delayed_start else None,
            "pre_call_fetch_mode": agent.pre_call_fetch.mode,
            "pre_call_fetch_url": agent.pre_call_fetch.url if agent.pre_call_fetch.mode != "disabled" else None,
            "pre_call_fetch_credential_uuid": agent.pre_call_fetch.credential_uuid if agent.pre_call_fetch.mode != "disabled" else None,
        }
    )
    return data


def _position(previous: dict | None, x: int, y: int) -> dict:
    pos = (previous or {}).get("position")
    return pos if isinstance(pos, dict) else {"x": x, "y": y}


def write_agent(agent: AgentSpec, existing: Any = None) -> Definition:
    """Store ``agent`` into a graph, keeping integration nodes and secrets.

    ``existing`` is the stored definition being edited (``None`` for a new
    agent). Raises :class:`MultiStepAgentError` if it is a multi-step graph.
    """
    d = normalize(existing)
    if is_multi_step(d):
        raise MultiStepAgentError("This agent is a multi-step flow. Convert it to a single prompt first.")

    old_start = start_node(d)
    by_id = {n.get("id"): n for n in d["nodes"]}
    old_trigger = next((n for n in d["nodes"] if n.get("type") == "trigger"), None)
    old_qa = next((n for n in d["nodes"] if n.get("type") == "qa"), None)

    nodes: list[dict] = [
        {
            "id": (old_start or {}).get("id") or "start",
            "type": START,
            "position": _position(old_start, 0, 0),
            "data": _start_data(agent, _data(old_start)),
        }
    ]

    # API trigger: keep the node (and its path) when disabled, so re-enabling
    # brings back the same URL.
    if agent.api_trigger.enabled or old_trigger:
        tdata = dict(_data(old_trigger))
        tdata.update({"name": tdata.get("name") or "API Trigger", "enabled": agent.api_trigger.enabled})
        if agent.api_trigger.path:
            tdata["trigger_path"] = agent.api_trigger.path
        nodes.append({"id": (old_trigger or {}).get("id") or "trigger", "type": "trigger", "position": _position(old_trigger, -320, 0), "data": tdata})

    for i, hook in enumerate(agent.webhooks):
        hid = hook.id or f"webhook-{uuid.uuid4().hex[:8]}"
        previous = by_id.get(hid) if by_id.get(hid, {}).get("type") == "webhook" else None
        wdata = dict(_data(previous))
        wdata.update(
            {
                "name": hook.name,
                "enabled": hook.enabled,
                "http_method": hook.method,
                "endpoint_url": hook.url,
                "credential_uuid": hook.credential_uuid,
                "custom_headers": [h.model_dump() for h in hook.headers if h.key.strip()],
                "payload_template": hook.payload,
            }
        )
        nodes.append({"id": hid, "type": "webhook", "position": _position(previous, 320, 160 * (i + 1)), "data": wdata})

    if agent.quality_review:
        q = agent.quality_review
        qdata = dict(_data(old_qa))
        qdata.update(
            {
                "name": qdata.get("name") or "QA Analysis",
                "qa_enabled": q.enabled,
                # The reviewer fails without instructions; empty means "use the default".
                "qa_system_prompt": q.system_prompt or DEFAULT_QA_SYSTEM_PROMPT,
                "qa_min_call_duration": q.min_call_duration,
                "qa_sample_rate": q.sample_rate,
                "qa_voicemail_calls": q.include_voicemail,
                "qa_use_workflow_llm": qdata.get("qa_use_workflow_llm", True),
            }
        )
        nodes.append({"id": (old_qa or {}).get("id") or "qa", "type": "qa", "position": _position(old_qa, 320, -160), "data": qdata})

    # Integration nodes (Noveum, Tuner, …) aren't managed here; keep them as-is.
    nodes.extend(n for n in d["nodes"] if n.get("type") not in MANAGED_SIDE_TYPES and n.get("type") != START)

    kept = {n["id"] for n in nodes}
    edges = [e for e in d["edges"] if e.get("source") in kept and e.get("target") in kept]
    out = {k: v for k, v in d.items() if k not in ("nodes", "edges")}
    out.update({"nodes": nodes, "edges": edges})
    return out


# ── converting old multi-step flows ──────────────────────────────────────


def flatten(definition: Any) -> Definition:
    """Collapse a multi-step graph into a single-prompt agent.

    The global prompt (if any) leads, then the start node's prompt, then each
    step's prompt as a titled section, in graph order from the start node.
    Tools and documents from every step are merged. Side nodes are kept.
    """
    d = normalize(definition)
    if not is_multi_step(d):
        return d

    start = start_node(d)
    agent = read_agent(d)
    steps = _steps_in_order(d, start)
    glob = next((n for n in d["nodes"] if n.get("type") == "globalNode"), None)

    sections: list[str] = []
    if glob and _str(_data(glob).get("prompt")):
        sections.append(_data(glob)["prompt"].strip())
    if agent.prompt.strip():
        sections.append(f"## {_data(start).get('name') or 'Opening'}\n{agent.prompt.strip()}")
    for step in steps:
        prompt = _str(_data(step).get("prompt"))
        if prompt:
            title = _data(step).get("name") or ("Ending the call" if step.get("type") == "endCall" else "Step")
            sections.append(f"## {title}\n{prompt.strip()}")

    merged = agent.model_copy(
        update={
            "prompt": "\n\n".join(sections),
            "tool_uuids": list(dict.fromkeys(agent.tool_uuids + [u for s in steps for u in _str_list(_data(s).get("tool_uuids"))])),
            "document_uuids": list(dict.fromkeys(agent.document_uuids + [u for s in steps for u in _str_list(_data(s).get("document_uuids"))])),
        }
    )
    dropped = {n.get("id") for n in d["nodes"] if n.get("type") in MULTI_STEP_TYPES}
    single = {
        **d,
        "nodes": [n for n in d["nodes"] if n.get("id") not in dropped],
        "edges": [e for e in d["edges"] if e.get("source") not in dropped and e.get("target") not in dropped],
    }
    return write_agent(merged, single)


def _steps_in_order(d: Definition, start: dict | None) -> list[dict]:
    """Conversation steps in breadth-first order from the start node; any
    unreachable steps follow in stored order."""
    by_id = {n.get("id"): n for n in d["nodes"]}
    children: dict[Any, list[Any]] = {}
    for e in d["edges"]:
        children.setdefault(e.get("source"), []).append(e.get("target"))
    order, seen, queue = [], set(), [start.get("id")] if start else []
    while queue:
        nid = queue.pop(0)
        for child in children.get(nid, []):
            if child in seen:
                continue
            seen.add(child)
            node = by_id.get(child)
            if node and node.get("type") in ("agentNode", "endCall"):
                order.append(node)
                queue.append(child)
    order.extend(n for n in d["nodes"] if n.get("type") in ("agentNode", "endCall") and n.get("id") not in seen)
    return order
