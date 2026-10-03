import { ArrowUpRight, Bot, Check, ChevronRight, Clock, KeyRound, Megaphone, Phone, PhoneCall, Radio, Wallet, Wrench, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  getApiKeysApiV1UserApiKeysGet,
  getCurrentPeriodUsageApiV1OrganizationsUsageCurrentPeriodGet,
  getCurrentUserApiV1AuthMeGet,
  getOrganizationConcurrentCallsApiV1OrganizationsConcurrentCallsGet,
  getUsageHistoryApiV1OrganizationsUsageRunsGet,
  getWorkflowCountApiV1WorkflowCountGet,
  getWorkflowsApiV1WorkflowFetchGet,
  listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
} from "@/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge, Card, CardHeader } from "@/components/app/ui";
import { ago, duration, humanize, num, shortDate, usd } from "@/lib/format";
import { channelOf } from "@/lib/runs";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { NewAgentButton } from "../agents/AgentList";

export const metadata: Metadata = { title: "Home | Awaz" };

function Stat({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-white p-5 border transition-[transform,box-shadow] duration-300 motion-reduce:transform-none">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
        {label}
      </div>
      <p className="mt-3 text-[30px] leading-none font-semibold tracking-tight text-foreground">{value}</p>
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export default async function HomePage() {
  const headers = await authHeaders();
  const [me, count, usage, live, agents, runs, telephony, keys] = await Promise.all([
    getCurrentUserApiV1AuthMeGet({ headers }),
    getWorkflowCountApiV1WorkflowCountGet({ headers }),
    getCurrentPeriodUsageApiV1OrganizationsUsageCurrentPeriodGet({ headers }),
    getOrganizationConcurrentCallsApiV1OrganizationsConcurrentCallsGet({ headers }),
    getWorkflowsApiV1WorkflowFetchGet({ headers, query: { status: "active" } }),
    getUsageHistoryApiV1OrganizationsUsageRunsGet({ headers, query: { page: 1, limit: 6 } }),
    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet({ headers }),
    getApiKeysApiV1UserApiKeysGet({ headers }),
  ]);
  ensureAuthorized(me);

  const minutes = usage.data ? Math.round(usage.data.total_duration_seconds / 60) : null;
  const spend = usage.data?.used_amount_usd;
  const agentList = [...(agents.data ?? [])].sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
  const recentRuns = runs.data?.runs ?? [];
  const totalRuns = agentList.reduce((n, w) => n + (w.total_runs ?? 0), 0);

  // Getting-started checklist, derived from real workspace state.
  const steps: { done: boolean; icon: LucideIcon; title: string; body: string; href: string }[] = [
    { done: agentList.length > 0, icon: Bot, title: "Create an agent", body: "Start from a template and edit the prompt.", href: "/agents" },
    { done: totalRuns > 0, icon: PhoneCall, title: "Test it", body: "Chat or take a call from the agent's Test button.", href: agentList[0] ? `/agents/${agentList[0].id}` : "/agents" },
    {
      done: (telephony.data?.configurations ?? []).some((c) => c.is_ready_for_outbound),
      icon: Phone,
      title: "Connect a phone number",
      body: "Vobiz, Exotel, Plivo, Twilio or SIP.",
      href: "/phone-numbers",
    },
    { done: false, icon: Wrench, title: "Give it tools", body: "Transfers, API lookups and a knowledge base.", href: "/tools" },
    // Signup creates one default key, so a second key means the user made one.
    { done: (keys.data ?? []).length > 1, icon: KeyRound, title: "Call it from your backend", body: "Create an API key and turn on the API trigger.", href: "/api-keys" },
    { done: false, icon: Megaphone, title: "Launch a campaign", body: "Call a whole list with retries.", href: "/campaigns/new" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader title="Home" sub={`Welcome back${me.data?.email ? `, ${me.data.email}` : ""}.`} actions={<NewAgentButton />} />

      <div className="space-y-6 px-6 py-6 sm:px-8">
        <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={Bot} label="Active agents" value={count.data ? String(count.data.active) : "–"} note={count.data ? `${count.data.total} total` : undefined} />
          <Stat icon={PhoneCall} label="Total calls" value={num(totalRuns)} note="Across all agents" />
          <Stat
            icon={Clock}
            label="Minutes this period"
            value={minutes !== null ? num(minutes) : "–"}
            note={usage.data ? `${shortDate(usage.data.period_start)} to ${shortDate(usage.data.period_end)}` : undefined}
          />
          {spend != null ? (
            <Stat icon={Wallet} label="Spend this period" value={usd(spend)} note={usage.data?.currency ?? undefined} />
          ) : (
            <Stat icon={Radio} label="Live calls now" value={live.data ? String(live.data.active_calls) : "–"} note="Across all workers" />
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader
                title="Recent calls"
                actions={
                  <Link href="/runs" className="text-[13px] text-muted-foreground transition hover:text-foreground">
                    View all
                  </Link>
                }
              />
              {recentRuns.length ? (
                <ul>
                  {recentRuns.map((r) => (
                    <li key={r.id} className="border-b border-border last:border-b-0">
                      <Link href={`/runs/${r.workflow_id}/${r.id}`} className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-accent">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                          <PhoneCall className="size-4 text-foreground" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-foreground">{r.workflow_name ?? `Agent ${r.workflow_id}`}</span>
                          <span className="text-xs text-muted-foreground">
                            {channelOf(r.mode).label} · {duration(r.call_duration_seconds)} · {ago(r.created_at)}
                          </span>
                        </span>
                        {r.disposition ? <Badge>{humanize(r.disposition)}</Badge> : null}
                        <ChevronRight className="size-4 text-muted-foreground/70 transition group-hover:text-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-10 text-center text-[13.5px] text-muted-foreground">No calls yet. Test an agent to see calls here.</p>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardHeader
                title="Agents"
                actions={
                  <Link href="/agents" className="text-[13px] text-muted-foreground transition hover:text-foreground">
                    View all
                  </Link>
                }
              />
              {agentList.length ? (
                <ul>
                  {agentList.slice(0, 5).map((w) => (
                    <li key={w.id} className="border-b border-border last:border-b-0">
                      <Link href={`/agents/${w.id}`} className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-accent">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Bot className="size-4 text-foreground" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-foreground">{w.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {w.total_runs} {w.total_runs === 1 ? "call" : "calls"} · created {shortDate(w.created_at)}
                          </span>
                        </span>
                        <ArrowUpRight className="size-4 text-muted-foreground/70 transition group-hover:translate-x-0.5 group-group-hover:text-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-10 text-center text-[13.5px] text-muted-foreground">No agents yet.</p>
              )}
            </Card>
          </div>

          <section aria-labelledby="getting-started" className="h-fit rounded-lg bg-white p-5 border">
            <div className="flex items-baseline justify-between">
              <h2 id="getting-started" className="text-[15px] font-medium text-foreground">
                Getting started
              </h2>
              <span className="text-[12.5px] text-muted-foreground">
                {doneCount} of {steps.length}
              </span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-700" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <ul className="mt-4 space-y-1">
              {steps.map(({ done, icon: Icon, title, body, href }) => (
                <li key={title}>
                  <Link href={href} className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent">
                    <span
                      className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:-rotate-6 ${
                        done ? "bg-emerald-50" : "bg-white border shadow-xs"
                      }`}
                    >
                      {done ? <Check className="size-4 text-emerald-700" strokeWidth={2.25} /> : <Icon className="size-4 text-foreground" strokeWidth={1.75} />}
                    </span>
                    <span>
                      <span className={`block text-[14px] ${done ? "text-muted-foreground line-through decoration-black/20" : "text-foreground"}`}>{title}</span>
                      <span className="text-[13px] text-muted-foreground">{body}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
