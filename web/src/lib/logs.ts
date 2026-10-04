// Shared bits for the Logs page (/api/v1/logs). The backend returns some
// sections as loose dicts; the types below name the fields the UI reads.

import type { CallLogSummary } from "@/client";

export type LogsTab = "calls" | "chat" | "sessions" | "webhooks" | "api";
export const LOG_TABS: { id: LogsTab; label: string }[] = [
  { id: "calls", label: "Calls" },
  { id: "chat", label: "Chat" },
  { id: "sessions", label: "Sessions" },
  { id: "webhooks", label: "Webhooks" },
  { id: "api", label: "API" },
];

export const RANGES = [
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
  { id: "90d", label: "Last 90 days", hours: 24 * 90 },
  { id: "all", label: "All time", hours: null },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

export const CHANNELS = [
  { id: "telephony", label: "Phone" },
  { id: "web", label: "Web" },
  { id: "chat", label: "Chat" },
] as const;
export const DIRECTIONS = [
  { id: "inbound", label: "Inbound" },
  { id: "outbound", label: "Outbound" },
] as const;

export type Row = CallLogSummary;

/** Vapi-style call type label for the drawer title: webCall, phoneCall, chat. */
export const callKind = (channel: string) => (channel === "telephony" ? "phoneCall" : channel === "web" ? "webCall" : "chat");
export const channelLabel = (channel: string) => CHANNELS.find((c) => c.id === channel)?.label ?? channel;

export const reasonLabel = (r: string | null | undefined) => {
  if (!r) return "–";
  const t = r.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "01a0…879f" style short id, Vapi-like, for integer run ids padded. */
export const shortId = (id: number | string) => {
  const s = String(id);
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
};

export const fmtDuration = (s: number | null | undefined) => {
  if (s == null) return "–";
  const t = Math.round(s);
  const m = Math.floor(t / 60);
  return m ? `${m}m ${t % 60}s` : `${t}s`;
};

export const fmtMoney = (n: number | null | undefined) => (n == null ? "–" : `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`);

export const fmtStart = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Seconds as m:ss.t for the player clock. */
export const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(1).padStart(4, "0")}`;
};

// Loose shapes from the backend.
export type Evaluator = {
  id: string;
  status: "completed" | "skipped" | "failed";
  result: {
    model?: string;
    error?: string;
    skipped?: boolean;
    reason?: string;
    node_results?: Record<string, { output?: unknown; tags?: string[]; summary?: string; score?: number | null; overall_sentiment?: string | null; error?: string }>;
  };
};
export type EvaluationOutput = { evaluator_id: string; node_id: string; output: unknown };
export type Span = {
  name: string;
  span_id: string;
  parent_span_id: string | null;
  started_at_ns: number | null;
  ended_at_ns: number | null;
  duration_ms: number | null;
  attributes: Record<string, unknown>;
  status: string;
};
export type CostComponent = { service: string; usage: Record<string, Record<string, number | null> | number | null>; charge_usd: number | null };
export type LatencyTurn = Record<string, number | string | null> & { turn?: number | null };

export const LATENCY_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "turn_to_audio_ms", label: "Turn to audio", hint: "Caller stops speaking → agent audio starts" },
  { key: "e2e_ms", label: "End to end", hint: "Full response time for the turn" },
  { key: "user_turn_ms", label: "User turn", hint: "Time to decide the caller finished" },
  { key: "stt_ttfb_ms", label: "Transcriber", hint: "Speech-to-text time to first byte" },
  { key: "llm_ttfb_ms", label: "Model", hint: "LLM time to first token" },
  { key: "tts_ttfb_ms", label: "Voice", hint: "Text-to-speech time to first byte" },
  { key: "text_aggregation_ms", label: "Text aggregation", hint: "Buffering text into speakable chunks" },
  { key: "function_calls_ms", label: "Tool calls", hint: "Time spent in function calls" },
];

/** Build the /logs URL for given params, dropping empties. */
export function logsHref(params: Record<string, string | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `/logs${s ? `?${s}` : ""}`;
}
