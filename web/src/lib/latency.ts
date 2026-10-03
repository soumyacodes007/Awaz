// Dograh records every call as a stream of "realtime feedback" events in
// run.logs.realtime_feedback_events: transcripts, tool calls, errors and
// time-to-first-byte metrics for each pipeline stage (stt, llm, tts). This
// module turns that stream into something the UI can show.

export type RtfEvent = {
  type: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
  turn?: number;
  node_name?: string;
};

export type Stage = "stt" | "llm" | "tts";
export const STAGES: Stage[] = ["stt", "llm", "tts"];
export const STAGE_LABEL: Record<Stage, string> = { stt: "Transcriber", llm: "Model", tts: "Voice" };
export const STAGE_COLOR: Record<Stage, string> = { stt: "#f59e0b", llm: "#556adc", tts: "#c026d3" };

export function eventsOf(logs: unknown): RtfEvent[] {
  const list = (logs as { realtime_feedback_events?: unknown } | null)?.realtime_feedback_events;
  return Array.isArray(list) ? (list as RtfEvent[]) : [];
}

/** Seconds → ms, rounded. */
const ms = (s: number) => Math.round(s * 1000);

/** Each TTFB measurement as {stage, ms}. Old runs without `kind` are LLM. */
export function ttfbs(events: RtfEvent[]) {
  return events
    .filter((e) => e.type === "rtf-ttfb-metric" && typeof e.payload?.ttfb_seconds === "number")
    .map((e) => ({
      stage: ((e.payload?.kind as Stage) ?? "llm") as Stage,
      ms: ms(e.payload!.ttfb_seconds as number),
      turn: e.turn ?? null,
      model: (e.payload?.model as string) ?? null,
    }));
}

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function percentile(xs: number[], p: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export type LatencySummary = Record<Stage, number | null> & { total: number | null; samples: number };

/** Median per stage across any number of runs. total = sum of stage medians. */
export function summarize(events: RtfEvent[]): LatencySummary {
  const all = ttfbs(events);
  const out = { samples: all.length } as LatencySummary;
  for (const s of STAGES) out[s] = median(all.filter((x) => x.stage === s).map((x) => x.ms));
  const parts = STAGES.map((s) => out[s]).filter((v): v is number => v != null);
  out.total = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  return out;
}

/** Per-turn stage timings, for the latency trace on a call. */
export function turns(events: RtfEvent[]) {
  const byTurn = new Map<number, Partial<Record<Stage, number>>>();
  for (const t of ttfbs(events)) {
    if (t.turn == null) continue;
    const row = byTurn.get(t.turn) ?? {};
    // A stage can report more than once per turn (e.g. retries); keep the first.
    if (row[t.stage] == null) row[t.stage] = t.ms;
    byTurn.set(t.turn, row);
  }
  return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([turn, v]) => ({ turn, ...v }));
}

export type TranscriptLine = { role: "user" | "agent" | "tool" | "error" | "system"; text: string; at?: string; detail?: string };

/** Readable transcript from the event stream. */
export function transcript(events: RtfEvent[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const e of events) {
    const p = e.payload ?? {};
    const at = e.timestamp ?? (p.timestamp as string | undefined);
    if (e.type === "rtf-user-transcription" && p.final && p.text) out.push({ role: "user", text: String(p.text), at });
    else if (e.type === "rtf-bot-text" && p.text) {
      // Bot text arrives in chunks within a turn; merge consecutive chunks.
      const last = out[out.length - 1];
      if (last?.role === "agent" && last.at && at && Math.abs(+new Date(at) - +new Date(last.at)) < 4000) last.text += ` ${p.text}`;
      else out.push({ role: "agent", text: String(p.text), at });
    } else if (e.type === "rtf-function-call-start") {
      out.push({ role: "tool", text: `Called ${p.function_name ?? "tool"}`, at, detail: p.arguments ? JSON.stringify(p.arguments) : undefined });
    } else if (e.type === "rtf-function-call-end") {
      const last = [...out].reverse().find((l) => l.role === "tool");
      if (last && p.result) last.detail = `${last.detail ? `${last.detail}\n→ ` : "→ "}${String(p.result).slice(0, 400)}`;
    } else if (e.type === "rtf-pipeline-error") {
      out.push({ role: "error", text: String(p.error ?? "Pipeline error"), at, detail: p.processor ? String(p.processor) : undefined });
    }
  }
  return out;
}

export const EVENT_LABEL: Record<string, string> = {
  "rtf-user-transcription": "User speech",
  "rtf-bot-text": "Agent speech",
  "rtf-function-call-start": "Tool call",
  "rtf-function-call-end": "Tool result",
  "rtf-ttfb-metric": "Latency",
  "rtf-node-transition": "Agent start",
  "rtf-pipeline-error": "Error",
  "rtf-interrupt-warning": "Interruption",
  "rtf-bot-started-speaking": "Agent started speaking",
  "rtf-bot-stopped-speaking": "Agent stopped speaking",
  "rtf-user-mute-started": "User muted",
  "rtf-user-mute-stopped": "User unmuted",
};
