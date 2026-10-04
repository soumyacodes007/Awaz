"""Estimated per-call cost by component, from measured usage and list prices.

Self-hosted Dograh doesn't rate calls (`cost_info` stays empty), so the metrics
dashboard estimates cost the same way the Tuner export does
(api/services/integrations/tuner/cost.py): LLM tokens priced per model, and STT,
TTS and telephony priced per minute of call. Prices match the frontend's
web/src/lib/estimates.ts, so the agent overview and the metrics page agree.
Everything here is labelled as an estimate in the UI.
"""

from __future__ import annotations

from typing import Any

from api.enums import WORKFLOW_RUN_MODES_BY_CHANNEL, WorkflowRunChannel

# USD per 1M tokens: (input, output). Matched by substring, longest first.
LLM_PRICES: dict[str, tuple[float, float]] = {
    "gpt-4.1-nano": (0.1, 0.4),
    "gpt-4.1-mini": (0.4, 1.6),
    "gpt-4.1": (2.0, 8.0),
    "gpt-4o-mini": (0.15, 0.6),
    "gpt-4o": (2.5, 10.0),
    "gpt-5-nano": (0.05, 0.4),
    "gpt-5-mini": (0.25, 2.0),
    "gpt-5": (1.25, 10.0),
    "claude-sonnet": (3.0, 15.0),
    "claude-haiku": (1.0, 5.0),
    "gemini-2.5-flash": (0.3, 2.5),
    "gemini-3.5-flash": (0.3, 2.5),
    "gemini-2.0-flash": (0.1, 0.4),
    "llama-3.3-70b": (0.13, 0.4),
    "deepseek": (0.27, 1.1),
    "qwen": (0.2, 0.6),
    "sarvam": (0.5, 1.5),
}
LLM_DEFAULT = (0.4, 1.6)  # Dograh's managed "default" model and unknown models

# USD per minute of call, by provider (matched against the pipeline processor name).
STT_PER_MIN: dict[str, float] = {
    "sarvam": 0.006,
    "deepgram": 0.0077,
    "soniox": 0.004,
    "assemblyai": 0.0025,
    "openai": 0.006,
    "google": 0.016,
    "azure": 0.0167,
    "gladia": 0.01,
    "speechmatics": 0.017,
}
TTS_PER_MIN: dict[str, float] = {
    "sarvam": 0.01,
    "cartesia": 0.022,
    "elevenlabs": 0.036,
    "deepgram": 0.0135,
    "openai": 0.015,
    "google": 0.016,
    "rime": 0.03,
    "smallest": 0.01,
    "inworld": 0.005,
}
STT_DEFAULT = 0.006
TTS_DEFAULT = 0.015
TELEPHONY_PER_MIN = 0.01

CHAT_MODES = set(WORKFLOW_RUN_MODES_BY_CHANNEL[WorkflowRunChannel.CHAT.value])
PHONE_MODES = set(WORKFLOW_RUN_MODES_BY_CHANNEL[WorkflowRunChannel.TELEPHONY.value])

COMPONENTS = ("llm", "stt", "tts", "telephony")


def _llm_price(model: str) -> tuple[float, float]:
    m = model.lower()
    for key in sorted(LLM_PRICES, key=len, reverse=True):
        if key in m:
            return LLM_PRICES[key]
    return LLM_DEFAULT


def _per_minute(entries: dict | None, table: dict[str, float], default: float) -> float:
    """Rate for the provider named in usage keys like 'SarvamTTSService#2|||bulbul:v2'."""
    for key in entries or {}:
        name = str(key).split("|||")[0].lower()
        for provider, rate in table.items():
            if provider in name:
                return rate
    return default


def estimate_cost(
    mode: str | None, usage_info: dict[str, Any] | None
) -> dict[str, float]:
    """USD per component for one call. Text chats have no STT, TTS or telephony."""
    usage = usage_info or {}
    llm = 0.0
    for key, entry in (usage.get("llm") or {}).items():
        if not isinstance(entry, dict):
            continue
        price_in, price_out = _llm_price(str(key).split("|||")[-1])
        llm += (
            (entry.get("prompt_tokens") or 0) * price_in
            + (entry.get("completion_tokens") or 0) * price_out
        ) / 1_000_000

    minutes = max(float(usage.get("call_duration_seconds") or 0), 0.0) / 60
    voice = mode not in CHAT_MODES
    return {
        "llm": llm,
        "stt": minutes * _per_minute(usage.get("stt"), STT_PER_MIN, STT_DEFAULT)
        if voice
        else 0.0,
        "tts": minutes * _per_minute(usage.get("tts"), TTS_PER_MIN, TTS_DEFAULT)
        if voice
        else 0.0,
        "telephony": minutes * TELEPHONY_PER_MIN if mode in PHONE_MODES else 0.0,
    }
