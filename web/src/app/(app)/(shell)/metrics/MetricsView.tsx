"use client";

import "@/components/arc/foundation.css";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import type { MetricsResponse } from "@/client";
import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import { DonutChart } from "@/components/arc/donut-chart/donut-chart";
import { LineChart, type LineChartDatum } from "@/components/arc/line-chart/line-chart";
import { Badge, Card } from "@/components/app/ui";
import { dateTime, duration, humanize } from "@/lib/format";

import { TIMEZONE } from "./ranges";

// Vapi's colour coding: minutes green, calls amber, spend violet, cost per call blue.
const GREEN = "#10b981";
const AMBER = "#f59e0b";
const VIOLET = "#8b5cf6";
const BLUE = "#3b82f6";
const AGENT_COLORS = [GREEN, BLUE, VIOLET, AMBER];
const COMPONENT_COLORS: Record<string, string> = { llm: GREEN, stt: BLUE, tts: VIOLET, telephony: AMBER };
const COMPONENT_LABELS: Record<string, string> = { llm: "LLM", stt: "STT", tts: "TTS", telephony: "Telephony" };
const SUCCESS = [
  { key: "pass", label: "Pass (7+)", color: GREEN },
  { key: "needs_review", label: "Needs review (4–6)", color: AMBER },
  { key: "fail", label: "Fail (≤3)", color: "#ef4444" },
  { key: "not_reviewed", label: "Not reviewed", color: "#a1a1aa" },
] as const;

const money = (n: number) => (n >= 1 || n === 0 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`);
const moneyTick = (n: number) => (n === 0 ? "$0" : `$${Number(n.toPrecision(2))}`);
const minutes = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(2));

type Bucket = MetricsResponse["buckets"][number];

/** Tooltip and axis labels for a bucket, in the dashboard's timezone. */
function labels(buckets: Bucket[], group: MetricsResponse["group_by"]) {
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-IN", { timeZone: TIMEZONE, ...o });
  const every = Math.max(1, Math.ceil(buckets.length / 7));
  return buckets.map((b, i) => {
    const full =
      group === "hour"
        ? fmt(b.start, { day: "numeric", month: "short", hour: "numeric" })
        : group === "week"
          ? `Week of ${fmt(b.start, { day: "numeric", month: "short" })}`
          : fmt(b.start, { weekday: "short", day: "numeric", month: "short" });
    const axis = group === "hour" ? fmt(b.start, { hour: "numeric" }) : fmt(b.start, { day: "numeric", month: "short" });
    return { key: b.start, label: full, axisLabel: i % every === 0 || i === buckets.length - 1 ? axis : undefined };
  });
}

function Panel({ title, sub, children, className = "" }: { title: string; sub?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`flex flex-col p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {sub ? <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p> : null}
      </div>
      <div className="arc min-w-0 flex-1">{children}</div>
    </Card>
  );
}

function Kpi({
  label,
  value,
  note,
  color,
  data,
  unit,
  format,
  tick = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Number(n.toPrecision(2)))),
}: {
  label: string;
  value: string;
  note?: string;
  color: string;
  data: LineChartDatum[];
  unit: string;
  format: (n: number) => string;
  tick?: (n: number) => string;
}) {
  return (
    <Card className="overflow-hidden p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : <p className="mt-0.5 text-xs">&nbsp;</p>}
      <div className="arc -mx-1 mt-3">
        <LineChart label={label} data={data} series={[{ key: "v", label, color, area: true }]} height={96} unit={unit} legend={false} formatValue={(n) => format(n)} formatTick={tick} />
      </div>
    </Card>
  );
}

export function MetricsView({ metrics: m }: { metrics: MetricsResponse }) {
  const axis = labels(m.buckets, m.group_by);
  const point = (pick: (b: Bucket) => number | null | undefined) => m.buckets.map((b, i) => ({ ...axis[i], values: { v: pick(b) ?? 0 } }));
  const t = m.totals;
  const period = `${new Date(m.start_at).toLocaleDateString("en-IN", { timeZone: TIMEZONE, day: "numeric", month: "short" })} – ${new Date(m.end_at).toLocaleDateString("en-IN", { timeZone: TIMEZONE, day: "numeric", month: "short", year: "numeric" })}`;
  const estimated = t.cost_estimated ? "Estimated from list prices" : undefined;

  // Duration by agent: one line per busiest agent (top four), in minutes.
  const topAgents = m.agents.slice(0, 4);
  const durationData = m.buckets.map((b, i) => ({
    ...axis[i],
    values: Object.fromEntries(topAgents.map((a) => [String(a.workflow_id), (b.avg_duration_by_agent[String(a.workflow_id)] ?? 0) / 60])),
  }));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total call minutes" value={minutes(t.minutes)} color={GREEN} data={point((b) => b.minutes)} unit="min" format={(n) => n.toFixed(2)} />
        <Kpi label="Number of calls" value={t.calls.toLocaleString("en-IN")} color={AMBER} data={point((b) => b.calls)} unit="calls" format={(n) => n.toFixed(0)} />
        <Kpi label="Total spent" value={money(t.spend_usd)} note={estimated} color={VIOLET} data={point((b) => b.spend_usd)} unit="" format={money} tick={moneyTick} />
        <Kpi label="Average cost per call" value={t.avg_cost_usd != null ? money(t.avg_cost_usd) : "–"} note={estimated} color={BLUE} data={point((b) => b.avg_cost_usd)} unit="" format={money} tick={moneyTick} />
      </div>

      <div className="mt-2 flex items-center gap-3">
        <h2 className="shrink-0 text-lg font-semibold tracking-tight text-foreground">Call analysis</h2>
        <span className="h-px flex-1 bg-border" />
        {m.truncated ? <Badge tone="amber">Showing the first 20,000 calls</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Reason call ended" sub="How each call finished.">
          <DonutChart
            label="Reason call ended"
            unit="calls"
            totalLabel="Calls"
            size={180}
            data={m.ended_reasons.map((r) => ({ key: r.key, label: humanize(r.key), value: r.count }))}
          />
        </Panel>

        <Panel title="Average call duration by agent" sub={topAgents.length < m.agents.length ? "Your four busiest agents, in minutes." : "In minutes."}>
          <LineChart
            label="Average call duration by agent"
            data={durationData}
            series={topAgents.map((a, i) => ({ key: String(a.workflow_id), label: a.name, color: AGENT_COLORS[i], area: i === 0 }))}
            height={200}
            unit="min"
            formatValue={(n) => n.toFixed(2)}
            legend
          />
        </Panel>

        <Panel title="Cost breakdown" sub={t.cost_estimated ? "Estimated from measured usage and list prices." : "Recorded charges."}>
          <DonutChart
            label="Cost breakdown"
            totalLabel="Spent"
            size={180}
            formatValue={money}
            groupBelow={0}
            data={Object.entries(m.cost_breakdown).map(([k, v]) => ({ key: k, label: COMPONENT_LABELS[k] ?? humanize(k), value: v, color: COMPONENT_COLORS[k] }))}
            emptyLabel="No cost yet"
          />
        </Panel>

        <Panel title="Success evaluation" sub={t.success_rate != null ? `${Math.round(t.success_rate * 100)}% of ${t.reviewed_calls} reviewed calls passed. Scores come from quality review.` : "Turn on quality review on an agent's Analysis tab to score calls."}>
          <DonutChart
            label="Success evaluation"
            unit="calls"
            totalLabel="Calls"
            size={180}
            groupBelow={0}
            data={SUCCESS.map((s) => ({ key: s.key, label: s.label, value: m.success[s.key] ?? 0, color: s.color }))}
          />
        </Panel>

        <Panel title="Unsuccessful calls" sub="Errors, failed reviews and calls that never finished.">
          {m.unsuccessful_calls.length ? (
            <div className="flex h-full flex-col">
              <ul className="-mx-2 flex-1 divide-y divide-border">
                {m.unsuccessful_calls.map((c) => (
                  <li key={c.id}>
                    <Link href={`/logs?call=${c.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-foreground">{c.workflow_name}</span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">
                          {dateTime(c.created_at)} · {duration(c.duration_seconds)}
                        </span>
                      </span>
                      <Badge tone="red">{humanize(c.reason)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/logs" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-foreground hover:underline">
                View all calls <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">None in this period.</p>
          )}
        </Panel>

        <Panel title="Number of concurrent calls" sub={`Peak ${t.peak_concurrency} at once.`}>
          <div style={{ ["--accent" as string]: BLUE }}>
            <BarChart
              label="Peak concurrent calls"
              period={period}
              unit="calls"
              averageLabel="Average peak"
              valueLabel="Peak"
              categoryLabel={m.group_by === "hour" ? "Hour" : m.group_by === "week" ? "Week" : "Day"}
              height={160}
              data={m.buckets.map((b, i) => ({ ...axis[i], value: b.peak_concurrency }))}
              formatValue={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}
