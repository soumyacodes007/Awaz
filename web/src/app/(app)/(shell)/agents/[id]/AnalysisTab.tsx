"use client";

import { Plus, Trash2 } from "lucide-react";

import { Switch, SwitchRow } from "@/components/app/client";
import { btn, FormRow, inputCls } from "@/components/app/ui";
import type { AgentFields, Qa, Variable } from "@/lib/agent";

import { Section } from "./types";

type Disposition = { code: string; description: string };

const DEFAULT_QA: Qa = { enabled: true, systemPrompt: "", minCallDuration: 15, sampleRate: 100, includeVoicemail: false };

export function AnalysisTab({
  fields,
  set,
  dispositions,
  onDispositions,
  qa,
  onQa,
  readOnly,
}: {
  fields: AgentFields;
  set: <K extends keyof AgentFields>(k: K, v: AgentFields[K]) => void;
  dispositions: Disposition[];
  onDispositions: (v: Disposition[]) => void;
  qa: Qa | null;
  onQa: (v: Qa | null) => void;
  readOnly: boolean;
}) {
  const vars = fields.variables;
  const setVar = (i: number, patch: Partial<Variable>) => set("variables", vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  return (
    <fieldset disabled={readOnly} className="space-y-5">
      <Section
        title="Structured outputs"
        sub="Data the agent pulls out of every call, like a booking date or whether the lead is interested. It shows up on each call and in webhooks."
        actions={<Switch checked={fields.extractionEnabled} onChange={(v) => set("extractionEnabled", v)} label="Extract structured outputs" />}
      >
        {fields.extractionEnabled ? (
          <div className="space-y-4">
            <FormRow label="Instructions" htmlFor="x-prompt" hint="Optional guidance for the extractor across all fields.">
              <textarea
                id="x-prompt"
                rows={2}
                value={fields.extractionPrompt}
                onChange={(e) => set("extractionPrompt", e.target.value)}
                placeholder="Extract details only if the caller said them explicitly."
                className={`${inputCls} resize-y py-2.5`}
              />
            </FormRow>
            <div className="space-y-2">
              {vars.map((v, i) => (
                <div key={i} className="grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-[180px_120px_minmax(0,1fr)_auto]">
                  <input
                    aria-label="Field name"
                    value={v.name}
                    onChange={(e) => setVar(i, { name: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
                    placeholder="appointment_date"
                    className={`${inputCls} h-9 font-mono text-[13px]`}
                  />
                  <select aria-label="Type" value={v.type} onChange={(e) => setVar(i, { type: e.target.value as Variable["type"] })} className={`${inputCls} h-9`}>
                    <option value="string">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Yes / no</option>
                  </select>
                  <input
                    aria-label="What to look for"
                    value={v.prompt ?? ""}
                    onChange={(e) => setVar(i, { prompt: e.target.value })}
                    placeholder="The date the caller wants to visit"
                    className={`${inputCls} h-9`}
                  />
                  <button
                    type="button"
                    onClick={() => set("variables", vars.filter((_, j) => j !== i))}
                    aria-label="Remove field"
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => set("variables", [...vars, { name: "", type: "string", prompt: "" }])} className={btn("secondary", "sm")}>
                <Plus className="size-3.5" /> Add field
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Off. Turn on to define fields.</p>
        )}
      </Section>

      <Section
        title="Call outcomes"
        sub="The outcomes a finished call can be classified into. The model picks one at the end of each call, and you can filter calls by it."
      >
        <div className="space-y-2">
          {dispositions.map((d, i) => (
            <div key={i} className="grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
              <input
                aria-label="Outcome code"
                value={d.code}
                onChange={(e) => onDispositions(dispositions.map((x, j) => (j === i ? { ...x, code: e.target.value.replace(/\s+/g, "_").toUpperCase() } : x)))}
                placeholder="APPOINTMENT_BOOKED"
                className={`${inputCls} h-9 font-mono text-[13px]`}
              />
              <input
                aria-label="When to pick it"
                value={d.description}
                onChange={(e) => onDispositions(dispositions.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                placeholder="The caller confirmed a date and time"
                className={`${inputCls} h-9`}
              />
              <button
                type="button"
                onClick={() => onDispositions(dispositions.filter((_, j) => j !== i))}
                aria-label="Remove outcome"
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-red-600"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onDispositions([...dispositions, { code: "", description: "" }])} className={btn("secondary", "sm")}>
            <Plus className="size-3.5" /> Add outcome
          </button>
        </div>
      </Section>

      <Section
        title="Quality review"
        sub="After each call, an LLM reviews the transcript and scores it. Results appear on the call's page."
        actions={<Switch checked={Boolean(qa)} onChange={(v) => onQa(v ? (qa ?? DEFAULT_QA) : null)} label="Quality review" />}
      >
        {qa ? (
          <div className="space-y-4">
            <FormRow label="Reviewer instructions" htmlFor="qa-prompt" hint="Leave empty to use the default review: summary, sentiment, quality score and tags.">
              <textarea
                id="qa-prompt"
                rows={4}
                value={qa.systemPrompt}
                onChange={(e) => onQa({ ...qa, systemPrompt: e.target.value })}
                className={`${inputCls} resize-y py-2.5 font-mono text-[13px]`}
              />
            </FormRow>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Skip calls shorter than (seconds)" htmlFor="qa-min">
                <input
                  id="qa-min"
                  type="number"
                  min={0}
                  value={qa.minCallDuration}
                  onChange={(e) => onQa({ ...qa, minCallDuration: Number(e.target.value) })}
                  className={`${inputCls} h-10`}
                />
              </FormRow>
              <FormRow label={`Review ${qa.sampleRate}% of calls`} htmlFor="qa-rate">
                <input
                  id="qa-rate"
                  type="range"
                  min={1}
                  max={100}
                  value={qa.sampleRate}
                  onChange={(e) => onQa({ ...qa, sampleRate: Number(e.target.value) })}
                  className="mt-3 w-full accent-foreground"
                />
              </FormRow>
            </div>
            <SwitchRow title="Include voicemail calls" checked={qa.includeVoicemail} onChange={(v) => onQa({ ...qa, includeVoicemail: v })} />
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Off.</p>
        )}
      </Section>
    </fieldset>
  );
}
