import { listAgentsApiV1AgentsGet } from "@/client";
import { providerName } from "@/lib/models";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { AgentsShell } from "./AgentsShell";

// Two panes: the agent list stays put while the editor on the right changes.
// One /agents call returns each agent's version and effective models.
export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const res = await listAgentsApiV1AgentsGet({ headers: await authHeaders() });
  ensureAuthorized(res);

  const agents = (res.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    line: [a.models.stt, a.models.llm, a.models.tts].map((m) => providerName(m.provider)).join(" · "),
    version: a.version_number,
    draft: a.version_status === "draft",
  }));

  return <AgentsShell agents={agents}>{children}</AgentsShell>;
}
