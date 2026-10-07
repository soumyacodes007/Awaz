// The agent as the editor works with it. The backend's /agents API owns the
// mapping to Dograh's stored graph; the frontend never sees nodes or edges.
// Generated types mark defaulted fields optional, so `toAgent` fills them in.

import type { AgentSpec, ExtractionVariable } from "@/client";

export type Variable = { name: string; type: "string" | "number" | "boolean"; prompt: string | null };
export type Webhook = {
  id: string;
  name: string;
  enabled: boolean;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  credential_uuid: string | null;
  headers: { key: string; value: string }[];
  payload: Record<string, unknown>;
};
export type Qa = { enabled: boolean; system_prompt: string | null; min_call_duration: number; sample_rate: number; include_voicemail: boolean };

export type Agent = {
  prompt: string;
  core_facts: string;
  greeting: { type: "text" | "audio"; text: string | null; recording_id: string | null };
  allow_interrupt: boolean;
  tool_uuids: string[];
  document_uuids: string[];
  extraction: { enabled: boolean; prompt: string | null; variables: Variable[] };
  delayed_start: boolean;
  delayed_start_duration: number | null;
  pre_call_fetch: { mode: "disabled" | "always" | "inbound" | "outbound"; url: string | null; credential_uuid: string | null };
  api_trigger: { enabled: boolean; path: string | null };
  webhooks: Webhook[];
  quality_review: Qa | null;
};

export function toAgent(s: AgentSpec = {}): Agent {
  return {
    prompt: s.prompt ?? "",
    core_facts: s.core_facts ?? "",
    greeting: { type: s.greeting?.type ?? "text", text: s.greeting?.text ?? null, recording_id: s.greeting?.recording_id ?? null },
    allow_interrupt: s.allow_interrupt ?? true,
    tool_uuids: s.tool_uuids ?? [],
    document_uuids: s.document_uuids ?? [],
    extraction: {
      enabled: s.extraction?.enabled ?? false,
      prompt: s.extraction?.prompt ?? null,
      variables: (s.extraction?.variables ?? []).map((v: ExtractionVariable) => ({ name: v.name, type: v.type ?? "string", prompt: v.prompt ?? null })),
    },
    delayed_start: s.delayed_start ?? false,
    delayed_start_duration: s.delayed_start_duration ?? null,
    pre_call_fetch: { mode: s.pre_call_fetch?.mode ?? "disabled", url: s.pre_call_fetch?.url ?? null, credential_uuid: s.pre_call_fetch?.credential_uuid ?? null },
    api_trigger: { enabled: s.api_trigger?.enabled ?? false, path: s.api_trigger?.path ?? null },
    webhooks: (s.webhooks ?? []).map((w) => ({
      id: w.id ?? `webhook-${Math.random().toString(36).slice(2, 10)}`,
      name: w.name ?? "Webhook",
      enabled: w.enabled ?? true,
      method: w.method ?? "POST",
      url: w.url ?? "",
      credential_uuid: w.credential_uuid ?? null,
      headers: w.headers ?? [],
      payload: w.payload ?? {},
    })),
    quality_review: s.quality_review
      ? {
          enabled: s.quality_review.enabled ?? true,
          system_prompt: s.quality_review.system_prompt ?? null,
          min_call_duration: s.quality_review.min_call_duration ?? 15,
          sample_rate: s.quality_review.sample_rate ?? 100,
          include_voicemail: s.quality_review.include_voicemail ?? false,
        }
      : null,
  };
}

export const DEFAULT_WEBHOOK_PAYLOAD = {
  call_id: "{{workflow_run_id}}",
  outcome: "{{gathered_context.call_disposition}}",
  duration: "{{cost_info.call_duration_seconds}}",
  recording_url: "{{recording_url}}",
  transcript_url: "{{transcript_url}}",
};

/** What autosave sends: rows still being typed stay local so they can't fail the whole save. */
export function forServer(a: Agent): Agent {
  const d = a.delayed_start_duration;
  return {
    ...a,
    extraction: { ...a.extraction, variables: a.extraction.variables.filter((v) => v.name.trim()) },
    delayed_start_duration: d == null ? null : Math.min(10, Math.max(0.1, d)),
  };
}
