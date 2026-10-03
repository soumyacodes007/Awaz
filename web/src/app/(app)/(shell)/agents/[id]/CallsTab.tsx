import { AudioLines, ChevronRight, PhoneCall } from "lucide-react";
import Link from "next/link";

import { Badge, EmptyState, Table, td, th, tr } from "@/components/app/ui";
import { dateTime, duration, humanize } from "@/lib/format";

import type { EditorProps } from "./types";

export const MODE_LABEL: Record<string, string> = {
  textchat: "Text chat",
  webrtc: "Web call",
  smallwebrtc: "Web call",
  twilio: "Phone",
  vobiz: "Phone",
  exotel: "Phone",
  plivo: "Phone",
  telnyx: "Phone",
  vonage: "Phone",
  cloudonix: "Phone",
  ari: "Phone",
};

export function CallsTab({ agentId, runs, total }: { agentId: number; runs: EditorProps["runs"]; total: number }) {
  if (!runs.length) {
    return (
      <div className="rounded-lg bg-white border">
        <EmptyState icon={PhoneCall} title="No calls yet" body="Use Test in the top right to talk to this agent. Every call shows up here with its transcript and latency." />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg bg-white border">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <p className="text-[13.5px] text-muted-foreground">
          Showing {runs.length} of {total} calls
        </p>
        <Link href={`/runs?agent=${agentId}`} className="text-[13px] text-foreground hover:underline">
          Open in Agent runs
        </Link>
      </div>
      <Table
        head={
          <tr>
            <th className={th}>Call</th>
            <th className={th}>Type</th>
            <th className={th}>Duration</th>
            <th className={th}>Outcome</th>
            <th className={`${th} w-10`} />
          </tr>
        }
      >
        {runs.map((r) => (
          <tr key={r.id} className={`${tr} group`}>
            <td className={td}>
              <Link href={`/runs/${agentId}/${r.id}`} className="block">
                <span className="block text-foreground">#{r.id}</span>
                <span className="text-[12px] text-muted-foreground">{dateTime(r.createdAt)}</span>
              </Link>
            </td>
            <td className={td}>
              <span className="flex items-center gap-1.5 text-foreground/80">
                {MODE_LABEL[r.mode] ?? humanize(r.mode)}
                {r.hasRecording ? <AudioLines className="size-3.5 text-muted-foreground/70" aria-label="Has recording" /> : null}
              </span>
            </td>
            <td className={`${td} tabular-nums text-foreground/80`}>{duration(r.duration)}</td>
            <td className={td}>
              {r.disposition ? <Badge>{humanize(r.disposition)}</Badge> : r.completed ? <span className="text-muted-foreground/70">–</span> : <Badge tone="blue">In progress</Badge>}
            </td>
            <td className={td}>
              <Link href={`/runs/${agentId}/${r.id}`} aria-label={`Open call ${r.id}`} className="text-muted-foreground/70 transition group-hover:text-foreground">
                <ChevronRight className="size-4" />
              </Link>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
