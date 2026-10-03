// Awaz agents are single-prompt assistants. Dograh still stores every agent as
// a graph definition ({nodes, edges}), so this module is the one place that
// knows about that format: an agent is the graph's one `startCall` node plus
// optional side nodes (API trigger, post-call webhooks, QA) that never take
// part in the conversation. Nothing else in the app should touch nodes.

export type Variable = { name: string; type: "string" | "number" | "boolean"; prompt?: string | null };

export type AgentFields = {
  prompt: string;
  greetingType: "text" | "audio";
  greeting: string;
  greetingRecordingId: string | null;
  allowInterrupt: boolean;
  toolUuids: string[];
  documentUuids: string[];
  extractionEnabled: boolean;
  extractionPrompt: string;
  variables: Variable[];
  delayedStart: boolean;
  delayedStartDuration: number | null;
};

export type Webhook = {
  id: string;
  name: string;
  enabled: boolean;
  method: string;
  url: string;
  credentialUuid: string | null;
  headers: { key: string; value: string }[];
  payload: Record<string, unknown>;
};

export type Qa = {
  enabled: boolean;
  systemPrompt: string;
  minCallDuration: number;
  sampleRate: number;
  includeVoicemail: boolean;
};

type Node = { id: string; type: string; position?: { x: number; y: number }; data: Record<string, unknown> };
type Edge = { id: string; source: string; target: string; data?: Record<string, unknown> };
export type Definition = { nodes: Node[]; edges: Edge[]; [k: string]: unknown };

// Node types that are part of the old multi-step conversation graph.
const LEGACY_CALL_NODES = new Set(["agentNode", "endCall", "globalNode"]);

export function asDefinition(raw: unknown): Definition {
  const d = (raw ?? {}) as Partial<Definition>;
  return { ...d, nodes: Array.isArray(d.nodes) ? d.nodes : [], edges: Array.isArray(d.edges) ? d.edges : [] };
}

const startNode = (d: Definition) => d.nodes.find((n) => n.type === "startCall");

/** True for agents built in the old canvas with more than one conversation step. */
export function isMultiStep(d: Definition) {
  return d.nodes.some((n) => LEGACY_CALL_NODES.has(n.type));
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function readAgent(d: Definition): AgentFields {
  const data = startNode(d)?.data ?? {};
  return {
    prompt: str(data.prompt),
    greetingType: data.greeting_type === "audio" ? "audio" : "text",
    greeting: str(data.greeting),
    greetingRecordingId: typeof data.greeting_recording_id === "string" ? data.greeting_recording_id : null,
    allowInterrupt: data.allow_interrupt !== false,
    toolUuids: strList(data.tool_uuids),
    documentUuids: strList(data.document_uuids),
    extractionEnabled: data.extraction_enabled === true,
    extractionPrompt: str(data.extraction_prompt),
    variables: Array.isArray(data.extraction_variables) ? (data.extraction_variables as Variable[]) : [],
    delayedStart: data.delayed_start === true,
    delayedStartDuration: typeof data.delayed_start_duration === "number" ? data.delayed_start_duration : null,
  };
}

function startData(a: AgentFields, previous: Record<string, unknown> = {}) {
  return {
    ...previous,
    name: (previous.name as string) || "Agent",
    prompt: a.prompt,
    greeting_type: a.greetingType,
    greeting: a.greetingType === "text" ? a.greeting || null : null,
    greeting_recording_id: a.greetingType === "audio" ? a.greetingRecordingId : null,
    allow_interrupt: a.allowInterrupt,
    tool_uuids: a.toolUuids,
    document_uuids: a.documentUuids,
    extraction_enabled: a.extractionEnabled,
    extraction_prompt: a.extractionEnabled ? a.extractionPrompt || null : previous.extraction_prompt ?? null,
    extraction_variables: a.variables.filter((v) => v.name.trim()),
    delayed_start: a.delayedStart,
    delayed_start_duration: a.delayedStart ? a.delayedStartDuration : null,
  };
}

/** Write agent fields into a definition, leaving side nodes untouched. */
export function writeAgent(d: Definition, a: AgentFields): Definition {
  const start = startNode(d);
  if (!start) return { ...d, nodes: [{ id: "start", type: "startCall", position: { x: 0, y: 0 }, data: startData(a) }, ...d.nodes] };
  return { ...d, nodes: d.nodes.map((n) => (n === start ? { ...n, data: startData(a, n.data) } : n)) };
}

export const BLANK_AGENT: AgentFields = {
  prompt: "",
  greetingType: "text",
  greeting: "",
  greetingRecordingId: null,
  allowInterrupt: true,
  toolUuids: [],
  documentUuids: [],
  extractionEnabled: false,
  extractionPrompt: "",
  variables: [],
  delayedStart: false,
  delayedStartDuration: null,
};

export function newDefinition(a: AgentFields): Definition {
  return writeAgent({ nodes: [], edges: [] }, a);
}

/**
 * Collapse an old multi-step graph into one prompt: each step's instructions
 * become a section of the system prompt, and tools and documents from every
 * step are merged. Side nodes are kept.
 */
export function flatten(d: Definition): Definition {
  const current = readAgent(d);
  const steps = d.nodes.filter((n) => n.type === "agentNode" || n.type === "endCall");
  const global = d.nodes.find((n) => n.type === "globalNode");
  const sections: string[] = [];
  if (global && str(global.data.prompt)) sections.push(str(global.data.prompt));
  sections.push(`## Opening\n${current.prompt}`);
  for (const s of steps) {
    const p = str(s.data.prompt);
    if (p) sections.push(`## ${str(s.data.name) || (s.type === "endCall" ? "Ending the call" : "Step")}\n${p}`);
  }
  const merged: AgentFields = {
    ...current,
    prompt: sections.join("\n\n"),
    toolUuids: [...new Set([...current.toolUuids, ...steps.flatMap((s) => strList(s.data.tool_uuids))])],
    documentUuids: [...new Set([...current.documentUuids, ...steps.flatMap((s) => strList(s.data.document_uuids))])],
  };
  const dropped = new Set(d.nodes.filter((n) => LEGACY_CALL_NODES.has(n.type)).map((n) => n.id));
  const kept: Definition = {
    ...d,
    nodes: d.nodes.filter((n) => !dropped.has(n.id)),
    edges: d.edges.filter((e) => !dropped.has(e.source) && !dropped.has(e.target) && !(e.source === startNode(d)?.id)),
  };
  return writeAgent(kept, merged);
}

// ── Side nodes ──────────────────────────────────────────────────────────

export function readTrigger(d: Definition) {
  const t = d.nodes.find((n) => n.type === "trigger");
  return t ? { enabled: t.data.enabled !== false, path: typeof t.data.trigger_path === "string" ? t.data.trigger_path : null } : null;
}

export function writeTrigger(d: Definition, enabled: boolean): Definition {
  const t = d.nodes.find((n) => n.type === "trigger");
  if (t) return { ...d, nodes: d.nodes.map((n) => (n === t ? { ...n, data: { ...n.data, enabled } } : n)) };
  if (!enabled) return d;
  return { ...d, nodes: [...d.nodes, { id: "trigger", type: "trigger", position: { x: -320, y: 0 }, data: { name: "API Trigger", enabled: true } }] };
}

export function readWebhooks(d: Definition): Webhook[] {
  return d.nodes
    .filter((n) => n.type === "webhook")
    .map((n) => ({
      id: n.id,
      name: str(n.data.name) || "Webhook",
      enabled: n.data.enabled !== false,
      method: str(n.data.http_method) || "POST",
      url: str(n.data.endpoint_url),
      credentialUuid: typeof n.data.credential_uuid === "string" ? n.data.credential_uuid : null,
      headers: Array.isArray(n.data.custom_headers) ? (n.data.custom_headers as { key: string; value: string }[]) : [],
      payload: (n.data.payload_template as Record<string, unknown>) ?? {},
    }));
}

export function writeWebhooks(d: Definition, hooks: Webhook[]): Definition {
  const others = d.nodes.filter((n) => n.type !== "webhook");
  const nodes = hooks.map((h, i) => ({
    id: h.id,
    type: "webhook",
    position: d.nodes.find((n) => n.id === h.id)?.position ?? { x: 320, y: 160 * (i + 1) },
    data: {
      name: h.name,
      enabled: h.enabled,
      http_method: h.method,
      endpoint_url: h.url,
      credential_uuid: h.credentialUuid,
      custom_headers: h.headers.filter((x) => x.key.trim()),
      payload_template: h.payload,
    },
  }));
  return { ...d, nodes: [...others, ...nodes] };
}

export const DEFAULT_WEBHOOK_PAYLOAD = {
  call_id: "{{workflow_run_id}}",
  outcome: "{{gathered_context.call_disposition}}",
  duration: "{{cost_info.call_duration_seconds}}",
  recording_url: "{{recording_url}}",
  transcript_url: "{{transcript_url}}",
};

export function readQa(d: Definition): Qa | null {
  const q = d.nodes.find((n) => n.type === "qa");
  if (!q) return null;
  return {
    enabled: q.data.qa_enabled !== false,
    systemPrompt: str(q.data.qa_system_prompt),
    minCallDuration: typeof q.data.qa_min_call_duration === "number" ? q.data.qa_min_call_duration : 15,
    sampleRate: typeof q.data.qa_sample_rate === "number" ? q.data.qa_sample_rate : 100,
    includeVoicemail: q.data.qa_voicemail_calls === true,
  };
}

export function writeQa(d: Definition, qa: Qa | null): Definition {
  const existing = d.nodes.find((n) => n.type === "qa");
  if (!qa) return { ...d, nodes: d.nodes.filter((n) => n.type !== "qa") };
  const data = {
    ...(existing?.data ?? {}),
    name: (existing?.data.name as string) || "QA Analysis",
    qa_enabled: qa.enabled,
    qa_system_prompt: qa.systemPrompt || null,
    qa_min_call_duration: qa.minCallDuration,
    qa_sample_rate: qa.sampleRate,
    qa_voicemail_calls: qa.includeVoicemail,
    qa_use_workflow_llm: existing?.data.qa_use_workflow_llm ?? true,
  };
  if (existing) return { ...d, nodes: d.nodes.map((n) => (n === existing ? { ...n, data } : n)) };
  return { ...d, nodes: [...d.nodes, { id: "qa", type: "qa", position: { x: 320, y: -160 }, data }] };
}
