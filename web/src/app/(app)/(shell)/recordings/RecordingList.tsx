"use client";

import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RecordingPlayer } from "@/components/app/media";
import { Badge } from "@/components/app/ui";
import { dateTime, duration, humanize } from "@/lib/format";

type Item = {
  id: number;
  workflowId: number;
  agent: string;
  createdAt: string;
  duration: number;
  number: string | null;
  direction: string | null;
  outcome: string | null;
  key: string | null;
  publicUrl: string | null;
};

export function RecordingList({ items }: { items: Item[] }) {
  // Signed URLs are fetched only for the rows someone actually plays.
  const [playing, setPlaying] = useState<Set<number>>(new Set());

  return (
    <ul className="divide-y divide-border">
      {items.map((r) => (
        <li key={r.id} className="px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setPlaying((s) => new Set(s).add(r.id))}
              aria-label={`Play call ${r.id}`}
              disabled={playing.has(r.id)}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:bg-primary/90 disabled:opacity-30"
            >
              <Play className="ml-0.5 size-3.5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] text-foreground">
                {r.agent} <span className="text-muted-foreground/70">· #{r.id}</span>
              </p>
              <p className="text-[12.5px] text-muted-foreground">
                {dateTime(r.createdAt)} · {duration(r.duration)}
                {r.number ? <span className="font-mono"> · {r.number}</span> : null}
                {r.direction ? ` · ${r.direction}` : ""}
              </p>
            </div>
            {r.outcome ? <Badge>{humanize(r.outcome)}</Badge> : null}
            <Link href={`/runs/${r.workflowId}/${r.id}`} aria-label={`Open call ${r.id}`} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-accent hover:text-foreground">
              <ChevronRight className="size-4" />
            </Link>
          </div>
          {playing.has(r.id) ? (
            <div className="mt-3 sm:pl-[52px]">
              <RecordingPlayer storageKey={r.key} publicUrl={r.publicUrl} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
