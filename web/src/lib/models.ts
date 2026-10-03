// Helpers for Dograh's model configuration (v2). A configuration is either
// Dograh-managed (one key, pick voice/language/speed) or BYOK, where each
// service (stt, llm, tts, embeddings) names a provider plus its settings.
// Agents can override the workspace configuration with their own.

export type Service = "stt" | "llm" | "tts" | "embeddings";
export type ServiceConfig = { provider: string; [k: string]: unknown };

export type ModelConfigV2 = {
  version?: 2;
  mode: "dograh" | "byok";
  dograh?: { api_key: string; voice?: string; speed?: number; language?: string } | null;
  byok?: {
    mode: "pipeline" | "realtime";
    pipeline?: Partial<Record<Service, ServiceConfig>> | null;
    realtime?: Record<string, ServiceConfig> | null;
  } | null;
};

export type Effective = Partial<Record<Service | "realtime", ServiceConfig | null>> & { is_realtime?: boolean };

/** JSON schema for one provider's settings, as served by /model-configurations/v2/defaults. */
export type ProviderSchema = {
  title?: string;
  description?: string;
  required?: string[];
  properties: Record<string, PropSchema>;
};
export type PropSchema = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: PropSchema[];
  allow_custom_input?: boolean;
  model_options?: Record<string, string[]>;
  minimum?: number;
  maximum?: number;
};

export type Defaults = {
  dograh: {
    voices: string[];
    allow_custom_input?: boolean;
    speed_range?: { min: number; max: number; step: number };
    languages: string[];
    defaults: { voice: string; speed: number; language: string };
  };
  byok: {
    pipeline: Record<Service, Record<string, ProviderSchema>> & { default_providers?: Record<Service, string> };
  };
};

export const SERVICE_LABEL: Record<Service, string> = {
  stt: "Transcriber",
  llm: "Model",
  tts: "Voice",
  embeddings: "Embeddings",
};

const PROVIDER_NAMES: Record<string, string> = {
  dograh: "Dograh",
  openai: "OpenAI",
  google: "Google",
  google_vertex: "Vertex AI",
  groq: "Groq",
  openrouter: "OpenRouter",
  azure: "Azure OpenAI",
  azure_speech: "Azure Speech",
  aws_bedrock: "AWS Bedrock",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
  cartesia: "Cartesia",
  sarvam: "Sarvam",
  soniox: "Soniox",
  speechmatics: "Speechmatics",
  assemblyai: "AssemblyAI",
  gladia: "Gladia",
  smallest: "Smallest AI",
  minimax: "MiniMax",
  inworld: "Inworld",
  rime: "Rime",
  camb: "CAMB.AI",
  xai: "xAI",
  speechify: "Speechify",
  speaches: "Speaches",
  huggingface: "Hugging Face",
  hopper: "Hopper",
  atlascloud: "Atlas Cloud",
};

export const providerName = (p: string | undefined | null) => (p ? (PROVIDER_NAMES[p] ?? p) : "–");

const LANGUAGE_NAMES: Record<string, string> = {
  multi: "Auto-detect",
  unknown: "Auto-detect",
  en: "English",
  "en-IN": "English (India)",
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  hi: "Hindi",
  "hi-IN": "Hindi",
  bn: "Bengali",
  "bn-IN": "Bengali",
  ta: "Tamil",
  "ta-IN": "Tamil",
  te: "Telugu",
  "te-IN": "Telugu",
  mr: "Marathi",
  "mr-IN": "Marathi",
  kn: "Kannada",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "gu-IN": "Gujarati",
  "pa-IN": "Punjabi",
  "od-IN": "Odia",
  ur: "Urdu",
};
export const languageName = (code: unknown) =>
  typeof code === "string" ? (LANGUAGE_NAMES[code] ? `${LANGUAGE_NAMES[code]} · ${code}` : code) : "–";

/** One line per service for the agent cards, e.g. "Sarvam · bulbul:v2 · anushka". */
export function describe(service: Service, cfg: ServiceConfig | null | undefined) {
  if (!cfg) return { provider: "Not set", detail: "" };
  const parts: string[] = [];
  if (typeof cfg.model === "string" && cfg.model !== "default") parts.push(cfg.model);
  if (service === "tts" && typeof cfg.voice === "string" && cfg.voice !== "default") parts.push(cfg.voice);
  if (service === "stt" && cfg.language) parts.push(languageName(cfg.language));
  if (cfg.provider === "dograh" && !parts.length) parts.push("Managed");
  return { provider: providerName(cfg.provider), detail: parts.join(" · ") };
}

/** The override stored on an agent, if any. */
export function agentOverride(workflowConfigurations: Record<string, unknown> | null | undefined) {
  const v = workflowConfigurations?.model_configuration_v2_override;
  return v && typeof v === "object" ? (v as ModelConfigV2) : null;
}

/** Build the effective per-service view from a v2 config (for display only). */
export function effectiveOf(cfg: ModelConfigV2 | null | undefined): Effective | null {
  if (!cfg) return null;
  if (cfg.mode === "dograh" && cfg.dograh) {
    const d = cfg.dograh;
    return {
      stt: { provider: "dograh", model: "default", language: d.language ?? "multi" },
      llm: { provider: "dograh", model: "default" },
      tts: { provider: "dograh", model: "default", voice: d.voice ?? "default", speed: d.speed ?? 1 },
    };
  }
  if (cfg.mode === "byok" && cfg.byok?.mode === "pipeline" && cfg.byok.pipeline) {
    const p = cfg.byok.pipeline;
    return { stt: p.stt ?? null, llm: p.llm ?? null, tts: p.tts ?? null, embeddings: p.embeddings ?? null };
  }
  if (cfg.mode === "byok" && cfg.byok?.mode === "realtime") return { is_realtime: true, ...(cfg.byok.realtime ?? {}) };
  return null;
}

/** Initial values for a provider's form: schema defaults, minus the key. */
export function schemaDefaults(schema: ProviderSchema | undefined, provider: string): ServiceConfig {
  const out: ServiceConfig = { provider };
  for (const [k, p] of Object.entries(schema?.properties ?? {})) {
    if (k === "provider" || k === "api_key") continue;
    if (p.default !== undefined) out[k] = p.default;
  }
  return out;
}
