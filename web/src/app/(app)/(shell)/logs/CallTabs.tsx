"use client";

import { ChevronRight, LoaderCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  callAnalysisApiV1LogsCallsRunIdAnalysisGet,
  callCostApiV1LogsCallsRunIdCostGet,
  callEventsApiV1LogsCallsRunIdEventsGet,
  callLatencyApiV1LogsCallsRunIdLatencyGet,
  callMessagesApiV1LogsCallsRunIdMessagesGet,
  callOutputsApiV1LogsCallsRunIdStructuredOutputsGet,
  callTranscriptApiV1LogsCallsRunIdTranscriptGet,
  type AnalysisResponse,
  type CostResponse,
  type LatencyResponse,
  type StructuredOutputsResponse,
  type TranscriptItem,
} from "@/client";
import { Badge, btn, EmptyState, ErrorNote, type Tone } from "@/components/app/ui";
import { humanize } from "@/lib/format";
import { EVENT_LABEL, STAGE_COLOR, STAGE_LABEL, type Stage } from "@/lib/latency";
import { clock, type CostComponent, type Evaluator, type EvaluationOutput, fmtMoney, LATENCY_FIELDS, type LatencyTurn, type Span } from "@/lib/logs";

import type { Feedback } from "./CallDrawer";
import type { Player } from "./RecordingPanel";

// ── helpers ──────────────────────────────────────────────────────────────

/** Fetch once on mount; `reload` re-runs it (used for polling). */
function useLoad<T>(fn: () => Promise<{ data?: T; error?: unknown }>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    const r = await fn().catch(() => null);
    if (r?.data) {
      setData(r.data);
      setError(null);
    } else setError("Couldn't load this section.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    run();
  }, [run]);
  return { data, error, reload: run };
}

const Loading = () => <LoaderCircle className="size-5 animate-spin text-muted-foreground" />;

const Unavailable = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-lg border border-dashed px-5 py-8 text-center">
    <p className="text-sm font-medium text-foreground">{title}</p>
    <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
  </div>
);

function Json({ value, max = "max-h-80" }: { value: unknown; max?: string }) {
  return <pre className={`${max} overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100`}>{JSON.stringify(value, null, 2)}</pre>;
}

const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (!entries.length) return <p className="text-[13px] text-muted-foreground">Nothing captured.</p>;
  return (
    <dl className="divide-y rounded-lg border">
      {entries.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
          <dt className="font-mono text-[13px] text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words text-foreground">{isScalar(v) ? String(v ?? "–") : Array.isArray(v) && v.every(isScalar) ? v.join(", ") : <Json value={v} max="max-h-48" />}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Transcripts ──────────────────────────────────────────────────────────

export function TranscriptTab({
  runId,
  agentName,
  player,
  feedback,
  startedAt,
}: {
  runId: number;
  agentName: string;
  player: Player;
  feedback: Feedback;
  startedAt: string;
}) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [meta, setMeta] = useState<{ available: boolean; hasMore: boolean; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setBusy(true);
      const r = await callTranscriptApiV1LogsCallsRunIdTranscriptGet({ path: { run_id: runId }, query: { offset, limit: 200 } }).catch(() => null);
      setBusy(false);
      if (!r?.data) return setError("Couldn't load the transcript.");
      setItems((prev) => (offset ? [...prev, ...r.data!.items] : r.data!.items));
      setMeta({ available: r.data.available, hasMore: r.data.has_more, truncated: Boolean(r.data.truncated) });
    },
    [runId],
  );
  useEffect(() => {
    load(0);
  }, [load]);

  // Offsets for text chats (no audio) are measured from the first message.
  const origin = useMemo(() => {
    const first = items.find((i) => i.timestamp)?.timestamp;
    return +new Date(first ?? startedAt);
  }, [items, startedAt]);
  const active = items.find((i) => i.start_seconds != null && i.end_seconds != null && player.time >= i.start_seconds && player.time < i.end_seconds)?.event_id;

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!meta) return <Loading />;
  if (!meta.available || !items.length) return <Unavailable title="No transcript" body="Nothing was said on this call, or it wasn't recorded." />;

  return (
    <div className="space-y-4">
      {items.map((m) => {
        const agent = m.role === "assistant";
        const offset = m.start_seconds ?? (m.timestamp ? (+new Date(m.timestamp) - origin) / 1000 : null);
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" }) : null;
        const seekable = m.start_seconds != null;
        const rating = feedback.ratings[m.event_id];
        return (
          <div key={m.event_id} className={`group flex flex-col ${agent ? "items-start" : "items-end"}`}>
            <button
              type="button"
              disabled={!seekable}
              onClick={() => seekable && player.seek(m.start_seconds!)}
              title={seekable ? `${new Date(m.timestamp ?? "").toLocaleString("en-IN")} · ${clock(m.start_seconds!)}${m.end_seconds != null ? ` – ${clock(m.end_seconds)}` : ""}\nClick to seek` : undefined}
              className={`max-w-[78%] rounded-lg border px-3.5 py-2.5 text-left transition-colors disabled:cursor-default ${
                agent ? "bg-muted/60" : "bg-background"
              } ${seekable ? "cursor-pointer hover:border-foreground/30" : ""} ${active === m.event_id ? "border-foreground ring-1 ring-foreground" : ""}`}
            >
              <span className={`block text-xs font-medium ${agent ? "text-emerald-700" : "text-amber-700"}`}>{agent ? agentName : "User"}</span>
              <span className="mt-0.5 block text-sm leading-relaxed whitespace-pre-wrap text-foreground">{m.text}</span>
            </button>
            <div className={`mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground ${agent ? "" : "flex-row-reverse"}`}>
              <span className="tabular-nums">
                {time}
                {offset != null ? ` (+${clock(Math.max(0, offset))})` : ""}
              </span>
              {feedback.completed ? (
                <span className={`flex items-center gap-0.5 ${rating ? "" : "opacity-0 transition-opacity group-hover:opacity-100"}`}>
                  <button
                    type="button"
                    aria-label="Good response"
                    onClick={() => feedback.rate(m.event_id, "positive")}
                    className={`rounded p-0.5 hover:bg-accent ${rating === "positive" ? "text-emerald-600" : ""}`}
                  >
                    <ThumbsUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Bad response"
                    onClick={() => feedback.rate(m.event_id, "negative")}
                    className={`rounded p-0.5 hover:bg-accent ${rating === "negative" ? "text-red-600" : ""}`}
                  >
                    <ThumbsDown className="size-3.5" />
                  </button>
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      {meta.hasMore ? (
        <button type="button" onClick={() => load(items.length)} disabled={busy} className={btn("secondary", "sm")}>
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null} Load more
        </button>
      ) : null}
      {meta.truncated ? <p className="text-xs text-muted-foreground">Part of this transcript was dropped during capture.</p> : null}
    </div>
  );
}

// ── Logs (events) ────────────────────────────────────────────────────────

const EVENT_TONE: Record<string, Tone> = {
  "rtf-user-transcription": "neutral",
  "rtf-bot-text": "blue",
  "rtf-function-call-start": "violet",
  "rtf-function-call-end": "violet",
  "rtf-ttfb-metric": "amber",
  "rtf-pipeline-error": "red",
  "rtf-interrupt-warning": "red",
  "rtf-node-transition": "green",
};

function eventSummary(e: Record<string, unknown>) {
  const p = (e.payload ?? e.detail ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "rtf-user-transcription":
      return `${p.final ? "" : "(partial) "}${String(p.text ?? "")}`;
    case "rtf-bot-text":
      return String(p.text ?? "");
    case "rtf-function-call-start":
      return `${p.function_name}(${p.arguments ? JSON.stringify(p.arguments) : ""})`;
    case "rtf-function-call-end":
      return `${p.function_name} → ${String(p.result ?? "").slice(0, 200)}`;
    case "rtf-ttfb-metric":
      return `${STAGE_LABEL[(p.kind as Stage) ?? "llm"] ?? p.kind} ${Math.round(Number(p.ttfb_seconds) * 1000)} ms${p.model ? ` · ${p.model}` : ""}`;
    case "rtf-pipeline-error":
      return `${p.fatal ? "Fatal: " : ""}${String(p.error ?? "")}`;
    case "rtf-node-transition":
      return "Agent started";
    default:
      return Object.keys(p).length ? JSON.stringify(p).slice(0, 200) : "";
  }
}

export function EventsTab({ runId, hasDiagnostics }: { runId: number; hasDiagnostics: boolean }) {
  const [source, setSource] = useState<"realtime" | "diagnostics">("realtime");
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<{ available: boolean; total: number; hasMore: boolean; truncated: boolean } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setBusy(true);
      const r = await callEventsApiV1LogsCallsRunIdEventsGet({ path: { run_id: runId }, query: { source, offset, limit: 200 } }).catch(() => null);
      setBusy(false);
      if (!r?.data) return setMeta({ available: false, total: 0, hasMore: false, truncated: false });
      setItems((prev) => (offset ? [...prev, ...r.data!.items] : r.data!.items));
      setMeta({ available: r.data.available, total: r.data.total_count, hasMore: r.data.has_more, truncated: Boolean(r.data.truncated) });
    },
    [runId, source],
  );
  useEffect(() => {
    setItems([]);
    setMeta(null);
    setOpen(null);
    load(0);
  }, [load]);

  const t0 = useMemo(() => {
    const first = items.map((e) => e.timestamp ?? e.ts).find(Boolean);
    return first ? +new Date(String(first)) : null;
  }, [items]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex rounded-md border p-0.5">
          {(["realtime", "diagnostics"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              aria-pressed={source === s}
              disabled={s === "diagnostics" && !hasDiagnostics}
              title={s === "diagnostics" && !hasDiagnostics ? "No native call events were saved for this call" : undefined}
              className={`h-7 rounded-sm px-2.5 text-[13px] transition-colors disabled:opacity-40 ${source === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s === "realtime" ? "Conversation events" : "Call diagnostics"}
            </button>
          ))}
        </div>
        {meta ? <span className="text-xs text-muted-foreground tabular-nums">{meta.total.toLocaleString("en-IN")} events</span> : null}
      </div>
      {!meta ? (
        <Loading />
      ) : !meta.available || !items.length ? (
        <Unavailable title="No events" body="Nothing was captured for this call." />
      ) : (
        <ol className="divide-y rounded-lg border font-mono text-[12.5px]">
          {items.map((e, i) => {
            const type = String(e.type ?? e.event ?? "event");
            const at = (e.timestamp ?? e.ts) as string | undefined;
            const rel = at && t0 ? ((+new Date(at) - t0) / 1000).toFixed(2) : "";
            const expanded = open === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : i)}
                  aria-expanded={expanded}
                  className="grid w-full grid-cols-[64px_150px_36px_minmax(0,1fr)_16px] items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="text-muted-foreground tabular-nums">{rel ? `+${rel}s` : ""}</span>
                  <span>
                    <Badge tone={EVENT_TONE[type] ?? "neutral"} className="font-sans">
                      {EVENT_LABEL[type] ?? humanize(type.replace(/^rtf-/, ""))}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground tabular-nums">{e.turn != null ? `t${e.turn}` : ""}</span>
                  <span className={`min-w-0 font-sans text-[13px] ${expanded ? "" : "truncate"} ${type.includes("error") ? "text-destructive" : "text-foreground"}`}>{eventSummary(e)}</span>
                  <ChevronRight className={`mt-0.5 size-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
                </button>
                {expanded ? (
                  <div className="px-3 pb-3">
                    <Json value={e} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {meta?.hasMore ? (
        <button type="button" onClick={() => load(items.length)} disabled={busy} className={btn("secondary", "sm", "mt-3")}>
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null} Load more
        </button>
      ) : null}
      {meta?.truncated ? <p className="mt-2 text-xs text-muted-foreground">Some events were dropped during capture.</p> : null}
    </div>
  );
}

// ── Analysis ─────────────────────────────────────────────────────────────

const SENTIMENT_TONE: Record<string, Tone> = { positive: "green", neutral: "neutral", negative: "red" };

export function AnalysisTab({ runId }: { runId: number }) {
  const { data, error, reload } = useLoad<AnalysisResponse>(() => callAnalysisApiV1LogsCallsRunIdAnalysisGet({ path: { run_id: runId } }));
  const delay = useRef(2000);

  // Poll with backoff while the evaluation is still queued or running.
  useEffect(() => {
    if (data?.status !== "pending") return;
    const t = setTimeout(() => {
      delay.current = Math.min(delay.current * 1.6, 30000);
      reload();
    }, delay.current);
    return () => clearTimeout(t);
  }, [data, reload]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  if (data.status === "not_configured")
    return <Unavailable title="Quality review is off for this agent" body="Turn it on in the agent's Analysis tab to score every call with an LLM judge." />;
  if (data.status === "pending")
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Evaluation is running. This updates automatically.
      </div>
    );
  if (data.status === "failed") return <ErrorNote>The evaluation failed for this call.</ErrorNote>;
  if (data.status === "unavailable" || !data.evaluators.length) return <Unavailable title="No analysis" body="No evaluation results were recorded for this call." />;

  return (
    <div className="space-y-4">
      {(data.evaluators as Evaluator[]).map((ev) => (
        <section key={ev.id} className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="font-mono text-[13px] text-foreground">{ev.id}</p>
            <span className="flex items-center gap-2">
              {ev.result.model ? <span className="text-xs text-muted-foreground">{ev.result.model}</span> : null}
              <Badge tone={ev.status === "completed" ? "green" : ev.status === "failed" ? "red" : "neutral"}>{humanize(ev.status)}</Badge>
            </span>
          </div>
          {ev.result.error ? <p className="px-4 py-3 text-[13px] text-destructive">{humanize(ev.result.error)}</p> : null}
          {ev.status === "skipped" ? <p className="px-4 py-3 text-[13px] text-muted-foreground">{ev.result.reason ? humanize(String(ev.result.reason)) : "Skipped by the evaluator's sampling or filters."}</p> : null}
          <div className="divide-y">
            {Object.entries(ev.result.node_results ?? {}).map(([node, r]) => (
              <div key={node} className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{node === "whole_call" ? "Whole call" : `Node ${node}`}</span>
                  {r.score != null ? (
                    <span className="rounded-md border px-2 py-0.5 text-sm font-semibold tabular-nums text-foreground">Score {String(r.score)}</span>
                  ) : null}
                  {r.overall_sentiment ? <Badge tone={SENTIMENT_TONE[String(r.overall_sentiment).toLowerCase()] ?? "neutral"}>{humanize(String(r.overall_sentiment))}</Badge> : null}
                </div>
                {r.summary ? <p className="text-sm leading-relaxed text-foreground">{r.summary}</p> : null}
                {r.tags?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                ) : null}
                {r.error ? <p className="text-[13px] text-destructive">{r.error}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Structured outputs ───────────────────────────────────────────────────

export function OutputsTab({ runId }: { runId: number }) {
  const { data, error } = useLoad<StructuredOutputsResponse>(() => callOutputsApiV1LogsCallsRunIdStructuredOutputsGet({ path: { run_id: runId } }));
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  const evaluations = data.evaluations as EvaluationOutput[];
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Extracted variables</h3>
        <KeyValues data={data.extracted_variables} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Evaluator outputs</h3>
        {evaluations.length ? (
          <div className="space-y-3">
            {evaluations.map((e, i) => (
              <div key={i} className="rounded-lg border">
                <p className="border-b px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {e.evaluator_id} · {e.node_id === "whole_call" ? "whole call" : `node ${e.node_id}`}
                </p>
                <div className="p-3">{e.output && typeof e.output === "object" && !Array.isArray(e.output) ? <KeyValues data={e.output as Record<string, unknown>} /> : <Json value={e.output} />}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No custom evaluator outputs for this call.</p>
        )}
      </section>
    </div>
  );
}

// ── Messages (model and tool spans) ──────────────────────────────────────

export function MessagesTab({ runId, available }: { runId: number; available: boolean }) {
  const { data, error } = useLoad(() => callMessagesApiV1LogsCallsRunIdMessagesGet({ path: { run_id: runId }, query: { limit: 500 } }));
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const spans = ((data?.items ?? []) as unknown as Span[]).slice();
    const byId = new Map(spans.map((s) => [s.span_id, s]));
    const depth = (s: Span, n = 0): number => (s.parent_span_id && byId.has(s.parent_span_id) && n < 8 ? depth(byId.get(s.parent_span_id)!, n + 1) : n);
    const start = Math.min(...spans.map((s) => s.started_at_ns ?? Infinity));
    const end = Math.max(...spans.map((s) => s.ended_at_ns ?? -Infinity));
    return spans.map((s) => ({ s, depth: depth(s), start, end }));
  }, [data]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  if (!data.available || !rows.length)
    return <Unavailable title="No model messages" body={available ? "No model or tool spans were emitted for this call." : "Model spans weren't captured for this call. New calls capture them automatically."} />;

  return (
    <div className="divide-y rounded-lg border">
      {rows.map(({ s, depth, start, end }) => {
        const span = Math.max(1, end - start);
        const left = s.started_at_ns != null ? ((s.started_at_ns - start) / span) * 100 : 0;
        const w = s.started_at_ns != null && s.ended_at_ns != null ? Math.max(0.5, ((s.ended_at_ns - s.started_at_ns) / span) * 100) : 0;
        const expanded = open === s.span_id;
        return (
          <Fragment key={s.span_id}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : s.span_id)}
              aria-expanded={expanded}
              className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_72px] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[13px]" style={{ paddingLeft: depth * 14 }}>
                <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
                <span className="truncate font-mono text-foreground">{s.name}</span>
                {s.status === "ERROR" ? <Badge tone="red">Error</Badge> : null}
              </span>
              <span className="relative h-2 rounded-full bg-muted">
                <span className="absolute inset-y-0 rounded-full bg-primary" style={{ left: `${left}%`, width: `${w}%` }} />
              </span>
              <span className="text-right text-xs text-muted-foreground tabular-nums">{s.duration_ms != null ? `${Math.round(s.duration_ms)} ms` : "–"}</span>
            </button>
            {expanded ? (
              <div className="bg-muted/30 px-3 py-3">
                <Json value={s.attributes} />
              </div>
            ) : null}
          </Fragment>
        );
      })}
      {data.truncated ? <p className="px-3 py-2 text-xs text-muted-foreground">Some spans were dropped during capture.</p> : null}
    </div>
  );
}

// ── Cost ─────────────────────────────────────────────────────────────────

const usageLine = (usage: CostComponent["usage"]) => {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(usage ?? {})) {
    if (v && typeof v === "object") {
      const model = k.split("|||")[1] ?? k.split("#")[0];
      const u = v as Record<string, number | null>;
      const tokens = u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      const chars = u.characters ?? u.character_count;
      const seconds = u.seconds ?? u.audio_seconds;
      parts.push(`${model}: ${tokens ? `${tokens.toLocaleString("en-IN")} tokens` : chars ? `${chars} chars` : seconds ? `${seconds}s` : "recorded"}`);
    } else if (typeof v === "number") parts.push(`${humanize(k)}: ${v.toLocaleString("en-IN")}`);
  }
  return parts.join(" · ") || "No usage recorded";
};

export function CostTab({ runId }: { runId: number }) {
  const { data, error } = useLoad<CostResponse>(() => callCostApiV1LogsCallsRunIdCostGet({ path: { run_id: runId } }));
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  const components = data.components as CostComponent[];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Total charge", data.charge_usd != null ? fmtMoney(data.charge_usd) : "Unavailable"],
          ["Credits used", data.credits_used != null ? data.credits_used.toFixed(2) : "Unavailable"],
          ["Billed duration", data.duration_seconds != null ? `${Math.round(data.duration_seconds)}s` : "–"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${v === "Unavailable" ? "text-muted-foreground" : "text-foreground"}`}>{v}</p>
          </div>
        ))}
      </div>
      {data.status !== "available" ? (
        <p className="text-[13px] text-muted-foreground">
          {data.status === "partial" ? "Usage was recorded but no dollar amount. Per-provider prices aren't guessed." : "No cost or usage was recorded for this call."}
        </p>
      ) : null}
      {components.length ? (
        <div className="divide-y rounded-lg border">
          {components.map((c) => (
            <div key={c.service} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[120px_minmax(0,1fr)_100px]">
              <span className="font-medium text-foreground">{c.service === "llm" ? "Model" : c.service === "stt" ? "Transcriber" : c.service === "tts" ? "Voice" : c.service}</span>
              <span className="min-w-0 truncate font-mono text-[12.5px] text-muted-foreground">{usageLine(c.usage)}</span>
              <span className="text-right tabular-nums text-muted-foreground">{c.charge_usd != null ? fmtMoney(c.charge_usd) : "Unavailable"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Latency ──────────────────────────────────────────────────────────────

const ms = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v).toLocaleString("en-IN")} ms` : "–");

export function LatencyTab({ runId }: { runId: number }) {
  const { data, error } = useLoad<LatencyResponse>(() => callLatencyApiV1LogsCallsRunIdLatencyGet({ path: { run_id: runId } }));
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  if (!data.available) return <EmptyState icon={LoaderCircle} title="No latency measurements" body="Voice calls record time to first byte for every stage. Text chats don't." />;

  const turns = data.turns as LatencyTurn[];
  const fields = LATENCY_FIELDS.filter((f) => data.averages_ms[f.key] != null || turns.some((t) => typeof t[f.key] === "number"));
  const stages: Stage[] = ["stt", "llm", "tts"];
  const turnTotal = (t: LatencyTurn) => stages.reduce((n, s) => n + (typeof t[`${s}_ttfb_ms`] === "number" ? (t[`${s}_ttfb_ms`] as number) : 0), 0);
  const max = Math.max(1, ...turns.map((t) => (typeof t.e2e_ms === "number" ? t.e2e_ms : turnTotal(t))));

  return (
    <div className="space-y-5">
      {!data.detailed_breakdown_available ? <p className="text-[13px] text-muted-foreground">Detailed breakdowns weren&apos;t captured for this call; showing time to first byte per stage.</p> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {fields.map((f) => (
          <div key={f.key} className="rounded-lg border p-3" title={f.hint}>
            <p className="text-xs text-muted-foreground">{f.label}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-foreground tabular-nums">{ms(data.averages_ms[f.key])}</p>
            <p className="text-[11px] text-muted-foreground">average</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-semibold text-foreground">Per turn</p>
          <span className="flex gap-3 text-xs text-muted-foreground">
            {stages.map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: STAGE_COLOR[s] }} /> {STAGE_LABEL[s]}
              </span>
            ))}
          </span>
        </div>
        <div className="divide-y">
          {turns.map((t, i) => {
            const total = typeof t.e2e_ms === "number" ? t.e2e_ms : turnTotal(t);
            return (
              <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3 px-4 py-2 text-xs">
                <span className="text-muted-foreground tabular-nums">Turn {t.turn ?? i}</span>
                <div className="flex h-3 gap-px overflow-hidden rounded" style={{ width: `${(total / max) * 100}%` }}>
                  {stages.map((s) => {
                    const v = t[`${s}_ttfb_ms`];
                    return typeof v === "number" && v > 0 ? <span key={s} title={`${STAGE_LABEL[s]} ${Math.round(v)} ms`} style={{ flexGrow: v, background: STAGE_COLOR[s] }} /> : null;
                  })}
                </div>
                <span className="text-right text-foreground tabular-nums">{ms(total)}</span>
              </div>
            );
          })}
        </div>
        {data.truncated ? <p className="border-t px-4 py-2 text-xs text-muted-foreground">Some measurements were dropped during capture.</p> : null}
      </div>
    </div>
  );
}
