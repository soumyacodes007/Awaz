"""Local embedding and reranking models for the knowledge base.

Both run on CPU through ONNX (fastembed), so retrieval needs no network call:
in the benchmark (evals/rag-latency) a query embedding plus hybrid search took
~15 ms locally against ~1.5 s through an embedding API.

Models load once per process, lazily, and every call runs in a worker thread
so CPU work never blocks the event loop the audio pipeline runs on.

    AWAZ_KB_EMBED_MODEL   default BAAI/bge-small-en-v1.5 (384 dims)
    AWAZ_KB_RERANK_MODEL  default Xenova/ms-marco-MiniLM-L-6-v2
"""

from __future__ import annotations

import asyncio
import os
import threading

import numpy as np

EMBED_MODEL = os.getenv("AWAZ_KB_EMBED_MODEL") or "BAAI/bge-small-en-v1.5"
RERANK_MODEL = os.getenv("AWAZ_KB_RERANK_MODEL") or "Xenova/ms-marco-MiniLM-L-6-v2"
EMBED_DIM = 384

_lock = threading.Lock()
_embedder = None
_reranker = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        with _lock:
            if _embedder is None:
                from fastembed import TextEmbedding

                _embedder = TextEmbedding(EMBED_MODEL)
    return _embedder


def _get_reranker():
    global _reranker
    if _reranker is None:
        with _lock:
            if _reranker is None:
                from fastembed.rerank.cross_encoder import TextCrossEncoder

                _reranker = TextCrossEncoder(RERANK_MODEL)
    return _reranker


def _normalize(m: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(m, axis=-1, keepdims=True)
    return m / np.where(norm == 0, 1, norm)


def embed_passages_sync(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, EMBED_DIM), dtype=np.float32)
    return _normalize(
        np.array(list(_get_embedder().passage_embed(texts)), dtype=np.float32)
    )


def embed_query_sync(text: str) -> np.ndarray:
    return _normalize(
        np.array(next(iter(_get_embedder().query_embed(text))), dtype=np.float32)
    )


def rerank_sync(query: str, texts: list[str]) -> list[float]:
    if not texts:
        return []
    return [float(s) for s in _get_reranker().rerank(query, texts)]


async def embed_passages(texts: list[str]) -> np.ndarray:
    return await asyncio.to_thread(embed_passages_sync, texts)


async def embed_query(text: str) -> np.ndarray:
    return await asyncio.to_thread(embed_query_sync, text)


async def rerank(query: str, texts: list[str]) -> list[float]:
    return await asyncio.to_thread(rerank_sync, query, texts)


async def warm() -> None:
    """Load both models ahead of the first caller turn."""

    def _warm():
        embed_query_sync("warm up")
        rerank_sync("warm up", ["warm up"])

    await asyncio.to_thread(_warm)
