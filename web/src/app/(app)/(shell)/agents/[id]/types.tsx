import type { Definition } from "@/lib/agent";
import type { LatencySummary } from "@/lib/latency";
import type { Defaults, Effective, ModelConfigV2 } from "@/lib/models";

export type Configs = Record<string, unknown>;

export type EditorProps = {
  agent: {
    id: number;
    name: string;
    uuid: string | null;
    versionNumber: number | null;
    versionStatus: string | null;
    definition: Definition;
    configs: Configs;
  };
  tools: { uuid: string; name: string; description: string | null; category: string }[];
  documents: { uuid: string; name: string; status: string }[];
  clips: { id: string; transcript: string }[];
  credentials: { uuid: string; name: string }[];
  org: { config: ModelConfigV2 | null; effective: Effective };
  defaults: Defaults | null;
  runs: {
    id: number;
    createdAt: string;
    mode: string;
    completed: boolean;
    duration: number | null;
    disposition: string | null;
    phone: string | null;
    hasRecording: boolean;
  }[];
  totalRuns: number;
  latency: LatencySummary;
  telephony: { id: number; name: string; ready: boolean }[];
  testPhone: string | null;
};

/** Small card used for each settings block inside the editor tabs. */
export function Section({
  title,
  sub,
  actions,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg bg-white border">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
          {sub ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{sub}</p> : null}
        </div>
        {actions}
      </div>
      <div className="px-5 pt-4 pb-5">{children}</div>
    </section>
  );
}
