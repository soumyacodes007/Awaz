// Browser-side agent creation, shared by the agent list and onboarding. The
// backend attaches the workspace's End call tool so new agents can hang up.

import { createAgentApiV1AgentsPost } from "@/client";

import { apiError } from "./errors";

export async function createAgent(name: string, prompt: string, greeting: string) {
  const res = await createAgentApiV1AgentsPost({
    body: { name, agent: { prompt, greeting: { type: "text", text: greeting } }, attach_end_call_tool: true },
  }).catch(() => null);
  if (!res?.data) return { error: apiError(res?.error, "Couldn't create the agent. Is the backend running?") };
  return { id: res.data.id };
}
