// Typical cost and latency per provider, used for the agent overview before
// an agent has real calls (measured numbers replace these once it does).
// Prices are public list prices; LLM cost per minute assumes ~6,000 input and
// ~250 output tokens per minute of conversation. Everything here is an
// estimate and is labelled as one in the UI.

import type { Service, ServiceConfig } from "./models";

type Estimate = { costPerMin: number; latencyMs: number };

const STT: Record<string, Estimate> = {
  sarvam: { costPerMin: 0.006, latencyMs: 350 },
  deepgram: { costPerMin: 0.0077, latencyMs: 300 },
  soniox: { costPerMin: 0.004, latencyMs: 410 },
  assemblyai: { costPerMin: 0.0025, latencyMs: 400 },
  openai: { costPerMin: 0.006, latencyMs: 600 },
  google: { costPerMin: 0.016, latencyMs: 450 },
  azure_speech: { costPerMin: 0.0167, latencyMs: 450 },
  gladia: { costPerMin: 0.01, latencyMs: 400 },
  speechmatics: { costPerMin: 0.017, latencyMs: 450 },
};

// Per 1M tokens: [input, output]; latency is typical time to first token.
const LLM: Record<string, { price: [number, number]; latencyMs: number }> = {
  "gpt-4.1": { price: [2, 8], latencyMs: 750 },
  "gpt-4.1-mini": { price: [0.4, 1.6], latencyMs: 600 },
  "gpt-4.1-nano": { price: [0.1, 0.4], latencyMs: 400 },
  "gpt-5": { price: [1.25, 10], latencyMs: 1200 },
  "gpt-5-mini": { price: [0.25, 2], latencyMs: 800 },
  "gpt-5-nano": { price: [0.05, 0.4], latencyMs: 600 },
  "claude-sonnet-4": { price: [3, 15], latencyMs: 1000 },
  "gemini-2.5-flash": { price: [0.3, 2.5], latencyMs: 500 },
  "gemini-3.5-flash": { price: [0.3, 2.5], latencyMs: 500 },
  "llama-3.3-70b": { price: [0.13, 0.4], latencyMs: 300 },
  "deepseek-chat-v3": { price: [0.27, 1.1], latencyMs: 1100 },
  "sarvam-105b": { price: [0.5, 1.5], latencyMs: 700 },
};

const TTS: Record<string, Estimate> = {
  sarvam: { costPerMin: 0.01, latencyMs: 400 },
  cartesia: { costPerMin: 0.022, latencyMs: 270 },
  elevenlabs: { costPerMin: 0.036, latencyMs: 300 },
  deepgram: { costPerMin: 0.0135, latencyMs: 250 },
  openai: { costPerMin: 0.015, latencyMs: 500 },
  google: { costPerMin: 0.016, latencyMs: 450 },
  rime: { costPerMin: 0.03, latencyMs: 250 },
  smallest: { costPerMin: 0.01, latencyMs: 200 },
  inworld: { costPerMin: 0.005, latencyMs: 300 },
};

const TOKENS_IN = 6000;
const TOKENS_OUT = 250;

function llmKey(model: string) {
  const m = model.toLowerCase();
  return Object.keys(LLM)
    .sort((a, b) => b.length - a.length)
    .find((k) => m.includes(k));
}

export function estimate(service: Service, cfg: ServiceConfig | null | undefined): Estimate | null {
  if (!cfg) return null;
  if (service === "stt") return STT[cfg.provider] ?? null;
  if (service === "tts") return TTS[cfg.provider] ?? null;
  if (service === "llm" && typeof cfg.model === "string") {
    const k = llmKey(cfg.model);
    if (!k) return null;
    const { price, latencyMs } = LLM[k];
    return { costPerMin: (TOKENS_IN * price[0] + TOKENS_OUT * price[1]) / 1e6, latencyMs };
  }
  return null;
}

// ── Presets ────────────────────────────────────────────────────────────
// Built on providers this deployment can run without extra keys (Sarvam and
// OpenRouter read their keys from the server environment).

export type Preset = { id: string; label: string; stt: ServiceConfig; llm: ServiceConfig; tts: ServiceConfig };

const sarvamStt = (language = "unknown"): ServiceConfig => ({ provider: "sarvam", model: "saarika:v2.5", language });
const sarvamTts = (model = "bulbul:v2", voice = "anushka", language = "hi-IN"): ServiceConfig => ({ provider: "sarvam", model, voice, language, speed: 1 });
const openrouter = (model: string): ServiceConfig => ({ provider: "openrouter", model, base_url: "https://openrouter.ai/api/v1" });

export const PRESETS: Preset[] = [
  { id: "balanced", label: "Balanced", stt: sarvamStt(), llm: openrouter("openai/gpt-4.1-mini"), tts: sarvamTts() },
  { id: "intelligence", label: "High Intelligence", stt: sarvamStt(), llm: openrouter("anthropic/claude-sonnet-4"), tts: sarvamTts("bulbul:v3", "priya") },
  { id: "fast", label: "Ultra Fast", stt: sarvamStt(), llm: openrouter("google/gemini-2.5-flash"), tts: sarvamTts() },
  { id: "cost", label: "Cost Saver", stt: sarvamStt(), llm: openrouter("openai/gpt-4.1-nano"), tts: sarvamTts() },
  {
    id: "hindi",
    label: "Hindi First",
    stt: sarvamStt("hi-IN"),
    llm: { provider: "sarvam", model: "sarvam-105b-conversations", base_url: "https://api.sarvam.ai/v1", temperature: 0.5 },
    tts: sarvamTts("bulbul:v2", "anushka", "hi-IN"),
  },
];

const same = (a: ServiceConfig | null | undefined, b: ServiceConfig) =>
  Boolean(a) && a!.provider === b.provider && (b.model == null || a!.model === b.model) && (b.voice == null || a!.voice === b.voice) && (b.language == null || a!.language === b.language);

/** The preset an effective config matches, if any. */
export function matchPreset(e: Partial<Record<Service, ServiceConfig | null>>) {
  return PRESETS.find((p) => same(e.stt, p.stt) && same(e.llm, p.llm) && same(e.tts, p.tts))?.id ?? null;
}
