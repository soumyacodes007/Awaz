import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  getUsageHistoryApiV1OrganizationsUsageRunsGet,
  getWorkflowRunsApiV1WorkflowWorkflowIdRunsGet,
  getWorkflowsApiV1WorkflowFetchGet,
  type WorkflowRunUsageResponse,
} from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Card, CardHeader, EmptyState, Stat } from "@/components/app/ui";
import { duration, humanize, num } from "@/lib/format";
import { eventsOf, STAGE_COLOR, STAGE_LABEL, STAGES, summarize } from "@/lib/latency";
import { channelOf, filterParam } from "@/lib/runs";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { RangePicker } from "./RangePicker";

export const metadata: Metadata = { title: "Metrics | Awaz" };

const RANGES = { "7d": 7, "14d": 14, "30d": 30 } as const;
type Range = keyof typeof RANGES;
const MAX_PAGES = 5; // up to 500 runs per range; plenty for a dashboard

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function Bars({ data }: { data: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-44 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.label} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
          <div
            className="w-full rounded-t-md bg-primary transition-colors group-hover:bg-primary/70"
            style={{ height: `${Math.max(d.value ? 4 : 0, (d.value / max) * 100)}%` }}
            title={`${d.label}: ${d.value}`}
          />
          <span className="mt-1.5 truncate text-center text-[10.5px] text-muted-foreground/70">{d.sub ?? d.label}</span>
        </div>
      ))}
    </div>
  );
}

function Distribution({ rows }: { rows: { label: string; count: number }[] }) {
  const total = rows.reduce((n, r) => n + r.count, 0) || 1;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-[13px]">
            <span className="truncate text-foreground/80">{r.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {r.count} · {Math.round((r.count / total) * 100)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.count / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const countBy = (runs: WorkflowRunUsageResponse[], key: (r: WorkflowRunUsageResponse) => string) => {
  const m = new Map<string, number>();
  for (const r of runs) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};

export default async function MetricsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const range: Range = typeof sp.range === "string" && sp.range in RANGES ? (sp.range as Range) : "7d";
  const days = RANGES[range];
  const agent = typeof sp.agent === "string" ? Number(sp.agent) : null;
  const headers = await authHeaders();

  const start = new Date(Date.now() - (days - 1) * 86400000);
  const filters = filterParam({ agent, from: dayKey(start) });

  const first = await getUsageHistoryApiV1OrganizationsUsageRunsGet({ headers, query: { page: 1, limit: 100, filters } });
  ensureAuthorized(first);
  const pages = Math.min(first.data?.total_pages ?? 1, MAX_PAGES);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      getUsageHistoryApiV1OrganizationsUsageRunsGet({ headers, query: { page: i + 2, limit: 100, filters } }).then((r) => r.data?.runs ?? []),
    ),
  );
  const runs = [...(first.data?.runs ?? []), ...rest.flat()];
  const agents = (await getWorkflowsApiV1WorkflowFetchGet({ headers, query: { status: "active" } })).data ?? [];

  // Measured latency per agent, from each agent's 25 most recent calls.
  const latencyAgents = (agent ? agents.filter((a) => a.id === agent) : agents.filter((a) => a.total_runs > 0)).slice(0, 10);
  const latency = await Promise.all(
    latencyAgents.map(async (a) => {
      const r = await getWorkflowRunsApiV1WorkflowWorkflowIdRunsGet({ headers, path: { workflow_id: a.id }, query: { page: 1, limit: 25 } });
      return { agent: a, summary: summarize((r.data?.runs ?? []).flatMap((x) => eventsOf(x.logs))) };
    }),
  );

  const perDay = Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    const key = dayKey(d);
    return {
      label: key,
      sub: days <= 14 || i % 3 === 0 ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "",
      value: runs.filter((r) => dayKey(new Date(r.created_at)) === key).length,
    };
  });
  const seconds = runs.reduce((n, r) => n + (r.call_duration_seconds ?? 0), 0);
  const answered = runs.filter((r) => (r.call_duration_seconds ?? 0) > 5).length;

  return (
    <>
      <PageHeader title="Metrics" sub="How your agents are doing: volume, outcomes and measured latency." actions={<RangePicker agents={agents.map((a) => ({ id: a.id, name: a.name }))} />} />
      <PageBody>
        {runs.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Calls" value={num(first.data?.total_count ?? runs.length)} note={`Last ${days} days`} />
              <Stat label="Talk time" value={`${num(Math.round(seconds / 60))} min`} />
              <Stat label="Average call" value={duration(runs.length ? seconds / runs.length : 0)} />
              <Stat label="Connected" value={`${Math.round((answered / runs.length) * 100)}%`} note="Calls longer than 5 seconds" />
            </div>

            <Card>
              <CardHeader title="Calls per day" />
              <div className="p-5">
                <Bars data={perDay} />
              </div>
            </Card>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card>
                <CardHeader title="Outcomes" />
                <div className="p-5">
                  <Distribution rows={countBy(runs, (r) => (r.disposition ? humanize(r.disposition) : "Not classified"))} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Channels" />
                <div className="p-5">
                  <Distribution rows={countBy(runs, (r) => `${channelOf(r.mode).label}${r.call_type ? ` · ${r.call_type}` : ""}`)} />
                </div>
              </Card>
              <Card>
                <CardHeader title="By agent" />
                <div className="p-5">
                  <Distribution rows={countBy(runs, (r) => r.workflow_name ?? `Agent ${r.workflow_id}`)} />
                </div>
              </Card>
            </div>

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
                  <div className="flex gap-4 px-5 py-3 text-[12px] text-muted-foreground">
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
        ) : (
          <Card>
            <EmptyState icon={BarChart3} title="No calls in this period" body="Metrics fill in as your agents take calls." />
          </Card>
        )}
      </PageBody>
    </>
  );
}
