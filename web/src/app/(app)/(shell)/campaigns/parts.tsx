import { Badge, type Tone } from "@/components/app/ui";
import { humanize } from "@/lib/format";

const STATE_TONE: Record<string, Tone> = {
  created: "neutral",
  syncing: "blue",
  running: "blue",
  paused: "amber",
  completed: "green",
  failed: "red",
};

export function CampaignState({ state }: { state: string }) {
  return (
    <Badge tone={STATE_TONE[state] ?? "neutral"}>
      {state === "running" ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {state === "created" ? "Not started" : humanize(state)}
    </Badge>
  );
}

export function Progress({ done, total, failed = 0 }: { done: number; total: number; failed?: number }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  const failedPct = total ? Math.min(pct, (failed / total) * 100) : 0;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct - failedPct}%` }} />
      <span className="h-full bg-red-500" style={{ width: `${failedPct}%` }} />
    </div>
  );
}
