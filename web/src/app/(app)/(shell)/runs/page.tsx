import { Activity, AudioLines, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getUsageHistoryApiV1OrganizationsUsageRunsGet, getWorkflowsApiV1WorkflowFetchGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Pager } from "@/components/app/Pager";
import { RunFilterBar } from "@/components/app/RunFilterBar";
import { Badge, Card, EmptyState, Stat, Table, td, th, tr } from "@/components/app/ui";
import { dateTime, duration, humanize, num, usd } from "@/lib/format";
import { channelOf, filterParam, parseFilters } from "@/lib/runs";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

export const metadata: Metadata = { title: "Agent runs | Awaz" };

const LIMIT = 25;

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const headers = await authHeaders();
  const [runs, agents] = await Promise.all([
    getUsageHistoryApiV1OrganizationsUsageRunsGet({ headers, query: { page, limit: LIMIT, filters: filterParam(parseFilters(sp)) } }),
    getWorkflowsApiV1WorkflowFetchGet({ headers }),
  ]);
  ensureAuthorized(runs);
  const data = runs.data;
  const list = data?.runs ?? [];
  const spend = list.reduce((n, r) => n + (r.charge_usd ?? 0), 0);

  return (
    <>
      <PageHeader title="Agent runs" sub="Every call and chat your agents have handled." />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Calls" value={num(data?.total_count ?? 0)} note="Matching the filters" />
          <Stat label="Talk time" value={`${num(Math.round((data?.total_duration_seconds ?? 0) / 60))} min`} />
          <Stat label="Charges on this page" value={usd(spend)} note={spend ? undefined : "No pricing configured"} />
        </div>

        <Card>
          <div className="border-b border-border px-5 py-3">
            <RunFilterBar agents={(agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))} />
          </div>
          {list.length ? (
            <>
              <Table
                head={
                  <tr>
                    <th className={th}>Call</th>
                    <th className={th}>Agent</th>
                    <th className={`${th} hidden lg:table-cell`}>Channel</th>
                    <th className={`${th} hidden md:table-cell`}>Number</th>
                    <th className={th}>Duration</th>
                    <th className={`${th} hidden sm:table-cell`}>Outcome</th>
                    <th className={`${th} w-10`} />
                  </tr>
                }
              >
                {list.map((r) => {
                  const ch = channelOf(r.mode);
                  const number = r.call_type === "inbound" ? r.caller_number : (r.called_number ?? r.phone_number);
                  const href = `/runs/${r.workflow_id}/${r.id}`;
                  return (
                    <tr key={r.id} className={`${tr} group`}>
                      <td className={td}>
                        <Link href={href} className="block">
                          <span className="flex items-center gap-1.5 text-foreground">
                            #{r.id}
                            {r.recording_url ? <AudioLines className="size-3.5 text-muted-foreground/70" aria-label="Has recording" /> : null}
                          </span>
                          <span className="text-[12px] text-muted-foreground">{dateTime(r.created_at)}</span>
                        </Link>
                      </td>
                      <td className={td}>
                        <Link href={`/agents/${r.workflow_id}`} className="text-foreground/80 hover:text-foreground hover:underline">
                          {r.workflow_name ?? `Agent ${r.workflow_id}`}
                        </Link>
                      </td>
                      <td className={`${td} hidden text-muted-foreground lg:table-cell`}>
                        {ch.label}
                        {r.call_type ? <span className="text-muted-foreground/70"> · {r.call_type}</span> : null}
                      </td>
                      <td className={`${td} hidden font-mono text-[12.5px] text-muted-foreground md:table-cell`}>{number ?? "–"}</td>
                      <td className={`${td} tabular-nums text-foreground/80`}>{duration(r.call_duration_seconds)}</td>
                      <td className={`${td} hidden sm:table-cell`}>{r.disposition ? <Badge>{humanize(r.disposition)}</Badge> : <span className="text-muted-foreground/70">–</span>}</td>
                      <td className={td}>
                        <Link href={href} aria-label={`Open call ${r.id}`} className="text-muted-foreground/70 transition group-hover:text-foreground">
                          <ChevronRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pager page={page} totalPages={data?.total_pages ?? 1} path="/runs" params={sp} />
            </>
          ) : (
            <EmptyState icon={Activity} title="No runs found" body="Calls show up here as soon as they start. Try the Test button on an agent." />
          )}
        </Card>
      </PageBody>
    </>
  );
}
