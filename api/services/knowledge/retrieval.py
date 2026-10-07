"""Decide how an agent gets its knowledge, and search it fast.

Routing (measured in evals/rag-latency):
  * inline     total ≤ AWAZ_KB_INLINE_MAX_TOKENS (default 8k): the whole text goes
               in the system prompt, cached. Fastest and most accurate when small.
  * retrieval  bigger: hybrid search every turn (local embeddings + BM25 fused
               with RRF, contextual chunk headers, cross-encoder rerank of the
               top 12). 87% vs 40% accurate and ~0.8 s vs ~2.8 s to first audio
               compared with the tool-call RAG this replaces, on a 51k-token corpus.

The old lookup tool is off by default (AWAZ_KB_TOOL=1 brings it back): with
chunks already injected the model still called it on every turn, adding a
second LLM round trip (~3.5 s vs ~1.5 s per text turn in the app).

Documents marked "full_document" are always inline (the user asked for it).
Indexes are built in memory per document set and cached per process; they're
rebuilt when a document is re-processed.
"""

from __future__ import annotations

import math
import os
import re
import time
from collections import Counter, OrderedDict
from dataclasses import dataclass, field

import numpy as np
from api.services.knowledge import local_models
from loguru import logger

INLINE_MAX_TOKENS = int(os.getenv("AWAZ_KB_INLINE_MAX_TOKENS") or 8000)
TOP_K = int(os.getenv("AWAZ_KB_TOP_K") or 4)
# The reranker is most of the search time (candidates x passage length).
# Measured on the 51k-token corpus: pool 12 reading 512 chars per passage keeps
# recall (14/15, same as pool 20 reading everything) at ~1/3 of the cost
# (evals/rag-latency/retrieval_sweep.py).
RERANK_POOL = int(os.getenv("AWAZ_KB_RERANK_POOL") or 12)
RERANK_CHARS = int(os.getenv("AWAZ_KB_RERANK_CHARS") or 512)
RERANK = (os.getenv("AWAZ_KB_RERANK") or "1") not in ("0", "false", "off")
# Cross-encoder logits: on-topic chunks score well above 0, small talk far below.
MIN_RERANK_SCORE = float(os.getenv("AWAZ_KB_MIN_RERANK_SCORE") or -4.0)
LOOKUP_TOOL = (os.getenv("AWAZ_KB_TOOL") or "0") in ("1", "true", "on")
CACHE_SIZE = 32

_TOKEN = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*")
# IDs like CT-INV-2025-0143 or SED-2025-0091: letters and digits joined by dashes.
_ID = re.compile(
    r"\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+){1,}\b"
)


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


class BM25:
    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.toks = [tokenize(d) for d in docs]
        self.avg = (sum(map(len, self.toks)) / len(self.toks)) if self.toks else 1.0
        df = Counter(t for doc in self.toks for t in set(doc))
        n = max(1, len(docs))
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.tf = [Counter(doc) for doc in self.toks]
        self.k1, self.b = k1, b

    def scores(self, query: str) -> np.ndarray:
        q = [t for t in tokenize(query) if t in self.idf]
        out = np.zeros(len(self.toks))
        if not q:
            return out
        for i, (tf, doc) in enumerate(zip(self.tf, self.toks)):
            norm = self.k1 * (1 - self.b + self.b * len(doc) / self.avg)
            out[i] = sum(
                self.idf[t] * tf[t] * (self.k1 + 1) / (tf[t] + norm)
                for t in q
                if t in tf
            )
        return out


def rrf(*rankings: list[int], k: int = 60) -> list[int]:
    score: Counter = Counter()
    for ranking in rankings:
        for rank, idx in enumerate(ranking):
            score[idx] += 1 / (k + rank + 1)
    return [i for i, _ in score.most_common()]


_FOLLOW_UP_START = re.compile(
    r"^(and|also|what about|how about|plus|then|so|ok(ay)?|and what)\b", re.IGNORECASE
)
STANDALONE_WORDS = 8


def retrieval_query(user_turns: list[str]) -> str:
    """What to search for this turn.

    A follow-up like "and the gross weight?" is searched together with the
    previous caller turn, so it lands on the right document without an LLM
    rewrite (follow-up accuracy 100% with rerank). A turn that names its own
    subject (an ID, or a full question) is searched alone: prepending an
    unrelated earlier question drowned it out in the app's e2e test.
    """
    turns = [t.strip() for t in user_turns if t and t.strip()]
    if not turns:
        return ""
    latest = turns[-1]
    standalone = not _FOLLOW_UP_START.match(latest) and (
        _ID.search(latest) or len(latest.split()) >= STANDALONE_WORDS
    )
    if standalone or len(turns) == 1:
        return latest
    return f"{turns[-2]} {latest}"


@dataclass
class Hit:
    chunk_id: int
    document: str
    text: str
    score: float


@dataclass
class SearchResult:
    hits: list[Hit]
    ms: float
    reranked: bool
    skipped: bool = False  # nothing relevant enough (small talk)

    def as_context(self) -> str:
        return "\n\n".join(f"[{h.document}]\n{h.text}" for h in self.hits)


class Index:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        texts = [r["text"] for r in rows]
        self.bm25 = BM25(texts) if texts else None
        vecs = [r["embedding"] for r in rows]
        dim = local_models.EMBED_DIM
        self.dense = (
            np.array(
                [v if v is not None else np.zeros(dim) for v in vecs], dtype=np.float32
            )
            if rows
            else np.zeros((0, dim))
        )
        self.has_dense = any(v is not None for v in vecs)

    def _candidates(self, query: str, q_vec: np.ndarray | None, pool: int) -> list[int]:
        sparse = list(np.argsort(-self.bm25.scores(query))[:50])
        if q_vec is None or not self.has_dense:
            return sparse[:pool]
        dense = list(np.argsort(-(self.dense @ q_vec))[:50])
        return rrf(dense, sparse)[:pool]

    async def search(
        self, query: str, top_k: int = TOP_K, rerank: bool = RERANK
    ) -> SearchResult:
        t0 = time.perf_counter()
        if not self.rows or not query.strip():
            return SearchResult([], 0.0, False, skipped=True)
        q_vec = await local_models.embed_query(query) if self.has_dense else None
        pool = self._candidates(query, q_vec, RERANK_POOL if rerank else top_k)
        # A question naming two records (an invoice and a declaration) needs
        # both documents; search each ID on its own and keep its best match.
        for ident in dict.fromkeys(m.group(0) for m in _ID.finditer(query)):
            for i in self._candidates(ident, None, 2):
                if i not in pool:
                    pool.append(i)
        scores: list[float]
        if rerank and pool:
            scores = await local_models.rerank(
                query, [self.rows[i]["text"][:RERANK_CHARS] for i in pool]
            )
            order = list(np.argsort(-np.array(scores)))
            ids, best = [pool[i] for i in order], max(scores)
            scores = [scores[i] for i in order]
            if best < MIN_RERANK_SCORE:
                return SearchResult(
                    [], (time.perf_counter() - t0) * 1000, True, skipped=True
                )
        else:
            ids, scores = pool, [1.0 / (r + 1) for r in range(len(pool))]
        hits = [
            Hit(
                self.rows[i]["id"],
                self.rows[i]["document"],
                self.rows[i]["text"],
                float(s),
            )
            for i, s in zip(ids[:top_k], scores[:top_k])
        ]
        return SearchResult(hits, (time.perf_counter() - t0) * 1000, rerank)


@dataclass
class Knowledge:
    """What an agent knows and how it's delivered."""

    mode: str  # "none" | "inline" | "retrieval"
    tokens: int = 0
    documents: list[str] = field(default_factory=list)
    inline_text: str = ""
    index: Index | None = None

    def prompt_section(self) -> str:
        if not self.inline_text:
            return ""
        return (
            "## Knowledge base\nAnswer from these documents when they're relevant.\n\n"
            + self.inline_text
        )


_cache: OrderedDict[tuple, Knowledge] = OrderedDict()
_index_cache: OrderedDict[tuple, Index] = OrderedDict()


def _signature(organization_id: int, docs) -> tuple:
    return (
        organization_id,
        tuple(
            sorted(
                (str(d.document_uuid), d.updated_at.isoformat() if d.updated_at else "")
                for d in docs
            )
        ),
    )


def _remember(cache: OrderedDict, key: tuple, value):
    cache[key] = value
    while len(cache) > CACHE_SIZE:
        cache.popitem(last=False)
    return value


async def _documents(organization_id: int, document_uuids: list[str]):
    from api.db import db_client

    docs = await db_client.get_knowledge_documents(organization_id, document_uuids)
    return [d for d in docs if d.full_text or d.total_chunks]


async def index_for(organization_id: int, docs) -> Index:
    """The search index over these documents' chunks (cached per version)."""
    from api.db import db_client

    key = _signature(organization_id, docs)
    if key in _index_cache:
        _index_cache.move_to_end(key)
        return _index_cache[key]
    titles = {d.id: (d.filename or "document") for d in docs}
    rows = await db_client.get_index_chunks(organization_id, [d.id for d in docs])
    index = Index(
        [
            {
                "id": r.id,
                "document": titles.get(r.document_id, "document"),
                "text": r.contextualized_text or r.chunk_text,
                "embedding": np.array(r.embedding_local, dtype=np.float32)
                if r.embedding_local is not None
                else None,
            }
            for r in rows
        ]
    )
    return _remember(_index_cache, key, index)


async def search(
    organization_id: int, document_uuids: list[str], query: str
) -> SearchResult:
    """Search documents the way a call would, whatever their size (used by
    the knowledge page's "Try a question")."""
    docs = await _documents(organization_id, document_uuids)
    if not docs:
        return SearchResult([], 0.0, False, skipped=True)
    return await (await index_for(organization_id, docs)).search(query)


async def load(organization_id: int, document_uuids: list[str] | None) -> Knowledge:
    """Build (or reuse) the knowledge for a set of documents."""
    if not document_uuids:
        return Knowledge(mode="none")
    docs = await _documents(organization_id, document_uuids)
    if not docs:
        return Knowledge(mode="none")
    signature = _signature(organization_id, docs)
    if signature in _cache:
        _cache.move_to_end(signature)
        return _cache[signature]

    titles = {d.id: (d.filename or "document") for d in docs}
    total = sum(max(1, len(d.full_text or "") // 4) for d in docs)
    always_inline = [
        d for d in docs if d.retrieval_mode == "full_document" and d.full_text
    ]
    if total <= INLINE_MAX_TOKENS:
        inline_docs, indexed_docs = docs, []
    else:
        inline_docs, indexed_docs = (
            always_inline,
            [d for d in docs if d not in always_inline],
        )

    inline_text = "\n\n".join(
        f"### {titles[d.id]}\n{d.full_text.strip()}" for d in inline_docs if d.full_text
    )
    index = await index_for(organization_id, indexed_docs) if indexed_docs else None
    knowledge = Knowledge(
        mode="retrieval"
        if index is not None and index.rows
        else ("inline" if inline_text else "none"),
        tokens=total,
        documents=[titles[d.id] for d in docs],
        inline_text=inline_text,
        index=index,
    )
    _remember(_cache, signature, knowledge)
    logger.info(
        f"[knowledge] {knowledge.mode}: {len(docs)} docs, ~{total} tokens, {len(index.rows) if index else 0} chunks indexed"
    )
    return knowledge
