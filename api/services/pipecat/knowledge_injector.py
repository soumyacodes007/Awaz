"""Per-turn knowledge retrieval, in the pipeline instead of as a tool call.

Sits right before the LLM. When a context frame arrives (the caller's turn is
final, or a speculative run started early), it searches the agent's knowledge
base with the latest caller turn and hands the LLM a copy of the context with
the reference chunks attached to that turn. One LLM pass instead of two, and no
embedding API call: in evals/rag-latency this took first audio on a 51k-token
corpus from ~2.8 s (tool-call RAG) to ~0.8 s.

The shared conversation context is never modified, so transcripts, checkpoints
and QA see only what was actually said. Results are cached per query, so the
confirmed turn reuses the work a speculative (early) run already did.
"""

from __future__ import annotations

import copy
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from api.services.knowledge.retrieval import SearchResult, retrieval_query
from loguru import logger

from pipecat.frames.frames import Frame, LLMContextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

REFERENCE_INTRO = (
    "Reference documents for this question (use them if they answer it; "
    "don't mention them or read out document names):"
)
CACHE_SIZE = 16


def _text_of(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            p.get("text", "")
            for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        )
    return ""


def augment_messages(messages: list[dict], reference: str) -> list[dict]:
    """A copy of ``messages`` with ``reference`` placed ahead of the last
    caller turn. Before, not after: an 8B model answered "I don't know" to a
    question whose answer was in chunks appended after it (e2e test), the
    same order the benchmark used (documents, then the question) didn't."""
    out = list(messages)
    for i in range(len(out) - 1, -1, -1):
        msg = out[i]
        if msg.get("role") != "user":
            continue
        block = f"{REFERENCE_INTRO}\n{reference}\n\nCaller: "
        content = msg.get("content")
        if isinstance(content, list):
            new_content = [{"type": "text", "text": block}, *content]
        else:
            new_content = f"{block}{content or ''}"
        out[i] = {**msg, "content": new_content}
        return out
    return out


def user_turns(messages: list[dict]) -> list[str]:
    return [
        _text_of(m) for m in messages if m.get("role") == "user" and _text_of(m).strip()
    ]


class KnowledgeInjector(FrameProcessor):
    def __init__(self, get_knowledge: Callable[[], Any], **kwargs):
        super().__init__(**kwargs)
        self._get_knowledge = get_knowledge
        self._cache: OrderedDict[tuple[int, str], SearchResult] = OrderedDict()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if (
            isinstance(frame, LLMContextFrame)
            and direction == FrameDirection.DOWNSTREAM
        ):
            try:
                frame = await self._augment(frame)
            except Exception as exc:  # retrieval must never cost the caller a reply
                logger.error(
                    f"[knowledge] retrieval failed, answering without it: {exc}"
                )
        await self.push_frame(frame, direction)

    async def _augment(self, frame: LLMContextFrame) -> LLMContextFrame:
        knowledge = self._get_knowledge()
        if (
            knowledge is None
            or knowledge.mode != "retrieval"
            or knowledge.index is None
        ):
            return frame
        messages = frame.context.get_messages()
        query = retrieval_query(user_turns(messages))
        if not query:
            return frame
        key = (id(knowledge.index), query)
        result = self._cache.get(key)
        if result is None:
            result = await knowledge.index.search(query)
            self._cache[key] = result
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
            logger.info(
                f"[knowledge] {result.ms:.0f} ms, {len(result.hits)} chunks"
                f"{' (reranked)' if result.reranked else ''}{' (nothing relevant)' if result.skipped else ''}"
                f"{' speculative' if getattr(frame, 'speculation', False) else ''}"
            )
        if result.skipped or not result.hits:
            return frame
        context = LLMContext(
            messages=augment_messages(messages, result.as_context()),
            tools=frame.context.tools,
            tool_choice=frame.context.tool_choice,
        )
        # Same frame (id, metadata, speculation flag), different context.
        augmented = copy.copy(frame)
        augmented.context = context
        return augmented
