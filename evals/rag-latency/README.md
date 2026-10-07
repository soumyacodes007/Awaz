# RAG latency benchmark for voice agents

Which way of giving a voice agent its knowledge base answers fastest and most
reliably, measured the way a streaming call feels.

## What one turn looks like

No audio is involved; the harness replays the events a streaming STT and turn
detector produce:

```
t = 0       caller stops speaking
t = 150 ms  final transcript arrives            (STT_FINAL_MS)
t = 500 ms  turn detector confirms the turn     (COMMIT_MS)
```

The clock stops at **first audio**: the moment the first complete sentence of
the answer is ready to hand to TTS (TTS then adds its own ~100–250 ms, the same
for every pipeline). LLM output is streamed and timestamped token by token.

- **perceived**: the pipeline starts when the turn is confirmed (the usual way).
- **perceived_early**: retrieval and the LLM start on the final transcript, while
  the detector is still deciding (preemptive generation). Audio still never
  plays before the turn is confirmed.

## Pipelines

| Pipeline | What it does |
|---|---|
| `full_context` | Whole knowledge base in the system prompt (cache-augmented generation) |
| `tool_call` | LLM calls a retrieval tool, then answers in a second pass (Dograh today) |
| `vector_api` | Embed the turn with an API model, top-4 cosine, one LLM pass |
| `hybrid_plain` | Local embeddings + BM25 fused with RRF, top-4, chunks without headers |
| `hybrid_local` | Same, with contextual chunk headers |
| `hybrid_wide` | Same, top-8 |
| `hybrid_rerank` | Same, local cross-encoder reranks the top-20 down to 4 |

Follow-ups ("And what's the gross weight?") are retrieved together with the
previous caller question, no LLM rewrite.

## Corpus and questions

- `small`: the 7 CarbonTrace demo PDFs (~700 tokens).
- `large`: the same pages hidden among ~110 look-alike supplier document sets
  (~51k tokens of invoices, declarations, energy, transport and verification
  documents with different plants, IDs and numbers). Generated from a fixed seed.
- `questions.json`: 15 questions with expected-answer patterns: 12 direct
  (one multi-hop) and 3 follow-ups.

## Run

```bash
pip install fastembed pypdf httpx numpy
python bench.py --docs <path to demo-documents> --repeats 2
```

Reads `OPENROUTER_API_KEY` from the repo's `.env`. Writes `results/raw-*.json`
(every turn, with the answer) and `results/summary-*.json`.

## Other checks

- `retrieval_sweep.py`: tunes the production retriever (`api/services/knowledge`)
  without an LLM. Builds the large corpus with the app's own chunker and index,
  then reports context recall and search time for each rerank pool and passage
  length. No API key needed.
- `e2e_app.py`: runs against the running stack. Uploads the demo PDFs, creates
  agents, and asks over text chat in three settings: a small knowledge base
  (inlined), a large one (searched every turn) and a web page added by link.
  Logs in with the test account in `web/.env.local`.

Results and the decisions they led to are written up in
[`KNOWLEDGE_AND_RAG.md`](../../KNOWLEDGE_AND_RAG.md).
