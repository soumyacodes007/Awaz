"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CopyButton, Switch, SwitchRow } from "@/components/app/client";
import { btn, FormRow, inputCls } from "@/components/app/ui";
import { type AgentFields, DEFAULT_WEBHOOK_PAYLOAD, type Webhook } from "@/lib/agent";

import { type Configs, Section } from "./types";

// Runtime defaults from Dograh's WorkflowConfigurationDefaults.
const DEFAULTS = {
  max_call_duration: 300,
  max_user_idle_timeout: 10,
  smart_turn_stop_secs: 2,
  turn_stop_strategy: "transcription",
  turn_start_strategy: "min_words",
  turn_start_min_words: 2,
};

function NumberField({
  id,
  label,
  hint,
  value,
  fallback,
  onChange,
  min,
  max,
  step = 1,
}: {
  id: string;
  label: string;
  hint?: string;
  value: unknown;
  fallback: number;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <FormRow label={label} htmlFor={id} hint={hint}>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={typeof value === "number" ? value : ""}
        placeholder={String(fallback)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className={`${inputCls} h-10`}
      />
    </FormRow>
  );
}

function WebhookCard({
  hook,
  credentials,
  onChange,
  onRemove,
}: {
  hook: Webhook;
  credentials: { uuid: string; name: string }[];
  onChange: (h: Webhook) => void;
  onRemove: () => void;
}) {
  const [payload, setPayload] = useState(() => JSON.stringify(hook.payload, null, 2));
  const [bad, setBad] = useState(false);
  useEffect(() => setPayload(JSON.stringify(hook.payload, null, 2)), [hook.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3 rounded-md bg-muted p-4">
      <div className="flex items-center gap-3">
        <Switch checked={hook.enabled} onChange={(v) => onChange({ ...hook, enabled: v })} label="Webhook enabled" />
        <input
          aria-label="Webhook name"
          value={hook.name}
          onChange={(e) => onChange({ ...hook, name: e.target.value })}
          className={`${inputCls} h-9 max-w-[240px]`}
        />
        <button type="button" onClick={onRemove} aria-label="Remove webhook" className="ml-auto flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-red-600">
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
        <select aria-label="Method" value={hook.method} onChange={(e) => onChange({ ...hook, method: e.target.value })} className={`${inputCls} h-10`}>
          {["POST", "PUT", "PATCH", "GET", "DELETE"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          aria-label="Endpoint URL"
          type="url"
          value={hook.url}
          onChange={(e) => onChange({ ...hook, url: e.target.value })}
          placeholder="https://api.example.com/calls"
          className={`${inputCls} h-10`}
        />
      </div>
      <FormRow label="Authentication" htmlFor={`cred-${hook.id}`}>
        <select
          id={`cred-${hook.id}`}
          value={hook.credentialUuid ?? ""}
          onChange={(e) => onChange({ ...hook, credentialUuid: e.target.value || null })}
          className={`${inputCls} h-10`}
        >
          <option value="">None</option>
          {credentials.map((c) => (
            <option key={c.uuid} value={c.uuid}>
              {c.name}
            </option>
          ))}
        </select>
      </FormRow>
      <FormRow
        label="Body"
        htmlFor={`payload-${hook.id}`}
        hint={bad ? <span className="text-red-600">Not valid JSON yet. Changes are saved once it parses.</span> : "JSON with {{variables}} like {{gathered_context.name}} or {{recording_url}}."}
      >
        <textarea
          id={`payload-${hook.id}`}
          rows={7}
          value={payload}
          onChange={(e) => {
            setPayload(e.target.value);
            try {
              const parsed = JSON.parse(e.target.value);
              setBad(false);
              onChange({ ...hook, payload: parsed });
            } catch {
              setBad(true);
            }
          }}
          className={`${inputCls} resize-y py-2.5 font-mono text-[12.5px] leading-relaxed`}
        />
      </FormRow>
    </div>
  );
}

export function AdvancedTab({
  agentId,
  fields,
  set,
  configs,
  setConfig,
  trigger,
  onTrigger,
  webhooks,
  onWebhooks,
  credentials,
  onArchive,
  readOnly,
}: {
  agentId: number;
  fields: AgentFields;
  set: <K extends keyof AgentFields>(k: K, v: AgentFields[K]) => void;
  configs: Configs;
  setConfig: (key: string, value: unknown) => void;
  trigger: { enabled: boolean; path: string | null } | null;
  onTrigger: (enabled: boolean) => void;
  webhooks: Webhook[];
  onWebhooks: (v: Webhook[]) => void;
  credentials: { uuid: string; name: string }[];
  onArchive: () => void;
  readOnly: boolean;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = trigger?.path ? `${origin}/api/v1/public/agent/${trigger.path}` : null;
  const curl = url
    ? `curl -X POST ${url} \\\n  -H "X-API-Key: $AWAZ_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"phone_number": "+919876543210", "initial_context": {"first_name": "Asha"}}'`
    : "";

  return (
    <fieldset disabled={readOnly} className="space-y-5">
      <Section title="Call limits">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="max-dur"
            label="Maximum call length (seconds)"
            hint="Up to 1200 seconds (20 minutes)."
            value={configs.max_call_duration}
            fallback={DEFAULTS.max_call_duration}
            min={30}
            max={1200}
            onChange={(v) => setConfig("max_call_duration", v)}
          />
          <NumberField
            id="idle"
            label="Hang up after silence (seconds)"
            hint="How long the caller can stay quiet before the call ends."
            value={configs.max_user_idle_timeout}
            fallback={DEFAULTS.max_user_idle_timeout}
            min={3}
            step={0.5}
            onChange={(v) => setConfig("max_user_idle_timeout", v)}
          />
        </div>
      </Section>

      <Section title="Turn-taking" sub="How the agent decides the caller has finished speaking.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="End of turn" htmlFor="turn-stop">
            <select
              id="turn-stop"
              value={(configs.turn_stop_strategy as string) ?? DEFAULTS.turn_stop_strategy}
              onChange={(e) => setConfig("turn_stop_strategy", e.target.value)}
              className={`${inputCls} h-10`}
            >
              <option value="transcription">When the transcript is final (faster)</option>
              <option value="turn_analyzer">Smart turn detection (fewer interruptions)</option>
            </select>
          </FormRow>
          <NumberField
            id="smart-stop"
            label="Wait before replying (seconds)"
            hint="Used by smart turn detection."
            value={configs.smart_turn_stop_secs}
            fallback={DEFAULTS.smart_turn_stop_secs}
            min={0.2}
            step={0.1}
            onChange={(v) => setConfig("smart_turn_stop_secs", v)}
          />
          <NumberField
            id="min-words"
            label="Words needed to interrupt the agent"
            hint="Stops background noise and 'hmm' from cutting the agent off."
            value={configs.turn_start_min_words}
            fallback={DEFAULTS.turn_start_min_words}
            min={1}
            onChange={(v) => {
              setConfig("turn_start_strategy", "min_words");
              setConfig("turn_start_min_words", v);
            }}
          />
        </div>
        <div className="mt-5 space-y-4 border-t border-border pt-4">
          <SwitchRow
            title="Summarise long conversations"
            body="Compacts older turns so long calls stay fast and cheap."
            checked={configs.context_compaction_enabled === true}
            onChange={(v) => setConfig("context_compaction_enabled", v)}
          />
          <SwitchRow
            title="Cache repeated phrases"
            body="Reuse generated audio for lines the agent says often. Supported for MiniMax voices."
            checked={configs.tts_cache_enabled === true}
            onChange={(v) => setConfig("tts_cache_enabled", v)}
          />
          <SwitchRow
            title="Wait before speaking on outbound calls"
            body="Listen first so voicemail and call screening are handled properly."
            checked={fields.delayedStart}
            onChange={(v) => set("delayedStart", v)}
          />
          {fields.delayedStart ? (
            <NumberField
              id="delay"
              label="Listening window (seconds)"
              value={fields.delayedStartDuration}
              fallback={1.2}
              min={0.1}
              max={10}
              step={0.1}
              onChange={(v) => set("delayedStartDuration", v ?? null)}
            />
          ) : null}
        </div>
      </Section>

      <Section title="Pronunciation" sub="Words the transcriber should expect, like product or place names. One per line, or comma separated.">
        <textarea
          aria-label="Pronunciation dictionary"
          rows={3}
          value={(configs.dictionary as string) ?? ""}
          onChange={(e) => setConfig("dictionary", e.target.value)}
          placeholder={"Awaz\nKoramangala\nDolo 650"}
          className={`${inputCls} resize-y py-2.5`}
        />
      </Section>

      <Section
        title="Start calls from your backend"
        sub={
          <>
            A private URL that starts an outbound call with this agent. Needs an{" "}
            <Link href="/api-keys" className="text-foreground hover:underline">
              API key
            </Link>
            .
          </>
        }
        actions={<Switch checked={Boolean(trigger?.enabled)} onChange={onTrigger} label="API trigger" />}
      >
        {trigger?.enabled ? (
          url ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md bg-muted px-3.5 py-2.5 font-mono text-[12.5px] text-foreground border">
                <span className="shrink-0 rounded bg-emerald-50 px-1.5 text-[11px] text-emerald-700">POST</span>
                <span className="min-w-0 flex-1 truncate">{url}</span>
                <CopyButton value={url} label="Copy URL" />
              </div>
              <div className="relative">
                <pre className="overflow-x-auto rounded-md bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-100">{curl}</pre>
                <div className="absolute top-2 right-2 rounded-md bg-white/10 [&_button]:text-white/70 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
                  <CopyButton value={curl} label="Copy command" />
                </div>
              </div>
              <p className="text-[12.5px] text-muted-foreground">
                Calls use the published version. Swap <code>/agent/</code> for <code>/agent/test/</code> to call the latest draft.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Saving… the URL appears once the change is saved.</p>
          )
        ) : (
          <p className="text-[13px] text-muted-foreground">Off.</p>
        )}
      </Section>

      <Section
        title="Webhooks"
        sub="Send call results to your systems when a call ends."
        actions={
          <button
            type="button"
            onClick={() =>
              onWebhooks([
                ...webhooks,
                {
                  id: `webhook-${Date.now().toString(36)}`,
                  name: `Webhook ${webhooks.length + 1}`,
                  enabled: true,
                  method: "POST",
                  url: "",
                  credentialUuid: null,
                  headers: [],
                  payload: DEFAULT_WEBHOOK_PAYLOAD,
                },
              ])
            }
            className={btn("secondary", "sm")}
          >
            <Plus className="size-3.5" /> Add webhook
          </button>
        }
      >
        {webhooks.length ? (
          <div className="space-y-3">
            {webhooks.map((h, i) => (
              <WebhookCard
                key={h.id}
                hook={h}
                credentials={credentials}
                onChange={(next) => onWebhooks(webhooks.map((x, j) => (j === i ? next : x)))}
                onRemove={() => onWebhooks(webhooks.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No webhooks.</p>
        )}
      </Section>

      <Section title="Archive agent" sub={`Archived agents stop taking calls and disappear from the list. Agent ID ${agentId}.`}>
        <button type="button" onClick={onArchive} className={btn("danger", "sm")}>
          Archive agent
        </button>
      </Section>
    </fieldset>
  );
}
