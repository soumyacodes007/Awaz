import { AlertTriangle, Bot, Mic, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkflowApiV1WorkflowFetchWorkflowIdGet, getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet } from "@/client";
import { RecordingPlayer } from "@/components/app/media";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, CardHeader } from "@/components/app/ui";
import { dateTime, duration, humanize, usd } from "@/lib/format";
import { eventsOf, percentile, type RtfEvent, STAGE_COLOR, STAGE_LABEL, STAGES, summarize, transcript, turns } from "@/lib/latency";
import { channelOf } from "@/lib/runs";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { LiveRefresh } from "./LiveRefresh";

export const metadata: Metadata = { title: "Call | Awaz" };

// Keys Dograh stores for its own bookkeeping; hidden from "Call data".
const INTERNAL = new Set(["mps_correlation_id", "workflow_run_id", "runtime_configuration", "nodes_visited", "call_tags", "provider", "call_id"]);

function KeyValues({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([k, v]) => !INTERNAL.has(k) && v !== null && v !== "" && typeof v !== "object");
  const nested = Object.entries(data).filter(([k, v]) => !INTERNAL.has(k) && v && typeof v === "object");
  if (!rows.length && !nested.length) return <p className="text-[13px] text-muted-foreground">Nothing captured.</p>;
  return (
    <dl className="space-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 text-[13px]">
          <dt className="shrink-0 text-muted-foreground">{humanize(k)}</dt>
          <dd className="min-w-0 text-right break-words text-foreground">{String(v)}</dd>
        </div>
      ))}
      {nested.map(([k, v]) => (
        <div key={k} className="text-[13px]">
          <dt className="text-muted-foreground">{humanize(k)}</dt>
          <dd>
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-2.5 font-mono text-[11.5px] text-foreground/80">{JSON.stringify(v, null, 2)}</pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LatencyCard({ events }: { events: RtfEvent[] }) {
  const perTurn = turns(events);
  const summary = summarize(events);
  const totals = perTurn.map((t) => STAGES.reduce((n, s) => n + (t[s] ?? 0), 0));
  const maxTurn = Math.max(1, ...totals);
  return (
    <Card>
      <CardHeader title="Latency" sub="Time to first byte per stage, for every turn of the conversation." />
      {summary.samples ? (
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STAGES.map((s) => {
              const xs = perTurn.map((t) => t[s]).filter((v): v is number => v != null);
              return (
                <div key={s} className="rounded-md bg-muted p-3">
                  <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className="size-1.5 rounded-full" style={{ background: STAGE_COLOR[s] }} /> {STAGE_LABEL[s]}
                  </p>
                  <p className="mt-1 text-[17px] text-foreground tabular-nums">{summary[s] != null ? `${summary[s]} ms` : "–"}</p>
                  <p className="text-[11.5px] text-muted-foreground/70 tabular-nums">p90 {percentile(xs, 90) ?? "–"} ms</p>
                </div>
              );
            })}
            <div className="rounded-md bg-primary p-3 text-white">
              <p className="text-[12px] text-white/60">Median response</p>
              <p className="mt-1 text-[17px] tabular-nums">{summary.total != null ? `${summary.total} ms` : "–"}</p>
              <p className="text-[11.5px] text-white/50 tabular-nums">p90 {percentile(totals, 90) ?? "–"} ms</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {perTurn.map((t, i) => (
              <div key={t.turn} className="flex items-center gap-3 text-[12px]">
                <span className="w-12 shrink-0 text-muted-foreground tabular-nums">Turn {t.turn}</span>
                <div className="flex h-3 min-w-0 flex-1 gap-px overflow-hidden rounded">
                  {STAGES.map((s) =>
                    t[s] ? <span key={s} title={`${STAGE_LABEL[s]} ${t[s]} ms`} style={{ width: `${(t[s]! / maxTurn) * 100}%`, background: STAGE_COLOR[s] }} /> : null,
                  )}
                </div>
                <span className="w-16 shrink-0 text-right text-foreground/80 tabular-nums">{totals[i]} ms</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="px-5 py-6 text-[13px] text-muted-foreground">No latency measurements recorded for this call.</p>
      )}
    </Card>
  );
}

export default async function CallPage({ params }: { params: Promise<{ workflowId: string; runId: string }> }) {
  const { workflowId, runId } = await params;
  const wid = Number(workflowId);
  const rid = Number(runId);
  if (!Number.isInteger(wid) || !Number.isInteger(rid)) notFound();
  const headers = await authHeaders();
  const [run, wf] = await Promise.all([
    getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet({ headers, path: { workflow_id: wid, run_id: rid } }),
    getWorkflowApiV1WorkflowFetchWorkflowIdGet({ headers, path: { workflow_id: wid } }),
  ]);
  ensureAuthorized(run);
  const r = run.data;
  if (!r) notFound();

  const events = eventsOf(r.logs);
  const lines = transcript(events);
  const ch = channelOf(r.mode);
  const gathered = (r.gathered_context ?? {}) as Record<string, unknown>;
  const outcome = (gathered.mapped_call_disposition ?? gathered.call_disposition) as string | undefined;
  const qa = Object.entries((r.annotations ?? {}) as Record<string, unknown>).filter(([k]) => k.startsWith("qa"));
  const cost = (r.cost_info ?? {}) as Record<string, unknown>;
  const ic = (r.initial_context ?? {}) as Record<string, unknown>;

  return (
    <>
      <LiveRefresh active={!r.is_completed} />
      <PageHeader
        title={`Call #${r.id}`}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/agents/${wid}`} className="hover:text-foreground hover:underline">
              {wf.data?.name ?? r.workflow_name ?? `Agent ${wid}`}
            </Link>
            <span className="text-muted-foreground/70">·</span>
            <span>{dateTime(r.created_at)}</span>
            <Badge>{ch.label}</Badge>
            <Badge>{humanize(r.call_type)}</Badge>
            {r.is_completed ? null : (
              <Badge tone="blue">
                <span className="size-1.5 animate-pulse rounded-full bg-current" /> Live
              </Badge>
            )}
          </span>
        }
        back={{ href: "/runs", label: "Agent runs" }}
        actions={
          <Link href={`/logs?agent=${wid}&run=${rid}`} className={btn("secondary")}>
            Raw event log
          </Link>
        }
      />
      <PageBody>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {r.recording_url || r.recording_public_url ? (
              <Card className="p-5">
                <p className="mb-3 text-[13px] text-muted-foreground">Recording</p>
                <RecordingPlayer storageKey={r.recording_url} publicUrl={r.recording_public_url} />
              </Card>
            ) : null}

            {ch.kind === "chat" ? null : <LatencyCard events={events} />}

            <Card>
              <CardHeader title="Transcript" />
              {lines.length ? (
                <ol className="space-y-3 p-5">
                  {lines.map((l, i) => {
                    const Icon = l.role === "agent" ? Bot : l.role === "user" ? Mic : l.role === "tool" ? Wrench : AlertTriangle;
                    const tone =
                      l.role === "agent" ? "text-foreground" : l.role === "user" ? "text-foreground/80" : l.role === "tool" ? "text-foreground" : "text-red-600";
                    return (
                      <li key={i} className="flex gap-3">
                        <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted ${tone}`}>
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11.5px] tracking-wide text-muted-foreground uppercase">
                            {l.role === "agent" ? "Agent" : l.role === "user" ? "Caller" : l.role === "tool" ? "Tool" : "Error"}
                            {l.at ? <span className="ml-2 normal-case tabular-nums">{new Date(l.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> : null}
                          </p>
                          <p className={`mt-0.5 text-[14px] leading-relaxed ${l.role === "error" ? "text-red-600" : "text-foreground"}`}>{l.text}</p>
                          {l.detail ? <pre className="mt-1.5 overflow-x-auto rounded-lg bg-muted p-2.5 font-mono text-[11.5px] whitespace-pre-wrap text-foreground/80">{l.detail}</pre> : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="px-5 py-6 text-[13px] text-muted-foreground">{r.is_completed ? "No transcript for this call." : "Waiting for the conversation to start…"}</p>
              )}
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="p-5">
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ["Duration", duration(cost.call_duration_seconds as number | undefined)],
                  ["Outcome", outcome ? humanize(outcome) : "–"],
                  ["From", (ic.caller_number as string) ?? "–"],
                  ["To", (ic.called_number as string) ?? (ic.phone_number as string) ?? "–"],
                  ["Agent version", r.version_number ? `v${r.version_number}` : "–"],
                  ["Cost", cost.total_cost_usd != null ? usd(cost.total_cost_usd as number, 4) : "–"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right text-foreground tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card>
              <CardHeader title="Structured outputs" />
              <div className="p-5">
                <KeyValues data={Object.fromEntries(Object.entries(gathered).filter(([k]) => k !== "mapped_call_disposition" && k !== "call_disposition"))} />
              </div>
            </Card>
            {qa.length ? (
              <Card>
                <CardHeader title="Quality review" />
                <div className="p-5">
                  <KeyValues data={Object.fromEntries(qa)} />
                </div>
              </Card>
            ) : null}
            <Card>
              <CardHeader title="Call data" sub="Context the call started with." />
              <div className="p-5">
                <KeyValues data={ic} />
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
