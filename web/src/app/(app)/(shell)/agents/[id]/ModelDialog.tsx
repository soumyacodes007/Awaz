"use client";

import Link from "next/link";
import { useState } from "react";

import { Modal } from "@/components/app/client";
import { SchemaFields } from "@/components/app/SchemaFields";
import { btn, FormRow, inputCls } from "@/components/app/ui";
import {
  type Defaults,
  describe,
  effectiveOf,
  languageName,
  type ModelConfigV2,
  providerName,
  schemaDefaults,
  type Service,
  SERVICE_LABEL,
} from "@/lib/models";

const PIPELINE: Service[] = ["stt", "llm", "tts"];
// Indian languages first in the Dograh-managed language list.
const PREFERRED = ["multi", "hi", "en-IN", "en", "bn", "ta", "te", "mr", "kn"];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function ModelDialog({
  open,
  initialService = "llm",
  onClose,
  orgConfig,
  override,
  defaults,
  onSave,
}: {
  open: boolean;
  initialService?: Service;
  onClose: () => void;
  orgConfig: ModelConfigV2 | null;
  override: ModelConfigV2 | null;
  defaults: Defaults | null;
  onSave: (next: ModelConfigV2 | null) => void;
}) {
  const [custom, setCustom] = useState(Boolean(override));
  const [draft, setDraft] = useState<ModelConfigV2 | null>(() => clone(override ?? orgConfig));
  const [svc, setSvc] = useState<Service>(initialService === "embeddings" ? "llm" : initialService);

  const orgEffective = effectiveOf(orgConfig);

  function setService(service: Service, value: Record<string, unknown>) {
    setDraft((d) => {
      if (!d?.byok?.pipeline) return d;
      return { ...d, byok: { ...d.byok, pipeline: { ...d.byok.pipeline, [service]: value as never } } };
    });
  }

  function changeProvider(service: Service, provider: string) {
    const schema = defaults?.byok.pipeline[service]?.[provider];
    const next = schemaDefaults(schema, provider);
    // Same provider as the workspace: reuse its saved (masked) key, which the
    // backend swaps for the real one. A different provider needs a new key.
    const orgService = orgConfig?.byok?.pipeline?.[service];
    if (orgService?.provider === provider && orgService.api_key) next.api_key = orgService.api_key;
    setService(service, next);
  }

  const languages = defaults
    ? [...PREFERRED.filter((l) => defaults.dograh.languages.includes(l)), ...defaults.dograh.languages.filter((l) => !PREFERRED.includes(l))]
    : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={680}
      title="Models"
      sub="Agents use the workspace models unless you give them their own."
      footer={
        <>
          <button type="button" onClick={onClose} className={btn("ghost")}>
            Cancel
          </button>
          <button
            type="button"
            disabled={custom && !draft}
            onClick={() => {
              onSave(custom ? draft : null);
              onClose();
            }}
            className={btn("primary")}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { v: false, t: "Workspace models", b: "Follow whatever is set in Integrations." },
          { v: true, t: "Custom for this agent", b: "Pick a different voice, language or model." },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            aria-pressed={custom === o.v}
            onClick={() => setCustom(o.v)}
            className={`rounded-md px-3.5 py-3 text-left transition ${custom === o.v ? "border border-foreground ring-1 ring-foreground" : "border hover:border-foreground/25"}`}
          >
            <span className="block text-[14px] text-foreground">{o.t}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{o.b}</span>
          </button>
        ))}
      </div>

      {!custom ? (
        <div className="mt-5 space-y-2 rounded-md bg-muted p-4">
          {orgEffective ? (
            PIPELINE.map((s) => {
              const d = describe(s, orgEffective[s] ?? null);
              return (
                <div key={s} className="flex items-baseline justify-between gap-4 text-[13.5px]">
                  <span className="text-muted-foreground">{SERVICE_LABEL[s]}</span>
                  <span className="truncate text-foreground">
                    {d.provider}
                    {d.detail ? <span className="text-muted-foreground"> · {d.detail}</span> : null}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-[13px] text-muted-foreground">No workspace models are set yet.</p>
          )}
          <Link href="/integrations/models" className="inline-block pt-1 text-[13px] text-foreground hover:underline">
            Edit workspace models
          </Link>
        </div>
      ) : !draft ? (
        <p className="mt-5 text-[13px] text-muted-foreground">
          Set up workspace models first in{" "}
          <Link href="/integrations/models" className="text-foreground hover:underline">
            Integrations
          </Link>
          .
        </p>
      ) : draft.mode === "dograh" && draft.dograh ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FormRow label="Language" htmlFor="m-lang" hint="Auto-detect handles callers who switch languages.">
            <select
              id="m-lang"
              value={draft.dograh.language ?? "multi"}
              onChange={(e) => setDraft({ ...draft, dograh: { ...draft.dograh!, language: e.target.value } })}
              className={`${inputCls} h-10`}
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Voice" htmlFor="m-voice">
            <input
              id="m-voice"
              list="m-voices"
              value={draft.dograh.voice ?? ""}
              onChange={(e) => setDraft({ ...draft, dograh: { ...draft.dograh!, voice: e.target.value } })}
              className={`${inputCls} h-10`}
            />
            <datalist id="m-voices">
              {defaults?.dograh.voices.map((v) => <option key={v} value={v} />)}
            </datalist>
          </FormRow>
          <FormRow label={`Speaking speed · ${(draft.dograh.speed ?? 1).toFixed(1)}×`} htmlFor="m-speed" className="sm:col-span-2">
            <input
              id="m-speed"
              type="range"
              min={defaults?.dograh.speed_range?.min ?? 0.5}
              max={defaults?.dograh.speed_range?.max ?? 2}
              step={defaults?.dograh.speed_range?.step ?? 0.1}
              value={draft.dograh.speed ?? 1}
              onChange={(e) => setDraft({ ...draft, dograh: { ...draft.dograh!, speed: Number(e.target.value) } })}
              className="w-full accent-foreground"
            />
          </FormRow>
        </div>
      ) : draft.mode === "byok" && draft.byok?.mode === "pipeline" && draft.byok.pipeline ? (
        <div className="mt-5">
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {PIPELINE.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSvc(s)}
                aria-pressed={svc === s}
                className={`rounded-md px-3 py-1.5 text-[13px] transition ${svc === s ? "bg-white text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
              >
                {SERVICE_LABEL[s]}
              </button>
            ))}
          </div>
          {(() => {
            const current = draft.byok.pipeline[svc];
            const providers = Object.keys(defaults?.byok.pipeline[svc] ?? {}).filter((p) => p !== "default_providers");
            return (
              <div className="mt-4 space-y-4">
                <FormRow label="Provider" htmlFor="m-provider">
                  <select
                    id="m-provider"
                    value={current?.provider ?? ""}
                    onChange={(e) => changeProvider(svc, e.target.value)}
                    className={`${inputCls} h-10`}
                  >
                    {!current ? <option value="">Choose…</option> : null}
                    {providers.map((p) => (
                      <option key={p} value={p}>
                        {providerName(p)}
                      </option>
                    ))}
                  </select>
                </FormRow>
                {current ? (
                  <SchemaFields schema={defaults?.byok.pipeline[svc]?.[current.provider]} values={current} onChange={(v) => setService(svc, v)} />
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : (
        <p className="mt-5 text-[13px] text-muted-foreground">
          This workspace uses a realtime speech-to-speech model, which is set at the workspace level in Integrations.
        </p>
      )}
    </Modal>
  );
}
