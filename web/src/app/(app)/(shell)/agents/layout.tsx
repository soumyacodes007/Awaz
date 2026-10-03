import {
  getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get,
  getWorkflowApiV1WorkflowFetchWorkflowIdGet,
  getWorkflowsApiV1WorkflowFetchGet,
} from "@/client";
import { agentOverride, effectiveOf, type Effective, providerName, type Service } from "@/lib/models";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { AgentsShell } from "./AgentsShell";

// Detail fetches give each list row its provider line and version badge.
const MAX_DETAILED = 60;

// Two panes: the agent list stays put while the editor on the right changes.
export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const headers = await authHeaders();
  const [res, model] = await Promise.all([
    getWorkflowsApiV1WorkflowFetchGet({ headers, query: { status: "active" } }),
    getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get({ headers }),
  ]);
  ensureAuthorized(res);
  const orgEffective = (model.data?.effective_configuration ?? {}) as Effective;
  const list = [...(res.data ?? [])].sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));

  const details = await Promise.all(
    list.slice(0, MAX_DETAILED).map((a) => getWorkflowApiV1WorkflowFetchWorkflowIdGet({ headers, path: { workflow_id: a.id } }).then((r) => r.data ?? null)),
  );

  const agents = list.map((a, i) => {
    const d = details[i];
    const override = d ? agentOverride(d.workflow_configurations as Record<string, unknown>) : null;
    const eff = (override ? effectiveOf(override) : null) ?? orgEffective;
    const line = (["stt", "llm", "tts"] as Service[]).map((s) => providerName(eff[s]?.provider)).join(" · ");
    return { id: a.id, name: a.name, line, version: d?.version_number ?? null, draft: d?.version_status === "draft" };
  });

  return <AgentsShell agents={agents}>{children}</AgentsShell>;
}
