"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";

import { SwitchRow } from "@/components/app/client";
import { inputCls } from "@/components/app/ui";
import type { Agent } from "@/lib/agent";
import { estimate, PRESETS, type Preset } from "@/lib/estimates";
import { type LatencySummary, STAGE_COLOR } from "@/lib/latency";
import { type Effective, languageName, providerName, type Service, type ServiceConfig } from "@/lib/models";

import { PromptEditor } from "./PromptEditor";
import { Section } from "./types";

const CARDS: { service: Exclude<Service, "embeddings">; label: string }[] = [
  { service: "stt", label: "Transcriber" },
  { service: "llm", label: "Model" },
  { service: "tts", label: "Voice" },
];

const clean = (m: unknown) => (typeof m === "string" ? m.replace(/^[a-z-]+\//, "") : "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lang = (code: unknown) => languageName(code).split(" · ")[0];

/** Title + subtitle for a model card, e.g. "Anushka" / "Sarvam · bulbul:v2". */
function titles(service: Service, cfg: ServiceConfig | null | undefined) {
  if (!cfg) return { title: "Not set", sub: "" };
  const provider = providerName(cfg.provider);
  if (cfg.provider === "dograh") {
    if (service === "tts") return { title: cfg.voice && cfg.voice !== "default" ? cap(String(cfg.voice)) : "Default voice", sub: "Dograh · Managed" };
    return { title: service === "stt" ? "Dograh STT" : "Dograh LLM", sub: service === "stt" ? `Dograh · ${lang(cfg.language)}` : "Dograh · Managed" };
  }
  if (service === "tts") return { title: cfg.voice ? cap(String(cfg.voice)) : clean(cfg.model) || provider, sub: [provider, clean(cfg.model)].filter(Boolean).join(" · ") };
  if (service === "stt") return { title: clean(cfg.model) || provider, sub: [provider, cfg.language ? lang(cfg.language) : ""].filter(Boolean).join(" · ") };
  return { title: clean(cfg.model) || provider, sub: provider };
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4" title={hint}>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function Bar({ parts }: { parts: { color: string; value: number }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="flex h-1.5 w-full gap-0.5">
      {total ? (
        parts.map((p, i) => (p.value ? <span key={i} className="h-full rounded-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null))
      ) : (
        <span className="h-full w-full rounded-full bg-muted" />
      )}
    </div>
  );
}

const chip = (on: boolean) =>
  `h-8 rounded-md border px-3 text-[13px] font-medium transition-colors disabled:opacity-50 ${on ? "border-foreground bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent"}`;

function Overview({
  effective,
  latency,
  toolCount,
  activePreset,
  custom,
  onPreset,
  onEdit,
  readOnly,
}: {
  effective: Effective;
  latency: LatencySummary;
  toolCount: number;
  activePreset: string | null;
  custom: boolean;
  onPreset: (p: Preset | null) => void;
  onEdit: (s: Service) => void;
  readOnly: boolean;
}) {
  const rows = CARDS.map(({ service, label }) => {
    const cfg = effective[service] ?? null;
    const est = estimate(service, cfg);
    const measured = latency[service];
    return { service, label, cfg, cost: est?.costPerMin ?? null, latency: measured ?? est?.latencyMs ?? null, measured: measured != null };
  });
  const sum = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((n, x) => n + (x ?? 0), 0) : null);
  const totalCost = sum(rows.map((r) => r.cost));
  const totalLatency = sum(rows.map((r) => r.latency));
  const allMeasured = rows.every((r) => r.measured);

  return (
    <section className="rounded-lg border bg-card p-5 shadow-xs">
      <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
        <div>
          <p className="text-[13px] text-muted-foreground underline decoration-dotted underline-offset-4" title="Estimated from typical list prices. Your plan may differ.">
            Cost
          </p>
          <div className="mt-1.5 flex items-center gap-4">
            <p className="shrink-0 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {totalCost != null ? `~$${totalCost.toFixed(2)}` : "–"}
              <span className="ml-1 text-sm font-normal text-muted-foreground">/min</span>
            </p>
            <Bar parts={rows.map((r) => ({ color: STAGE_COLOR[r.service], value: r.cost ?? 0 }))} />
          </div>
        </div>
        <div>
          <p
            className="text-[13px] text-muted-foreground underline decoration-dotted underline-offset-4"
            title={allMeasured ? "Median measured from this agent's recent calls." : "Typical numbers until this agent has calls; measured values replace them."}
          >
            Latency{allMeasured ? "" : " (est.)"}
          </p>
          <div className="mt-1.5 flex items-center gap-4">
            <p className="shrink-0 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {totalLatency != null ? `~${totalLatency.toLocaleString("en-IN")}` : "–"}
              <span className="ml-1 text-sm font-normal text-muted-foreground">ms</span>
            </p>
            <Bar parts={rows.map((r) => ({ color: STAGE_COLOR[r.service], value: r.latency ?? 0 }))} />
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        <span className="mr-1.5 text-[13px] text-muted-foreground underline decoration-dotted underline-offset-4" title="One click sets transcriber, model and voice for this agent.">
          Model presets
        </span>
        <button type="button" disabled={readOnly} onClick={() => onPreset(null)} className={chip(!custom)}>
          Workspace default
        </button>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" disabled={readOnly} onClick={() => onPreset(p)} className={chip(custom && activePreset === p.id)}>
            {p.label}
          </button>
        ))}
        {custom && !activePreset ? <span className="ml-1 text-[13px] font-medium text-foreground italic">Customized</span> : null}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {rows.map((r) => {
          const t = titles(r.service, r.cfg);
          const third =
            r.service === "stt"
              ? { label: "Language", value: r.cfg?.language ? lang(r.cfg.language) : "Auto" }
              : r.service === "llm"
                ? { label: "Tools", value: String(toolCount) }
                : { label: "Speed", value: `${Number(r.cfg?.speed ?? 1).toFixed(1)}×` };
          return (
            <div key={r.service} className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-start justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <span className="size-2 rounded-full" style={{ background: STAGE_COLOR[r.service] }} />
                  {r.label}
                </span>
                <button
                  type="button"
                  onClick={() => onEdit(r.service)}
                  disabled={readOnly}
                  aria-label={`Edit ${r.label.toLowerCase()}`}
                  className="flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-xs transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
              <p className="mt-2 truncate text-base font-semibold tracking-tight text-foreground">{t.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-primary text-[9px] font-semibold text-primary-foreground uppercase">
                  {(r.cfg?.provider ?? "?").charAt(0)}
                </span>
                {t.sub}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Metric label="Latency" value={r.latency != null ? `${r.latency}ms` : "–"} hint={r.measured ? "Median from recent calls" : "Typical, until this agent has calls"} />
                <Metric label="Cost" value={r.cost != null ? `$${r.cost < 0.01 ? r.cost.toFixed(3) : r.cost.toFixed(2)}/min` : "–"} hint="Estimated from list prices" />
                <Metric label={third.label} value={third.value} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AgentTab({
  agent,
  update,
  effective,
  custom,
  activePreset,
  latency,
  clips,
  onEditModels,
  onPreset,
  readOnly,
}: {
  agent: Agent;
  update: (patch: Partial<Agent>) => void;
  effective: Effective;
  custom: boolean;
  activePreset: string | null;
  latency: LatencySummary;
  clips: { id: string; transcript: string }[];
  onEditModels: (s: Service) => void;
  onPreset: (p: Preset | null) => void;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-5">
      <Overview
        effective={effective}
        latency={latency}
        toolCount={agent.tool_uuids.length}
        activePreset={activePreset}
        custom={custom}
        onPreset={onPreset}
        onEdit={onEditModels}
        readOnly={readOnly}
      />

      <PromptEditor value={agent.prompt} onChange={(v) => update({ prompt: v })} readOnly={readOnly} />

      <Section
        title="First message"
        sub="What the agent says when the call connects. Leave it empty to let the agent open from the prompt."
        actions={
          <div className="inline-flex rounded-md border p-0.5">
            {(["text", "audio"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={readOnly}
                onClick={() => update({ greeting: { ...agent.greeting, type: t } })}
                aria-pressed={agent.greeting.type === t}
                className={`h-7 rounded-sm px-2.5 text-[13px] transition-colors ${
                  agent.greeting.type === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "text" ? "Spoken text" : "Audio clip"}
              </button>
            ))}
          </div>
        }
      >
        {agent.greeting.type === "text" ? (
          <input
            aria-label="First message"
            value={agent.greeting.text ?? ""}
            onChange={(e) => update({ greeting: { ...agent.greeting, text: e.target.value || null } })}
            readOnly={readOnly}
            placeholder="Namaste! Thanks for calling. How can I help you today?"
            className={`${inputCls} h-10`}
          />
        ) : clips.length ? (
          <select
            aria-label="Audio clip"
            disabled={readOnly}
            value={agent.greeting.recording_id ?? ""}
            onChange={(e) => update({ greeting: { ...agent.greeting, recording_id: e.target.value || null } })}
            className={`${inputCls} h-10`}
          >
            <option value="">Choose a clip…</option>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.transcript ? `${c.transcript.slice(0, 80)}${c.transcript.length > 80 ? "…" : ""}` : c.id}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No audio clips yet.{" "}
            <Link href="/resources/audio" className="font-medium text-foreground underline underline-offset-4">
              Upload one in Resources
            </Link>
            .
          </p>
        )}
        <div className="mt-4 border-t pt-4">
          <SwitchRow
            title="Caller can interrupt"
            body="Stop speaking as soon as the caller starts talking. Turn off for disclosures that must be heard in full."
            checked={agent.allow_interrupt}
            onChange={(v) => !readOnly && update({ allow_interrupt: v })}
          />
        </div>
      </Section>
    </div>
  );
}
