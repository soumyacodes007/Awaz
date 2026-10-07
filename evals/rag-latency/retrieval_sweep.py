"""Tune the production retriever (api/services/knowledge) without an LLM.

Builds the large look-alike corpus, chunks it with the app's own chunker
(contextual headers), indexes it with the app's own Index, and for each
reranker setting reports how often the top-k chunks contain every expected
answer ("context recall") and how long a search takes.

The reranker dominates search time (cost grows with candidates × passage
length), so the sweep varies the candidate pool and how much of each passage
the cross-encoder reads.

Usage:
  python retrieval_sweep.py --docs <demo-documents folder> [--repeats 3]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import sys
import time
from collections import OrderedDict
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))

import corpus  # noqa: E402
from api.services.knowledge import chunking, local_models  # noqa: E402
from api.services.knowledge import retrieval as R  # noqa: E402

SETTINGS = [  # (pool, chars the reranker reads per passage; None = all)
    (20, None),
    (12, None),
    (20, 512),
    (16, 512),
    (12, 512),
    (12, 400),
    (10, 400),
    (8, 400),
]


def build_index(folder: Path) -> R.Index:
    docs: "OrderedDict[str, list[str]]" = OrderedDict()
    for c in corpus.build(folder, "large"):
        docs.setdefault(c.doc, []).append(c.text)
    rows = []
    for title, pages in docs.items():
        for ch in chunking.chunk_document(title, pages):
            rows.append({"id": len(rows), "document": title, "text": ch.contextualized})
    vecs = local_models.embed_passages_sync([r["text"] for r in rows])
    for r, v in zip(rows, vecs):
        r["embedding"] = v
    return R.Index(rows)


def query_for(item: dict) -> str:
    prev = [m["content"] for m in item.get("history", []) if m["role"] == "user"]
    return R.retrieval_query(prev + [item["q"]])


async def run(index: R.Index, questions: list[dict], repeats: int) -> list[dict]:
    full = local_models.rerank_sync
    out = []
    for pool, chars in SETTINGS:
        R.RERANK_POOL = pool
        local_models.rerank_sync = (
            full if chars is None else (lambda q, t, _n=chars: full(q, [x[:_n] for x in t]))
        )
        hits, ms = 0, []
        for rep in range(repeats):
            for item in questions:
                res = await index.search(query_for(item))
                ms.append(res.ms)
                if rep == 0:
                    ctx = res.as_context()
                    hits += all(any(re.search(p, ctx, re.I) for p in group) for group in item["expect"])
        local_models.rerank_sync = full
        row = {
            "pool": pool,
            "rerank_chars": chars,
            "context_recall": round(hits / len(questions), 3),
            "p50_ms": round(statistics.median(ms)),
            "p95_ms": round(sorted(ms)[int(0.95 * (len(ms) - 1))]),
        }
        print(f"pool={pool:>2} chars={str(chars):>4}  recall {hits}/{len(questions)}  "
              f"p50 {row['p50_ms']:>4} ms  p95 {row['p95_ms']:>4} ms")
        out.append(row)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True, type=Path)
    ap.add_argument("--repeats", type=int, default=3)
    args = ap.parse_args()
    questions = [q for q in json.loads((HERE / "questions.json").read_text()) if q.get("expect")]
    t0 = time.perf_counter()
    index = build_index(args.docs)
    print(f"indexed {len(index.rows)} chunks in {time.perf_counter() - t0:.1f}s, {len(questions)} questions")
    asyncio.run(local_models.warm())
    rows = asyncio.run(run(index, questions, args.repeats))
    out = HERE / "results" / f"retrieval-sweep-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps({"chunks": len(index.rows), "questions": len(questions), "rows": rows}, indent=1))
    print(f"saved {out.name}")


if __name__ == "__main__":
    main()
