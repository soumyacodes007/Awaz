import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getUsageHistoryApiV1OrganizationsUsageRunsGet, getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet, getWorkflowsApiV1WorkflowFetchGet } from "@/client";
import { PageHeader } from "@/components/app/PageHeader";
import { RunFilterBar } from "@/components/app/RunFilterBar";
import { Card, EmptyState } from "@/components/app/ui";
import { ago, duration } from "@/lib/format";
import { eventsOf } from "@/lib/latency";
import { channelOf, filterParam, parseFilters } from "@/lib/runs";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { EventLog } from "./EventLog";

export const metadata: Metadata = { title: "Logs | Awaz" };

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const headers = await authHeaders();
  const [runs, agents] = await Promise.all([
    getUsageHistoryApiV1OrganizationsUsageRunsGet({ headers, query: { page: 1, limit: 40, filters: filterParam(parseFilters(sp)) } }),
    getWorkflowsApiV1WorkflowFetchGet({ headers }),
  ]);
  ensureAuthorized(runs);
  const list = runs.data?.runs ?? [];

  const runParam = typeof sp.run === "string" ? Number(sp.run) : null;
  const selected = list.find((r) => r.id === runParam) ?? (runParam ? null : list[0]) ?? null;
  const selectedWorkflow = selected?.workflow_id ?? (typeof sp.agent === "string" ? Number(sp.agent) : null);
  const selectedId = selected?.id ?? runParam;
  const detail =
    selectedId && selectedWorkflow
      ? await getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet({ headers, path: { workflow_id: selectedWorkflow, run_id: selectedId } })
      : null;

  const link = (id: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "run") q.set(k, v);
    q.set("run", String(id));
    return `/logs?${q}`;
  };

  return (
    <>
      <PageHeader title="Logs" sub="Every event inside a call: speech, tool calls, per-stage latency and errors." />
      <div className="space-y-4 px-6 py-5 sm:px-8">
        <RunFilterBar agents={(agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))} show={["agent", "channel", "date"]} />
        {list.length || detail?.data ? (
          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Card className="max-h-[72vh] overflow-y-auto p-1.5">
              <ul className="space-y-0.5">
                {list.map((r) => {
                  const on = r.id === selectedId;
                  return (
                    <li key={r.id}>
                      <Link
                        href={link(r.id)}
                        scroll={false}
                        className={`block rounded-md px-3 py-2.5 transition ${on ? "bg-muted border border-foreground/20" : "hover:bg-accent"}`}
                      >
                        <span className="flex items-center justify-between text-[13.5px] text-foreground">
                          <span className="truncate">{r.workflow_name ?? `Agent ${r.workflow_id}`}</span>
                          <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">#{r.id}</span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between text-[12px] text-muted-foreground">
                          <span>
                            {channelOf(r.mode).label} · {duration(r.call_duration_seconds)}
                          </span>
                          <span>{ago(r.created_at)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <div className="min-w-0">
              {detail?.data ? (
                <EventLog
                  key={detail.data.id}
                  runId={detail.data.id}
                  workflowId={detail.data.workflow_id}
                  startedAt={detail.data.created_at}
                  events={eventsOf(detail.data.logs)}
                  telephony={((detail.data.logs as Record<string, unknown> | null)?.telephony_status_callbacks as Record<string, unknown>[] | undefined) ?? []}
                />
              ) : (
                <Card>
                  <EmptyState icon={ScrollText} title="Pick a call" body="Choose a call on the left to see its events." />
                </Card>
              )}
            </div>
          </div>
        ) : (
          <Card>
            <EmptyState icon={ScrollText} title="No calls yet" body="Logs appear here for every call and test chat." />
          </Card>
        )}
      </div>
    </>
  );
}
