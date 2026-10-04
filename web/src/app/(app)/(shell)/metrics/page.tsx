import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getMetricsApiV1MetricsGet, getWorkflowRunsApiV1WorkflowWorkflowIdRunsGet, listAgentsApiV1AgentsGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Card, CardHeader, EmptyState } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { eventsOf, STAGE_COLOR, STAGE_LABEL, STAGES, summarize } from "@/lib/latency";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { MetricsView } from "./MetricsView";
import { RangePicker } from "./RangePicker";
import { defaultGroup, type Group, GROUPS, groupAllowed, RANGES, type Range, TIMEZONE } from "./ranges";

export const metadata: Metadata = { title: "Metrics | Awaz" };

export default async function MetricsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const range: Range = typeof sp.range === "string" && sp.range in RANGES ? (sp.range as Range) : "30d";
  const asked = typeof sp.group === "string" && (GROUPS as readonly string[]).includes(sp.group) ? (sp.group as Group) : null;
  const group: Group = asked && groupAllowed(range, asked) ? asked : defaultGroup(range);
  const agent = typeof sp.agent === "string" && /^\d+$/.test(sp.agent) ? Number(sp.agent) : null;
  const headers = await authHeaders();

  const end = new Date();
  const start = new Date(end.getTime() - RANGES[range].hours * 3600_000);
  const [res, agentsRes] = await Promise.all([
    getMetricsApiV1MetricsGet({
      headers,
      query: { start_at: start.toISOString(), end_at: end.toISOString(), group_by: group, timezone: TIMEZONE, workflow_ids: agent ? [agent] : [] },
    }),
    listAgentsApiV1AgentsGet({ headers }),
  ]);
  ensureAuthorized(res);
  const agents = agentsRes.data ?? [];
  const metrics = res.data;

  // Measured latency per agent, from each agent's 25 most recent calls.
  const latencyAgents = (agent ? agents.filter((a) => a.id === agent) : agents.filter((a) => metrics?.agents.some((m) => m.workflow_id === a.id))).slice(0, 10);
  const latency = await Promise.all(
    latencyAgents.map(async (a) => {
      const r = await getWorkflowRunsApiV1WorkflowWorkflowIdRunsGet({ headers, path: { workflow_id: a.id }, query: { page: 1, limit: 25 } });
      return { agent: a, summary: summarize((r.data?.runs ?? []).flatMap((x) => eventsOf(x.logs))) };
    }),
  );

  return (
    <>
      <PageHeader title="Metrics" sub="Volume, spend, outcomes and quality across your agents." actions={<RangePicker agents={agents.map((a) => ({ id: a.id, name: a.name }))} range={range} group={group} />} />
      <PageBody>
        {!metrics ? (
          <Card>
            <EmptyState icon={BarChart3} title="Couldn't load metrics" body={apiError(res.error, "Is the backend running?")} />
          </Card>
        ) : metrics.totals.calls === 0 ? (
          <Card>
            <EmptyState icon={BarChart3} title="No calls in this period" body="Metrics fill in as your agents take calls and chats." />
          </Card>
        ) : (
          <>
            <MetricsView metrics={metrics} />

            <Card>
              <CardHeader title="Measured latency" sub="Median time to first byte per stage, from each agent's last 25 calls." />
              {latency.some((l) => l.summary.samples) ? (
                <div className="divide-y divide-border">
                  {latency
                    .filter((l) => l.summary.samples)
                    .map(({ agent: a, summary }) => (
                      <div key={a.id} className="grid items-center gap-3 px-5 py-3.5 sm:grid-cols-[200px_minmax(0,1fr)_90px]">
                        <Link href={`/agents/${a.id}`} className="truncate text-[14px] text-foreground hover:underline">
                          {a.name}
                        </Link>
                        <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-muted">
                          {STAGES.map((s) =>
                            summary[s] ? (
                              <span key={s} title={`${STAGE_LABEL[s]} ${summary[s]} ms`} style={{ width: `${(summary[s]! / 3000) * 100}%`, background: STAGE_COLOR[s] }} />
                            ) : null,
                          )}
                        </div>
                        <span className="text-right text-[14px] text-foreground tabular-nums">{summary.total} ms</span>
                      </div>
                    ))}
                  <div className="flex flex-wrap gap-4 px-5 py-3 text-[12px] text-muted-foreground">
                    {STAGES.map((s) => (
                      <span key={s} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: STAGE_COLOR[s] }} /> {STAGE_LABEL[s]}
                      </span>
                    ))}
                    <span className="ml-auto">Scale: 3 seconds</span>
                  </div>
                </div>
              ) : (
                <p className="px-5 py-6 text-[13px] text-muted-foreground">No latency measurements yet. Voice calls record them automatically.</p>
              )}
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
