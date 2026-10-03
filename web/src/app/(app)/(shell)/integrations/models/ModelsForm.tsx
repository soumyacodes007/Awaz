"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Put, type OrganizationAiModelConfigurationV2 } from "@/client";
import { SchemaFields } from "@/components/app/SchemaFields";
import { btn, Card, ErrorNote, FormRow, inputBase, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { type Defaults, languageName, type ModelConfigV2, providerName, schemaDefaults, type Service, type ServiceConfig } from "@/lib/models";

const SERVICES: { id: Service; title: string; body: string }[] = [
  { id: "stt", title: "Transcriber", body: "Turns the caller's speech into text." },
  { id: "llm", title: "Model", body: "Decides what to say and which tools to call." },
  { id: "tts", title: "Voice", body: "Speaks the agent's replies." },
  { id: "embeddings", title: "Embeddings", body: "Indexes knowledge base documents." },
];

export function ModelsForm({ initial, defaults }: { initial: ModelConfigV2 | null; defaults: Defaults }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ModelConfigV2>(
    initial ?? { version: 2, mode: "byok", byok: { mode: "pipeline", pipeline: {} } },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pipelineDefaults = defaults.byok.pipeline;

  function switchMode(mode: "dograh" | "byok") {
    if (mode === cfg.mode) return;
    if (mode === "dograh") {
      setCfg({ version: 2, mode: "dograh", dograh: initial?.dograh ?? { api_key: "", ...defaults.dograh.defaults } });
    } else {
      const pipeline =
        initial?.byok?.pipeline ??
        Object.fromEntries(
          SERVICES.map(({ id }) => {
            const p = pipelineDefaults.default_providers?.[id] ?? Object.keys(pipelineDefaults[id] ?? {})[0];
            return [id, schemaDefaults(pipelineDefaults[id]?.[p], p)];
          }),
        );
      setCfg({ version: 2, mode: "byok", byok: { mode: "pipeline", pipeline } });
    }
  }

  const setService = (s: Service, v: ServiceConfig) =>
    setCfg((c) => ({ ...c, byok: { mode: "pipeline", pipeline: { ...(c.byok?.pipeline ?? {}), [s]: v } } }));

  function changeProvider(s: Service, provider: string) {
    const next = schemaDefaults(pipelineDefaults[s]?.[provider], provider);
    const prev = initial?.byok?.pipeline?.[s];
    if (prev?.provider === provider && prev.api_key) next.api_key = prev.api_key;
    setService(s, next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await saveModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Put({ body: cfg as OrganizationAiModelConfigurationV2 }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't save. Check the keys and model names."));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { v: "byok" as const, t: "Bring your own keys", b: "Pick a provider per stage: Sarvam, Deepgram, OpenAI, Cartesia, ElevenLabs and more." },
          { v: "dograh" as const, t: "Dograh managed", b: "One key from Dograh's hosted model service covers every stage." },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={cfg.mode === o.v}
            onClick={() => switchMode(o.v)}
            className={`rounded-lg bg-white px-4 py-3.5 text-left transition ${cfg.mode === o.v ? "border border-foreground ring-1 ring-foreground" : "border hover:border-foreground/25"}`}
          >
            <span className="block text-[14.5px] text-foreground">{o.t}</span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">{o.b}</span>
          </button>
        ))}
      </div>

      {cfg.mode === "dograh" && cfg.dograh ? (
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <FormRow label="Dograh API key" htmlFor="dg-key" className="sm:col-span-2" hint={cfg.dograh.api_key.includes("*") ? "A key is saved. Paste a new one to replace it." : undefined}>
            <input
              id="dg-key"
              type="password"
              value={cfg.dograh.api_key.includes("*") ? "" : cfg.dograh.api_key}
              placeholder={cfg.dograh.api_key.includes("*") ? cfg.dograh.api_key : "Required"}
              onChange={(e) => setCfg({ ...cfg, dograh: { ...cfg.dograh!, api_key: e.target.value || initial?.dograh?.api_key || "" } })}
              className={`${inputCls} h-10 font-mono text-[13px]`}
            />
          </FormRow>
          <FormRow label="Language" htmlFor="dg-lang">
            <select id="dg-lang" value={cfg.dograh.language ?? "multi"} onChange={(e) => setCfg({ ...cfg, dograh: { ...cfg.dograh!, language: e.target.value } })} className={`${inputCls} h-10`}>
              {defaults.dograh.languages.map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Voice" htmlFor="dg-voice">
            <input id="dg-voice" list="dg-voices" value={cfg.dograh.voice ?? ""} onChange={(e) => setCfg({ ...cfg, dograh: { ...cfg.dograh!, voice: e.target.value } })} className={`${inputCls} h-10`} />
            <datalist id="dg-voices">
              {defaults.dograh.voices.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </FormRow>
        </Card>
      ) : null}

      {cfg.mode === "byok" && cfg.byok?.mode === "realtime" ? (
        <Card className="p-5 text-[13.5px] text-muted-foreground">This workspace uses a realtime speech-to-speech model. Switch to a pipeline by choosing providers below.</Card>
      ) : null}

      {cfg.mode === "byok" && cfg.byok?.mode === "pipeline"
        ? SERVICES.map(({ id, title, body }) => {
            const current = cfg.byok?.pipeline?.[id];
            const providers = Object.keys(pipelineDefaults[id] ?? {});
            return (
              <Card key={id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{body}</p>
                  </div>
                  <select
                    aria-label={`${title} provider`}
                    value={current?.provider ?? ""}
                    onChange={(e) => changeProvider(id, e.target.value)}
                    className={`${inputBase} h-10 w-auto min-w-[200px]`}
                  >
                    {!current ? <option value="">Choose a provider</option> : null}
                    {providers.map((p) => (
                      <option key={p} value={p}>
                        {providerName(p)}
                      </option>
                    ))}
                  </select>
                </div>
                {current ? (
                  <div className="mt-5 border-t border-border pt-5">
                    <SchemaFields schema={pipelineDefaults[id]?.[current.provider]} values={current} onChange={(v) => setService(id, v)} />
                  </div>
                ) : null}
              </Card>
            );
          })
        : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="sticky bottom-4 flex items-center justify-end gap-3">
        {saved ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-[13px] text-emerald-700">Saved and validated</span> : null}
        <button type="submit" disabled={busy} className={btn("primary", "md", "shadow-md")}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {busy ? "Validating keys…" : "Save"}
        </button>
      </div>
    </form>
  );
}
