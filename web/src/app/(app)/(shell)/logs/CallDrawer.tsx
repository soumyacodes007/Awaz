"use client";

import {
  BarChart3,
  Braces,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock,
  Gauge,
  LoaderCircle,
  MessageSquareText,
  MessagesSquare,
  ScrollText,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  callDetailApiV1LogsCallsRunIdGet,
  getFeedbackApiV1LogsCallsRunIdFeedbackGet,
  putFeedbackApiV1LogsCallsRunIdFeedbackPut,
  type CallLogDetail,
  type FeedbackItem,
} from "@/client";
import { CopyButton } from "@/components/app/client";
import { Badge, btn, ErrorNote } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { callKind, fmtDuration, fmtMoney } from "@/lib/logs";

import { AnalysisTab, CostTab, EventsTab, LatencyTab, MessagesTab, OutputsTab, TranscriptTab } from "./CallTabs";
import { ReasonBadge } from "./LogsView";
import { RecordingPanel, type Player } from "./RecordingPanel";
import { Sheet } from "./Sheet";

type Tab = "transcript" | "logs" | "analysis" | "outputs" | "messages" | "cost" | "latency";
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "transcript", label: "Transcripts", icon: MessageSquareText },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "analysis", label: "Analysis", icon: BarChart3 },
  { id: "outputs", label: "Structured Outputs", icon: Braces },
  { id: "messages", label: "Messages", icon: MessagesSquare },
  { id: "cost", label: "Call Cost", icon: CircleDollarSign },
  { id: "latency", label: "Latency Summary", icon: Gauge },
];

const titleDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export type Feedback = {
  ratings: Record<string, FeedbackItem["rating"]>;
  rate: (eventId: string, rating: FeedbackItem["rating"]) => void;
  completed: boolean;
};

export function CallDrawer({
  runId,
  rowIds,
  onNavigate,
  onClose,
}: {
  runId: number;
  rowIds: number[];
  onNavigate: (id: number) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CallLogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("transcript");
  const [ratings, setRatings] = useState<Record<string, FeedbackItem["rating"]>>({});
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Audio is owned here so the transcript can seek the player.
  const audio = useRef<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const player: Player = {
    audio,
    time,
    setTime,
    seek: (s: number) => {
      if (!audio.current) return;
      audio.current.currentTime = s;
      setTime(s);
      audio.current.play().catch(() => null);
    },
  };

  useEffect(() => {
    callDetailApiV1LogsCallsRunIdGet({ path: { run_id: runId } })
      .then((r) => (r.data ? setDetail(r.data) : setError(apiError(r.error, "Call not found."))))
      .catch(() => setError("Couldn't load this call."));
    getFeedbackApiV1LogsCallsRunIdFeedbackGet({ path: { run_id: runId } })
      .then((r) => setRatings(Object.fromEntries((r.data?.items ?? []).map((f) => [f.event_id, f.rating]))))
      .catch(() => null);
  }, [runId]);

  const rate = useCallback(
    async (eventId: string, rating: FeedbackItem["rating"]) => {
      setFeedbackError(null);
      setRatings((r) => ({ ...r, [eventId]: rating }));
      const res = await putFeedbackApiV1LogsCallsRunIdFeedbackPut({ path: { run_id: runId }, body: { event_id: eventId, rating } }).catch(() => null);
      if (!res?.data) setFeedbackError(apiError(res?.error, "Couldn't save feedback."));
    },
    [runId],
  );

  // Arrow keys move between calls in the table, like Vapi.
  const index = rowIds.indexOf(runId);
  const prev = index > 0 ? rowIds[index - 1] : null;
  const next = index >= 0 && index < rowIds.length - 1 ? rowIds[index + 1] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const target = e.key === "ArrowUp" ? prev : e.key === "ArrowDown" ? next : null;
      if (target) {
        e.preventDefault();
        onNavigate(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onNavigate]);

  const call = detail?.call;
  const feedback: Feedback = { ratings, rate, completed: Boolean(call?.is_completed) };

  return (
    <Sheet onClose={onClose} label={`Call ${runId}`}>
      {/* Header */}
      <div className="border-b px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-mono text-base font-semibold text-foreground">
            {call ? `${titleDate(call.created_at)} ${callKind(call.channel)}` : `Call ${runId}`}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
              <CircleDollarSign className="size-4" /> Cost: <span className="text-foreground tabular-nums">{fmtMoney(call?.charge_usd)}</span>
            </span>
            <button type="button" aria-label="Previous call" title="Previous call (↑)" disabled={!prev} onClick={() => prev && onNavigate(prev)} className={btn("ghost", "sm", "size-8 px-0")}>
              <ChevronUp className="size-4" />
            </button>
            <button type="button" aria-label="Next call" title="Next call (↓)" disabled={!next} onClick={() => next && onNavigate(next)} className={btn("ghost", "sm", "size-8 px-0")}>
              <ChevronDown className="size-4" />
            </button>
            <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className={btn("ghost", "sm", "size-8 px-0")}>
              <X className="size-4" />
            </button>
          </div>
        </div>
        {call ? (
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3 text-[13px]">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-muted-foreground">
                Call ID: <span className="font-mono text-foreground">{call.id}</span>
                <CopyButton value={String(call.id)} label="Copy call ID" />
                <CopyButton value={`${typeof window !== "undefined" ? window.location.origin : ""}/logs?call=${call.id}`} label="Copy link to this call" />
              </p>
              <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                Agent:
                <Link href={`/agents/${call.workflow_id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                  {call.workflow_name}
                </Link>
                {call.version_number ? <span className="rounded border px-1.5 font-mono text-[11px] leading-5">v{call.version_number}</span> : null}
                {call.provider_call_id ? <span className="font-mono text-[11px]">· {call.provider_call_id}</span> : null}
              </p>
              <p className="flex items-center gap-1.5 text-muted-foreground">
                Ended: {call.is_completed ? <ReasonBadge reason={call.ended_reason} /> : <Badge tone="blue">In progress</Badge>}
                <span className="ml-2 inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Good call"
                    title="Good call"
                    onClick={() => rate("call", "positive")}
                    className={`rounded-md p-1 transition-colors hover:bg-accent ${ratings.call === "positive" ? "text-emerald-600" : ""}`}
                  >
                    <ThumbsUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Bad call"
                    title="Bad call"
                    onClick={() => rate("call", "negative")}
                    className={`rounded-md p-1 transition-colors hover:bg-accent ${ratings.call === "negative" ? "text-red-600" : ""}`}
                  >
                    <ThumbsDown className="size-3.5" />
                  </button>
                </span>
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="size-3.5" /> Duration: <span className="text-foreground tabular-nums">{fmtDuration(call.duration_seconds)}</span>
            </span>
          </div>
        ) : null}
        {feedbackError ? <div className="mt-2"><ErrorNote>{feedbackError}</ErrorNote></div> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="p-5"><ErrorNote>{error}</ErrorNote></div>
        ) : !detail ? (
          <div className="p-5"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <RecordingPanel runId={runId} detail={detail} player={player} />

            <div role="tablist" className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b bg-background px-3 [scrollbar-width:none]">
              {TABS.map(({ id, label, icon: Icon }) => {
                const on = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(id)}
                    className={`relative flex h-10 shrink-0 items-center gap-1.5 px-2.5 text-sm transition-colors ${on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Icon className="size-4" />
                    {label}
                    {on ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" /> : null}
                  </button>
                );
              })}
            </div>

            <div className="p-5">
              {tab === "transcript" ? <TranscriptTab runId={runId} agentName={detail.call.workflow_name} player={player} feedback={feedback} startedAt={detail.recording_started_at ?? detail.call.created_at} /> : null}
              {tab === "logs" ? <EventsTab runId={runId} hasDiagnostics={Boolean(detail.availability.diagnostics)} /> : null}
              {tab === "analysis" ? <AnalysisTab runId={runId} /> : null}
              {tab === "outputs" ? <OutputsTab runId={runId} /> : null}
              {tab === "messages" ? <MessagesTab runId={runId} available={detail.availability.messages !== false} /> : null}
              {tab === "cost" ? <CostTab runId={runId} /> : null}
              {tab === "latency" ? <LatencyTab runId={runId} /> : null}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
