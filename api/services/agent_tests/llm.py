"""OpenAI-compatible chat calls for the test simulator, judge and generator.

Defaults to OpenRouter. Configure with environment variables:

    AWAZ_TEST_OPENROUTER_API_KEY   key for test LLM calls (falls back to OPENROUTER_API_KEY)
    AWAZ_TEST_BASE_URL             default https://openrouter.ai/api/v1
    AWAZ_TEST_SIMULATOR_MODEL      plays the caller
    AWAZ_TEST_JUDGE_MODEL          grades behaviors and writes generated tests
    AWAZ_TEST_CONCURRENCY          conversations run at once per run (default 2)
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass

import httpx
from loguru import logger

DEFAULT_SIMULATOR_MODEL = "nvidia/nemotron-3.5-lightning:free"
DEFAULT_JUDGE_MODEL = "qwen/qwen3.8-27b:free"


class TestLLMError(RuntimeError):
    """A readable failure from the test LLM (shown on the result)."""


@dataclass(frozen=True)
class TestLLMConfig:
    api_key: str
    base_url: str
    simulator_model: str
    judge_model: str
    concurrency: int

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


def load_config() -> TestLLMConfig:
    return TestLLMConfig(
        api_key=os.getenv("AWAZ_TEST_OPENROUTER_API_KEY")
        or os.getenv("OPENROUTER_API_KEY")
        or "",
        base_url=(
            os.getenv("AWAZ_TEST_BASE_URL") or "https://openrouter.ai/api/v1"
        ).rstrip("/"),
        simulator_model=os.getenv("AWAZ_TEST_SIMULATOR_MODEL")
        or DEFAULT_SIMULATOR_MODEL,
        judge_model=os.getenv("AWAZ_TEST_JUDGE_MODEL") or DEFAULT_JUDGE_MODEL,
        concurrency=max(1, int(os.getenv("AWAZ_TEST_CONCURRENCY", "2") or 2)),
    )


_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def clean_reply(text: str) -> str:
    """Drop reasoning blocks some open models emit before the answer."""
    text = _THINK.sub("", text or "")
    # An unterminated <think> means the model ran out of tokens mid-thought.
    if "<think>" in text.lower():
        text = text[: text.lower().index("<think>")]
    return text.strip()


async def chat(
    config: TestLLMConfig,
    model: str,
    messages: list[dict],
    *,
    max_tokens: int = 400,
    temperature: float = 0.7,
    json_mode: bool = False,
    reasoning: bool | None = None,
) -> str:
    """reasoning=False asks OpenRouter to switch thinking off. Some open models
    otherwise write their reasoning into the reply itself, which a simulated
    caller would then "say"."""
    if not config.configured:
        raise TestLLMError(
            "No LLM key for tests. Set AWAZ_TEST_OPENROUTER_API_KEY on the server."
        )
    body: dict = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if reasoning is not None:
        body["reasoning"] = {"enabled": reasoning}
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "HTTP-Referer": "https://github.com/soumyacodes007/Awaz",
        "X-Title": "Awaz agent tests",
    }
    delay = 4.0
    last = ""
    async with httpx.AsyncClient(timeout=90) as client:
        for attempt in range(4):
            try:
                res = await client.post(
                    f"{config.base_url}/chat/completions", json=body, headers=headers
                )
            except httpx.HTTPError as exc:
                last = f"Couldn't reach the test LLM ({type(exc).__name__})"
            else:
                if res.status_code == 200:
                    data = res.json()
                    choice = (data.get("choices") or [{}])[0]
                    content = (choice.get("message") or {}).get("content") or ""
                    reply = clean_reply(content)
                    if reply:
                        return reply
                    last = f"{model} returned an empty reply"
                elif res.status_code == 400 and json_mode:
                    # Some providers reject response_format; retry without it.
                    body.pop("response_format", None)
                    json_mode = False
                    continue
                else:
                    detail = _error_detail(res)
                    last = f"{model}: HTTP {res.status_code} {detail}".strip()
                    if res.status_code not in (408, 429, 500, 502, 503, 504):
                        raise TestLLMError(last)
            logger.warning(f"Test LLM attempt {attempt + 1} failed: {last}")
            await asyncio.sleep(delay)
            delay *= 2
    raise TestLLMError(last or "The test LLM didn't respond")


def _error_detail(res: httpx.Response) -> str:
    try:
        err = res.json().get("error") or {}
        return str(err.get("message") or "")[:300]
    except Exception:
        return res.text[:300]


def parse_json(text: str, prefer: str | None = None):
    """The JSON in a model reply. Models wrap it in prose, fences or reasoning
    that itself contains braces, so try every { and [ and keep the best parse:
    one with the `prefer` key if given, else the longest."""
    text = clean_reply(text)
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    decoder = json.JSONDecoder()
    found: list[tuple[int, object]] = []
    for i, ch in enumerate(text):
        if ch not in "{[":
            continue
        try:
            value, end = decoder.raw_decode(text, i)
        except json.JSONDecodeError:
            continue
        found.append((end - i, value))
    if not found:
        raise ValueError("No JSON found in the model reply")
    if prefer:
        keyed = [f for f in found if isinstance(f[1], dict) and prefer in f[1]]
        if keyed:
            return max(keyed, key=lambda f: f[0])[1]
    return max(found, key=lambda f: f[0])[1]
