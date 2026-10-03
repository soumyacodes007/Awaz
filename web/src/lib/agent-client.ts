// Browser-side agent operations shared by the agent list and onboarding.

import { createToolApiV1ToolsPost, createWorkflowApiV1WorkflowCreateDefinitionPost, listToolsApiV1ToolsGet } from "@/client";

import { BLANK_AGENT, newDefinition } from "./agent";
import { apiError } from "./errors";

/**
 * A single-prompt agent can only hang up through a tool, so every workspace
 * gets one shared "End call" tool. Returns its uuid, creating it if needed.
 */
export async function ensureEndCallTool(): Promise<string | null> {
  const list = await listToolsApiV1ToolsGet({ query: { category: "end_call" } }).catch(() => null);
  const existing = (list?.data ?? []).find((t) => t.category === "end_call" && t.status === "active");
  if (existing) return existing.tool_uuid;
  const created = await createToolApiV1ToolsPost({
    body: {
      name: "End call",
      description: "Hang up once the conversation is complete or the caller says goodbye.",
      category: "end_call",
      icon: "phone-off",
      definition: { type: "end_call", config: { messageType: "none", endCallReason: true } },
    },
  }).catch(() => null);
  return created?.data?.tool_uuid ?? null;
}

export async function createAgent(name: string, prompt: string, greeting: string) {
  const endCall = await ensureEndCallTool();
  const res = await createWorkflowApiV1WorkflowCreateDefinitionPost({
    body: {
      name,
      workflow_definition: newDefinition({ ...BLANK_AGENT, prompt, greeting, toolUuids: endCall ? [endCall] : [] }),
    },
  }).catch(() => null);
  if (!res?.data) return { error: apiError(res?.error, "Couldn't create the agent. Is the backend running?") };
  return { id: res.data.id };
}
