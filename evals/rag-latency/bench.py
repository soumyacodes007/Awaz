"""RAG latency benchmark for voice agents, measured the way a streaming call feels.

Timeline of one caller turn (no audio involved; these are the events a
streaming STT + turn detector produce):

    t = 0          caller stops speaking
    t = STT_FINAL  final transcript arrives            (default 150 ms)
    t = COMMIT     turn detector confirms the turn     (default 500 ms)

A pipeline starts either at COMMIT (the usual way) or at STT_FINAL ("early":
retrieval plus preemptive LLM generation while the detector is still deciding).
Audio can't play before COMMIT either way. The number that matters is
**first audio**: when the first complete sentence is ready to hand to TTS
(TTS adds its own ~100-250 ms on top, the same for every pipeline).

Pipelines:
  full_context      whole knowledge base in the system prompt (cache-augmented)
  tool_call         LLM decides to call a retrieval tool, then answers (Dograh today)
  vector_api        embed the turn with an API model, top-k cosine, one LLM pass
  hybrid_local      local embeddings + BM25 fused with RRF, one LLM pass
  hybrid_rerank     hybrid_local, then a local cross-encoder reranks top-20 to top-k
  hybrid_plain      hybrid_local without contextual chunk headers (ablation)
  hybrid_wide       hybrid_local with top-8 instead of top-4 (more context, no reranker)

Retrieval pipelines index chunks with contextual headers (each chunk carries its
document's identifying lines), except hybrid_plain.

Usage:
  python bench.py --docs <demo-documents folder> [--models ...] [--repeats 2]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import httpx
import numpy as np

import corpus

HERE = Path(__file__).parent
API = "https://openrouter.ai/api/v1"
STT_FINAL_MS = 150
COMMIT_MS = 500
TOP_K = 4
RERANK_POOL = 20
EMBED_API_MODEL = "openai/text-embedding-3-small"
LOCAL_EMBED_MODEL = "BAAI/bge-small-en-v1.5"
LOCAL_RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"

MODELS = {
    "openai/gpt-6-luna": {"reasoning": {"effort": "minimal"}, "price": (0.10, 0.50)},
    "meta-llama/llama-3.1-8b-instruct": {"provider": {"sort": "latency"}, "price": (0.05, 0.08)},
}

SYSTEM = (
    "You are a phone agent for CarbonTrace, answering questions about shipment and emissions documents. "
    "Answer in one or two short spoken sentences. Write numbers as digits. "
    "Use only the provided documents. If they don't contain the answer, say you don't know."
)

_SENTENCE_END = re.compile(r"[.!?](?:\s|$)")


# ── Streaming LLM call ──────────────────────────────────────────────────


@dataclass
class Stream:
    text: str = ""
    ttft_ms: float | None = None
    first_sentence_ms: float | None = None
    total_ms: float = 0.0
    tool_calls: list = field(default_factory=list)
    prompt_tokens: int = 0
    cached_tokens: int = 0
    completion_tokens: int = 0
    provider: str = ""


def stream_chat(client: httpx.Client, key: str, model: str, messages: list, tools: list | None = None) -> Stream:
    cfg = MODELS[model]
    body = {"model": model, "messages": messages, "stream": True, "max_tokens": 160, "temperature": 0, "usage": {"include": True}}
    body.update({k: v for k, v in cfg.items() if k != "price"})
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    out = Stream()
    calls: dict[int, dict] = {}
    t0 = time.perf_counter()
    with client.stream("POST", f"{API}/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"}) as r:
        if r.status_code != 200:
            raise RuntimeError(f"{model}: HTTP {r.status_code} {r.read()[:200]!r}")
        for line in r.iter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            d = json.loads(line[6:])
            if d.get("error"):
                raise RuntimeError(f"{model}: {d['error']}")
            out.provider = d.get("provider") or out.provider
            if d.get("usage"):
                u = d["usage"]
                out.prompt_tokens = u.get("prompt_tokens") or 0
                out.completion_tokens = u.get("completion_tokens") or 0
                out.cached_tokens = ((u.get("prompt_tokens_details") or {}).get("cached_tokens")) or 0
            for ch in d.get("choices") or []:
                delta = ch.get("delta") or {}
                for tc in delta.get("tool_calls") or []:
                    slot = calls.setdefault(tc.get("index", 0), {"name": "", "arguments": ""})
                    fn = tc.get("function") or {}
                    slot["name"] += fn.get("name") or ""
                    slot["arguments"] += fn.get("arguments") or ""
                piece = delta.get("content")
                if piece:
                    now = (time.perf_counter() - t0) * 1000
                    if out.ttft_ms is None:
                        out.ttft_ms = now
                    out.text += piece
                    if out.first_sentence_ms is None and _SENTENCE_END.search(out.text):
                        out.first_sentence_ms = now
    out.total_ms = (time.perf_counter() - t0) * 1000
    if out.text and out.first_sentence_ms is None:
        out.first_sentence_ms = out.total_ms  # one unterminated sentence: speakable when the stream ends
    out.tool_calls = list(calls.values())
    return out


# ── Retrieval ───────────────────────────────────────────────────────────

_TOKEN = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


class BM25:
    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.toks = [tokenize(d) for d in docs]
        self.avg = sum(map(len, self.toks)) / len(self.toks)
        df = Counter(t for doc in self.toks for t in set(doc))
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.tf = [Counter(doc) for doc in self.toks]
        self.k1, self.b = k1, b

    def scores(self, query: str) -> np.ndarray:
        q = tokenize(query)
        out = np.zeros(len(self.toks))
        for i, (tf, doc) in enumerate(zip(self.tf, self.toks)):
            norm = self.k1 * (1 - self.b + self.b * len(doc) / self.avg)
            out[i] = sum(self.idf.get(t, 0) * tf[t] * (self.k1 + 1) / (tf[t] + norm) for t in q if t in tf)
        return out


def rrf(*rankings: list[int], k: int = 60) -> list[int]:
    score: Counter = Counter()
    for ranking in rankings:
        for rank, idx in enumerate(ranking):
            score[idx] += 1 / (k + rank + 1)
    return [i for i, _ in score.most_common()]


class Index:
    def __init__(self, chunks, client, key, local_embed, reranker):
        self.chunks = chunks
        self.client, self.key = client, key
        self.local_embed, self.reranker = local_embed, reranker
        # Contextual chunk headers: every chunk starts with its document's
        # identifying lines (title, reference, party), so page 2 of an invoice
        # still says which invoice it belongs to.
        first_page = {}
        for c in chunks:
            first_page.setdefault(c.doc, c.text)
        self.headers = {doc: " | ".join(t.splitlines()[:3]) for doc, t in first_page.items()}
        self.texts = [f"{self.headers[c.doc]}\n{c.text}" for c in chunks]
        plain = [c.text for c in chunks]
        self.bm25 = BM25(self.texts)
        self.local = self._norm(np.array(list(local_embed.embed(self.texts))))
        self.api = self._norm(np.array(self._api_embed(self.texts)))
        self.bm25_plain = BM25(plain)
        self.local_plain = self._norm(np.array(list(local_embed.embed(plain))))

    @staticmethod
    def _norm(m):
        return m / np.linalg.norm(m, axis=-1, keepdims=True)

    def _api_embed(self, texts):
        out = []
        for i in range(0, len(texts), 128):
            r = self.client.post(f"{API}/embeddings", json={"model": EMBED_API_MODEL, "input": texts[i : i + 128]},
                                 headers={"Authorization": f"Bearer {self.key}"})
            r.raise_for_status()
            out += [d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])]
        return out

    def vector_api(self, query: str) -> list[int]:
        q = self._norm(np.array(self._api_embed([query])[0]))
        return list(np.argsort(-(self.api @ q))[:TOP_K])

    def hybrid(self, query: str, pool: int = TOP_K, plain: bool = False) -> list[int]:
        q = self._norm(np.array(next(iter(self.local_embed.query_embed(query)))))
        dense = list(np.argsort(-((self.local_plain if plain else self.local) @ q))[:50])
        sparse = list(np.argsort(-(self.bm25_plain if plain else self.bm25).scores(query))[:50])
        return rrf(dense, sparse)[:pool]

    def hybrid_plain(self, query: str) -> list[int]:
        return self.hybrid(query, plain=True)

    def hybrid_rerank(self, query: str) -> list[int]:
        pool = self.hybrid(query, RERANK_POOL)
        scores = list(self.reranker.rerank(query, [self.texts[i] for i in pool]))
        return [pool[i] for i in np.argsort(-np.array(scores))[:TOP_K]]

    def context(self, ids: list[int]) -> str:
        return "\n\n".join(f"[{self.chunks[i].doc}]\n{self.texts[i]}" for i in ids)


TOOL = [{
    "type": "function",
    "function": {
        "name": "retrieve_from_knowledge_base",
        "description": "Search the shipment and emissions documents. Use it for any question about invoices, declarations, energy, transport or verification.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "What to look up."}}, "required": ["query"]},
    },
}]


# ── One turn ────────────────────────────────────────────────────────────


def retrieval_query(item) -> str:
    # A follow-up ("And the gross weight?") is searched together with the
    # previous caller question, so it lands on the right document without an
    # LLM rewrite.
    prev = [m["content"] for m in item.get("history", []) if m["role"] == "user"]
    return " ".join(prev[-1:] + [item["q"]])


def run_turn(pipeline: str, item: dict, model: str, index: Index, kb_text: str, client, key) -> dict:
    history = item.get("history", [])
    retrieval_ms = 0.0
    ids: list[int] = []
    t0 = time.perf_counter()

    if pipeline == "full_context":
        messages = [{"role": "system", "content": f"{SYSTEM}\n\nDocuments:\n{kb_text}"}, *history, {"role": "user", "content": item["q"]}]
        s = stream_chat(client, key, model, messages)
        first_audio = s.first_sentence_ms
        answer_audio = s.first_sentence_ms
        streams = [s]
    elif pipeline == "tool_call":
        messages = [{"role": "system", "content": SYSTEM}, *history, {"role": "user", "content": item["q"]}]
        s1 = stream_chat(client, key, model, messages, tools=TOOL)
        streams = [s1]
        first_audio = s1.first_sentence_ms  # anything said before the tool call is heard first
        answer_audio = None
        if s1.tool_calls:
            call = s1.tool_calls[0]
            try:
                query = json.loads(call["arguments"] or "{}").get("query") or item["q"]
            except json.JSONDecodeError:
                query = item["q"]
            r0 = time.perf_counter()
            ids = index.vector_api(query)
            retrieval_ms = (time.perf_counter() - r0) * 1000
            messages += [
                {"role": "assistant", "content": s1.text or None, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": call["name"], "arguments": call["arguments"] or "{}"}}]},
                {"role": "tool", "tool_call_id": "call_1", "content": index.context(ids)},
            ]
            before = (time.perf_counter() - t0) * 1000
            s2 = stream_chat(client, key, model, messages, tools=TOOL)
            streams.append(s2)
            if s2.first_sentence_ms is not None:
                answer_audio = before + s2.first_sentence_ms
                first_audio = first_audio if first_audio is not None else answer_audio
        else:
            answer_audio = s1.first_sentence_ms
    else:
        r0 = time.perf_counter()
        query = retrieval_query(item)
        ids = {"vector_api": index.vector_api, "hybrid_local": index.hybrid, "hybrid_rerank": index.hybrid_rerank,
               "hybrid_plain": index.hybrid_plain, "hybrid_wide": lambda q: index.hybrid(q, pool=8)}[pipeline](query)
        retrieval_ms = (time.perf_counter() - r0) * 1000
        messages = [{"role": "system", "content": f"{SYSTEM}\n\nRelevant documents:\n{index.context(ids)}"}, *history, {"role": "user", "content": item["q"]}]
        s = stream_chat(client, key, model, messages)
        streams = [s]
        first_audio = retrieval_ms + s.first_sentence_ms if s.first_sentence_ms is not None else None
        answer_audio = first_audio

    answer = streams[-1].text
    gold_hit = None if pipeline == "full_context" else any(index.chunks[i].doc in item["gold"] for i in ids)
    price_in, price_out = MODELS[model]["price"]
    cost = sum(s.prompt_tokens * price_in + s.completion_tokens * price_out for s in streams) / 1e6
    return {
        "pipeline": pipeline,
        "model": model,
        "question": item["id"],
        "followup": "history" in item,
        "retrieval_ms": round(retrieval_ms, 1),
        "llm_calls": len(streams),
        "ttft_ms": round(streams[-1].ttft_ms or -1, 1),
        "first_audio_ms": round(first_audio, 1) if first_audio is not None else None,
        "answer_audio_ms": round(answer_audio, 1) if answer_audio is not None else None,
        "correct": all(any(re.search(p, answer, re.I) for p in group) for group in item["expect"]),
        "gold_hit": gold_hit,
        "prompt_tokens": sum(s.prompt_tokens for s in streams),
        "cached_tokens": sum(s.cached_tokens for s in streams),
        "cost_usd": cost,
        "provider": streams[-1].provider,
        "answer": answer.strip(),
    }


# ── Report ──────────────────────────────────────────────────────────────


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else float("nan")


def summarize(rows: list[dict]) -> list[dict]:
    out = []
    groups: dict[tuple, list] = {}
    for r in rows:
        groups.setdefault((r["kb"], r["model"], r["pipeline"]), []).append(r)
    for (kb, model, pipeline), rs in sorted(groups.items()):
        answer = [r["answer_audio_ms"] for r in rs if r["answer_audio_ms"] is not None]
        first = [r["first_audio_ms"] for r in rs if r["first_audio_ms"] is not None]
        # Perceived latency from the moment the caller stops speaking.
        commit = [COMMIT_MS + x for x in answer]
        early = [max(COMMIT_MS, STT_FINAL_MS + x) for x in answer]
        hits = [r["gold_hit"] for r in rs if r["gold_hit"] is not None]
        out.append({
            "kb": kb, "model": model.split("/")[-1], "pipeline": pipeline, "n": len(rs),
            "accuracy": round(100 * sum(r["correct"] for r in rs) / len(rs)),
            "followup_accuracy": round(100 * sum(r["correct"] for r in rs if r["followup"]) / max(1, sum(r["followup"] for r in rs))),
            "retrieval_hit": round(100 * sum(hits) / len(hits)) if hits else None,
            "retrieval_p50_ms": round(statistics.median([r["retrieval_ms"] for r in rs])),
            "answer_p50_ms": round(statistics.median(answer)) if answer else None,
            "first_audio_p50_ms": round(statistics.median(first)) if first else None,
            "perceived_p50_ms": round(statistics.median(commit)) if commit else None,
            "perceived_p90_ms": round(pct(commit, 90)) if commit else None,
            "perceived_early_p50_ms": round(statistics.median(early)) if early else None,
            "prompt_tokens_avg": round(statistics.mean(r["prompt_tokens"] for r in rs)),
            "cached_share": round(100 * sum(r["cached_tokens"] for r in rs) / max(1, sum(r["prompt_tokens"] for r in rs))),
            "cost_per_1k_turns_usd": round(1000 * statistics.mean(r["cost_usd"] for r in rs), 3),
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True, type=Path)
    ap.add_argument("--env", default=str(HERE.parent.parent / ".env"))
    ap.add_argument("--models", nargs="+", default=list(MODELS))
    ap.add_argument("--pipelines", nargs="+", default=["full_context", "tool_call", "vector_api", "hybrid_plain", "hybrid_local", "hybrid_wide", "hybrid_rerank"])
    ap.add_argument("--kb", nargs="+", default=["small", "large"])
    ap.add_argument("--repeats", type=int, default=2)
    ap.add_argument("--questions", nargs="*")
    args = ap.parse_args()

    key = re.search(r"^OPENROUTER_API_KEY=(.+)$", Path(args.env).read_text(encoding="utf-8"), re.M).group(1).strip()
    items = json.loads((HERE / "questions.json").read_text())
    if args.questions:
        items = [i for i in items if i["id"] in args.questions]

    from fastembed import TextEmbedding
    from fastembed.rerank.cross_encoder import TextCrossEncoder

    local_embed = TextEmbedding(LOCAL_EMBED_MODEL)
    reranker = TextCrossEncoder(LOCAL_RERANK_MODEL)
    client = httpx.Client(timeout=120)
    client.get(f"{API}/models")  # warm the connection, as a live pipeline would be

    rows = []
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    for kb in args.kb:
        chunks = corpus.build(args.docs, kb)
        index = Index(chunks, client, key, local_embed, reranker)
        kb_text = "\n\n".join(f"[{c.doc}]\n{c.text}" for c in chunks)
        # Warm the local models so the first timed query isn't paying load cost.
        index.hybrid_rerank("warm up")
        print(f"[{kb}] {len(chunks)} chunks, ~{len(kb_text) // 4:,} tokens", flush=True)
        for model in args.models:
            for pipeline in args.pipelines:
                for rep in range(args.repeats):
                    for item in items:
                        try:
                            row = run_turn(pipeline, item, model, index, kb_text, client, key)
                        except Exception as exc:  # keep going; record the failure
                            row = {"pipeline": pipeline, "model": model, "question": item["id"], "error": str(exc)[:300]}
                            print("  ERROR", pipeline, model.split("/")[-1], item["id"], row["error"], flush=True)
                            rows.append({**row, "kb": kb, "repeat": rep})
                            continue
                        rows.append({**row, "kb": kb, "repeat": rep})
                    done = [r for r in rows if r.get("kb") == kb and r["model"] == model and r["pipeline"] == pipeline and "error" not in r]
                print(f"  {model.split('/')[-1]:28s} {pipeline:14s} acc={sum(r['correct'] for r in done)}/{len(done)} "
                      f"answer_p50={statistics.median([r['answer_audio_ms'] for r in done if r['answer_audio_ms'] is not None] or [float('nan')]):.0f}ms", flush=True)
                (HERE / "results" / f"raw-{stamp}.json").write_text(json.dumps(rows, indent=1))

    ok = [r for r in rows if "error" not in r]
    summary = summarize(ok)
    meta = {"stt_final_ms": STT_FINAL_MS, "commit_ms": COMMIT_MS, "top_k": TOP_K, "embed_api": EMBED_API_MODEL,
            "local_embed": LOCAL_EMBED_MODEL, "local_rerank": LOCAL_RERANK_MODEL, "repeats": args.repeats,
            "errors": len(rows) - len(ok), "run": stamp}
    (HERE / "results" / f"summary-{stamp}.json").write_text(json.dumps({"meta": meta, "summary": summary}, indent=1))
    print(json.dumps(meta))
    for s in summary:
        print(json.dumps(s))


if __name__ == "__main__":
    main()
