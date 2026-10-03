"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge, btn, Card, type Tone } from "@/components/app/ui";
import { EVENT_LABEL, type RtfEvent, STAGE_LABEL, type Stage } from "@/lib/latency";

type Group = "all" | "speech" | "tools" | "latency" | "errors";
const GROUPS: { id: Group; label: string; match: (t: string) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "speech", label: "Speech", match: (t) => t === "rtf-user-transcription" || t === "rtf-bot-text" },
  { id: "tools", label: "Tools", match: (t) => t.startsWith("rtf-function-call") },
  { id: "latency", label: "Latency", match: (t) => t === "rtf-ttfb-metric" },
  { id: "errors", label: "Errors", match: (t) => t === "rtf-pipeline-error" || t === "rtf-interrupt-warning" },
];

const TONE: Record<string, Tone> = {
  "rtf-user-transcription": "neutral",
  "rtf-bot-text": "blue",
  "rtf-function-call-start": "violet",
  "rtf-function-call-end": "violet",
  "rtf-ttfb-metric": "amber",
  "rtf-pipeline-error": "red",
  "rtf-interrupt-warning": "red",
  "rtf-node-transition": "green",
};

function summary(e: RtfEvent) {
  const p = e.payload ?? {};
  switch (e.type) {
    case "rtf-user-transcription":
      return `${p.final ? "" : "(partial)"}${String(p.text ?? "")}`;
    case "rtf-bot-text":
      return String(p.text ?? "");
    case "rtf-function-call-start":
      return `${p.function_name}(${p.arguments ? JSON.stringify(p.arguments) : ""})`;
    case "rtf-function-call-end":
      return `${p.function_name} → ${String(p.result ?? "").slice(0, 160)}`;
    case "rtf-ttfb-metric":
      return `${STAGE_LABEL[(p.kind as Stage) ?? "llm"] ?? p.kind} ${Math.round(Number(p.ttfb_seconds) * 1000)} ms${p.model ? ` · ${p.model}` : ""}`;
    case "rtf-pipeline-error":
      return `${p.fatal ? "Fatal: " : ""}${String(p.error ?? "")}`;
    case "rtf-node-transition":
      return "Agent started";
    default:
      return Object.keys(p).length ? JSON.stringify(p).slice(0, 160) : "";
  }
}

export function EventLog({
  runId,
  workflowId,
  startedAt,
  events,
  telephony,
}: {
  runId: number;
  workflowId: number;
  startedAt: string;
  events: RtfEvent[];
  telephony: Record<string, unknown>[];
}) {
  const [group, setGroup] = useState<Group>("all");
  const [open, setOpen] = useState<number | null>(null);
  const t0 = useMemo(() => {
    const first = events.find((e) => e.timestamp)?.timestamp;
    return +new Date(first ?? startedAt);
  }, [events, startedAt]);
  const shown = events.map((e, i) => ({ e, i })).filter(({ e }) => GROUPS.find((g) => g.id === group)!.match(e.type));
  const counts = Object.fromEntries(GROUPS.map((g) => [g.id, events.filter((e) => g.match(e.type)).length]));

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              aria-pressed={group === g.id}
              className={`rounded-lg px-2.5 py-1 text-[13px] transition ${group === g.id ? "bg-primary text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            >
              {g.label} <span className={group === g.id ? "text-white/60" : "text-muted-foreground/70"}>{counts[g.id]}</span>
            </button>
          ))}
        </div>
        <Link href={`/runs/${workflowId}/${runId}`} className={btn("secondary", "sm")}>
          Call #{runId}
        </Link>
      </div>
      {shown.length ? (
        <ol className="max-h-[66vh] divide-y divide-border overflow-y-auto font-mono text-[12.5px]">
          {shown.map(({ e, i }) => {
            const at = e.timestamp ?? (e.payload?.timestamp as string | undefined);
            const rel = at ? ((+new Date(at) - t0) / 1000).toFixed(2) : "";
            const expanded = open === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : i)}
                  aria-expanded={expanded}
                  className="grid w-full grid-cols-[56px_120px_40px_minmax(0,1fr)_16px] items-start gap-2 px-4 py-2 text-left transition hover:bg-accent"
                >
                  <span className="text-muted-foreground/70 tabular-nums">{rel ? `+${rel}s` : ""}</span>
                  <span>
                    <Badge tone={TONE[e.type] ?? "neutral"} className="font-sans">
                      {EVENT_LABEL[e.type] ?? e.type.replace(/^rtf-/, "")}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground/70 tabular-nums">{e.turn != null ? `t${e.turn}` : ""}</span>
                  <span className={`min-w-0 font-sans text-[13px] ${expanded ? "" : "truncate"} ${e.type === "rtf-pipeline-error" ? "text-red-600" : "text-foreground/80"}`}>{summary(e)}</span>
                  <ChevronRight className={`mt-0.5 size-3.5 text-muted-foreground/70 transition-transform ${expanded ? "rotate-90" : ""}`} />
                </button>
                {expanded ? (
                  <pre className="mx-4 mb-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-[11.5px] leading-relaxed text-zinc-100">{JSON.stringify(e, null, 2)}</pre>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">No {group === "all" ? "" : `${group} `}events in this call.</p>
      )}
      {telephony.length && group === "all" ? (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Carrier callbacks</p>
          <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11.5px] text-foreground/80">{JSON.stringify(telephony, null, 2)}</pre>
        </div>
      ) : null}
    </Card>
  );
}
