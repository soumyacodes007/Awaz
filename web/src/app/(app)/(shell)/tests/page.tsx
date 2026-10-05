import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getTestConfigApiV1AgentTestsConfigGet, listAgentsApiV1AgentsGet, listRunsApiV1AgentsAgentIdTestRunsGet, listTestsApiV1AgentsAgentIdTestsGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { btn, Card, EmptyState } from "@/components/app/ui";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { AgentPicker } from "./AgentPicker";
import { TestsView } from "./TestsView";

export const metadata: Metadata = { title: "Tests | Awaz" };

export default async function TestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const headers = await authHeaders();
  const agentsRes = await listAgentsApiV1AgentsGet({ headers });
  ensureAuthorized(agentsRes);
  const agents = agentsRes.data ?? [];

  const asked = typeof sp.agent === "string" ? Number(sp.agent) : null;
  const agent = agents.find((a) => a.id === asked) ?? agents.find((a) => a.kind === "agent") ?? agents[0];

  const header = (
    <PageHeader
      title="Tests"
      sub="A simulated caller talks to your agent's draft, then an AI judge grades every behavior you expect."
      actions={agent ? <AgentPicker agents={agents.map((a) => ({ id: a.id, name: a.name, multiStep: a.kind === "multi_step" }))} value={agent.id} /> : null}
    />
  );

  if (!agent) {
    return (
      <>
        {header}
        <PageBody>
          <Card>
            <EmptyState
              icon={FlaskConical}
              title="Create an agent first"
              body="Tests run against an agent's draft. Build one, then come back to test it."
              action={
                <Link href="/agents" className={btn("primary")}>
                  Go to agents
                </Link>
              }
            />
          </Card>
        </PageBody>
      </>
    );
  }

  const [tests, runs, config] = await Promise.all([
    listTestsApiV1AgentsAgentIdTestsGet({ headers, path: { agent_id: agent.id } }),
    listRunsApiV1AgentsAgentIdTestRunsGet({ headers, path: { agent_id: agent.id } }),
    getTestConfigApiV1AgentTestsConfigGet({ headers }),
  ]);

  return (
    <>
      {header}
      <PageBody>
        <TestsView
          key={agent.id}
          agent={{ id: agent.id, name: agent.name, multiStep: agent.kind === "multi_step", version: agent.version_number }}
          initialTests={tests.data ?? []}
          initialRuns={runs.data ?? []}
          config={config.data ?? null}
          openRun={typeof sp.run === "string" ? Number(sp.run) : null}
        />
      </PageBody>
    </>
  );
}
