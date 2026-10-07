# Knowledge and RAG for voice agents: measurements and decisions

**Date:** 2026-10-07
**Scope:** how an Awaz agent gets the facts it answers from, from the system prompt down to per-turn retrieval. Covers what we benchmarked, what we built, the numbers behind each choice, and what is still open.
**Code:** `api/services/knowledge/` (extract, chunking, local models, retrieval, ingest), `api/services/pipecat/knowledge_injector.py`, `api/routes/knowledge.py`; benchmark and app checks in `evals/rag-latency/`.

## Summary

- **Small knowledge bases (≤ 8k tokens) go whole into the system prompt.** This is the fastest and most accurate option: first audio at about 0.83 s perceived with Llama 3.1 8B, and 93–100% correct. No retrieval runs.
- **Bigger ones are searched before every turn, inside the pipeline.** The search uses local embeddings plus BM25, fused with RRF, then a local cross-encoder rerank, on chunks that carry a document header. On a 51k-token corpus of look-alike documents this scored **87% correct at 1.14 s perceived**, against **40% at 2.77 s** for the tool-call RAG Dograh shipped with.
- **Retrieval no longer needs any network call.** Embedding and reranking run on CPU in the API process (ONNX via fastembed). A query embedding takes about 17 ms; the same call to an embeddings API took 1.2–1.5 s.
- **In the running app** (real ingestion, real agents, text chat), all checks pass:
  - inline 4/4
  - retrieval 5/5, including a follow-up
  - link scraping 1/1

  Retrieval-mode turns run at about 2.0 s p50, against 3.2–3.6 s before the fixes below.
- **Web pages can be added by link.** Fetching is SSRF-guarded, the readable text is extracted, and the page is then chunked and indexed like any document. A Wikipedia page took about 4.5 s end to end the first time and 2.1 s on re-runs.

## The knowledge hierarchy

Each kind of information has one place to live. The rule of thumb: the closer to the caller's turn something must be right, and the smaller it is, the higher it goes.

| Tier | What | Where it lives | Cost per turn | Use for |
|---|---|---|---|---|
| 0 | Persona, rules, **core facts** | System prompt (`prompt`, new `core_facts` field) | 0 ms, cached | Hours, phone numbers, address, prices: facts the agent must never get wrong |
| 1 | Call-start context | Pre-call fetch, template variables | 0 ms per turn (once per call) | Caller's name, account, last order |
| 2 | Small knowledge base | Inlined in the system prompt when the attached documents total ≤ 8k tokens | 0 ms, cached | FAQs, short policies, menus |
| 3 | Large knowledge base | Hybrid search before every turn, top-4 chunks added to that turn | ~0.3 s | Catalogues, manuals, many look-alike records |
| 4 | Live data | Tools (HTTP/MCP) | 0.5–2 s | Stock, bookings, order status: anything that changes |
| 5 | Long calls | Context summarisation (Dograh's existing summariser) | – | Keeping the window small in 20-minute calls |

Retrieval is **not** used for:

- core facts, which must be in every turn;
- live data, which must be fetched fresh;
- anything small enough to inline, where the measurements say inlining wins on both speed and accuracy.

## Benchmark setup (`evals/rag-latency/bench.py`)

No audio is involved. The harness replays what a streaming STT and turn detector produce, and stops the clock at **first audio**: the first complete sentence ready for TTS.

```
t = 0       caller stops speaking
t = 150 ms  final transcript
t = 500 ms  turn detector commits the turn
```

- **perceived** = 500 ms + time from commit to first sentence (the normal pipeline).
- **early** = the pipeline starts on the final transcript (preemptive generation). Audio still never plays before the commit.

**Models:**

- `meta-llama/llama-3.1-8b-instruct`, served by Groq through OpenRouter.
- `openai/gpt-6-luna` with minimal reasoning ($0.10 / $0.50 per M tokens).

**Corpora:**

- **small:** 7 CarbonTrace demo PDFs, about 700 tokens.
- **large:** the same pages hidden among 110 generated look-alike supplier document sets: invoices, declarations, energy, transport and verification documents with different plants, IDs and numbers. About 51k tokens, from a fixed seed.

**Questions:** 15 with expected-answer patterns:

- 12 direct questions, one of them multi-hop;
- 3 follow-ups, such as "And what's the gross weight?".

Each was run twice per model and pipeline: 840 turns, 0 errors (run `20261007-150854`).

### Small knowledge base (~700 tokens)

| Pipeline | Correct (Llama / luna) | Llama answer p50 | Llama perceived p50 | Llama early p50 | luna answer p50 |
|---|---|---|---|---|---|
| **full_context** (inline) | 93% / 100% | 334 ms | **834 ms** | 500 ms | 1200 ms |
| hybrid_local | 100% / 100% | 354 ms | 854 ms | 504 ms | 1431 ms |
| hybrid_rerank | 100% / 100% | 562 ms | 1062 ms | 712 ms | 1575 ms |
| vector_api | 100% / 97% | 1512 ms | 2012 ms | 1662 ms | 2683 ms |
| tool_call (Dograh before) | 93% / 100% | 1924 ms | 2424 ms | 2074 ms | 4037 ms |

### Large knowledge base (~51k tokens, look-alike documents)

| Pipeline | Correct (Llama / luna) | Follow-ups | Retrieval hit | Retrieval p50 | Llama perceived p50 | Llama early p50 | luna perceived p50 | Cost / 1k turns (Llama) |
|---|---|---|---|---|---|---|---|---|
| full_context | 93% / 100% | 100% | – | – | 5101 ms | 4751 ms | 4611 ms | $3.01 (luna $5.94) |
| **hybrid_rerank** | **87% / 83%** | 100% | 93% | 312 ms | **1136 ms** | **786 ms** | 2234 ms | $0.027 |
| hybrid_wide (top-8) | 80% / 80% | 100% | 87% | 16 ms | 878 ms | 528 ms | 2007 ms | $0.047 |
| hybrid_local | 67% / 67% | 67% | 73% | 16 ms | 820 ms | 500 ms | 1935 ms | $0.027 |
| hybrid_plain (no headers) | 33% / 33% | 33% | 47% | 16 ms | 804 ms | 500 ms | 1910 ms | $0.027 |
| vector_api | 47% / 47% | 33% | 53% | 1518 ms | 2339 ms | 1989 ms | 3512 ms | $0.028 |
| tool_call (Dograh before) | 40% / 33% | 33% | 47% | 1543 ms | 2769 ms | 2419 ms | 5084 ms | $0.057 |

**How to read this:**

- **Inlining 51k tokens is accurate but slow.** It takes 4.6–5.1 s to first audio and costs about 100× more per turn. Prompt caching hit 100% for luna but only 19% for Llama on Groq. That is why the inline limit is 8k tokens and not "whatever fits".
- **Contextual chunk headers are the biggest single lever: 33% → 67%.** Page 2 of an invoice doesn't say which invoice it belongs to; the header does.
- **Reranking is the second lever: 67% → 87%.** It costs about 300 ms, a price worth paying only when the knowledge base is large.
- **The old tool-call RAG is the worst on both axes.** The model has to decide to search, the API embedding adds about 1.5 s, and a second LLM pass follows.
- **Remaining misses:** a multi-hop question (q11) and a field shared by look-alike documents (q03). One luna "miss" was a grader false negative.

### Retriever tuning (`evals/rag-latency/retrieval_sweep.py`)

The reranker is most of the search time, because its cost grows with candidates × passage length. The sweep ran the production chunker and index over the large corpus (890 chunks, no LLM):

| Rerank pool | Chars read per passage | Context recall | p50 (host) | p95 (host) |
|---|---|---|---|---|
| 20 | all | 14/15 | 365 ms | 440 ms |
| 12 | all | 14/15 | 241 ms | 292 ms |
| 20 | 512 | 14/15 | 332 ms | 404 ms |
| **12** | **512** | **14/15** | **214 ms** | **264 ms** |
| 8 | 400 | 14/15 | 175 ms | 255 ms |

Recall is flat across settings, so **pool 12 reading 512 characters** is the default. Inside the API container (WSL Docker, about 2.5× slower CPU than the host) on the app's real 90-chunk index, the median search went from 917 ms to 310 ms with the same hits.

## What we built

### Ingestion (`api/services/knowledge/ingest.py`, runs in the ARQ worker)

1. **Extract:**
   - PDFs via `pypdf`, page by page.
   - Text, Markdown and CSV are read as-is.
   - HTML via BeautifulSoup: nav, header, footer, script and style are dropped; `<article>` or `<main>` is preferred; headings become `## ` and list items `- `.
   - Formats we can't read locally (DOCX, PPTX…) fall back to Dograh's document service.
2. **Duplicate check** by content hash.
3. **Chunk:**
   - Up to 1,200 characters (about 300 tokens), with 150 characters of overlap.
   - Text is packed by paragraph, then line, then sentence.
   - Each chunk gets a **header**: the document title plus its first three lines, for example `commercial invoice | COMMERCIAL INVOICE | Invoice No: CT-INV-2025-0143`.
4. **Embed** locally with `BAAI/bge-small-en-v1.5` (384 dims) into the new `embedding_local` column (migration `a7c3e91d2f40`).
5. **Store** the full text too, so small sets can be inlined without re-reading files.

Local ingestion takes 0.1–1.5 s per document. The models are baked into the API image (`FASTEMBED_CACHE_PATH=/opt/awaz-models`), so the first call never downloads.

### Link scraping (`POST /knowledge-base/documents/from-url`)

- **Guards:**
  - http(s) URLs only, and the host must resolve to a public IP (private, loopback, link-local and reserved ranges are refused);
  - redirects are followed manually, at most 5, and each hop is re-checked;
  - 15 s timeout and a 5 MB cap.
- **Processing:** the page is fetched in the worker, never on the request path. Its title becomes the document name.
- **Re-adding the same URL** returns the existing document. Before this, each re-add created a new row that failed as a duplicate.
- **Re-index** (`POST …/{uuid}/reprocess`) fetches the page again.

### Routing (`api/services/knowledge/retrieval.py`)

When a node starts, `load()` reads the attached documents and decides:

- **inline:** total ≤ `AWAZ_KB_INLINE_MAX_TOKENS` (default 8000). The text goes into the system prompt under `## Knowledge base`, after the prompt and core facts. Documents marked "full document" are always inlined.
- **retrieval:** anything bigger. The index (BM25 + dense matrix) is built in memory and cached per process, keyed by document IDs and `updated_at`, so a re-index invalidates it.

The result is visible:

- on the agent's Tools tab ("In the prompt" or "Searched every turn", with token counts);
- through `GET /knowledge-base/summary`.

### Per-turn retrieval (`KnowledgeInjector`)

A frame processor placed in front of the LLM in both the voice agent pipeline and text chat. For each `LLMContextFrame` in retrieval mode, it:

1. **Builds the query.** The latest caller turn is used alone if it names its own subject (an ID, or 8+ words). Otherwise, as with "and the gross weight?" or "what about…", the previous turn is prepended. No LLM rewrite is involved, and follow-ups are 100% correct.
2. **Gathers candidates.** Dense and BM25 top-50 lists are fused with RRF (k = 60). Each ID in the query also gets its own BM25 lookup, so a question naming an invoice and a declaration finds both.
3. **Reranks** the top 12 with `Xenova/ms-marco-MiniLM-L-6-v2` and keeps the top 4. If the best score is below −4, the turn is small talk and nothing is added.
4. **Puts the chunks ahead of the caller's words** in a **copy** of the context. The shared conversation is never modified, so the chunks don't pile up in history.

It logs `[knowledge] 330 ms, 4 chunks (reranked)` per turn.

### Frontend

- **Agent → Core facts:** a new textarea, always in the prompt.
- **Agent → Tools:** shows how the attached documents reach the agent.
- **Knowledge base page:**
  - "Add a web page" input;
  - a re-index button per document, with a globe icon for links;
  - "Try a question", which runs the production search (`POST /knowledge-base/try`) and shows the passages, scores and timing a call would get.

## End-to-end check in the app (`evals/rag-latency/e2e_app.py`)

The script runs against the running stack (API, worker, Postgres, MinIO):

1. It uploads the demo PDFs and creates agents through the public API, using Llama 3.1 8B via Groq.
2. It asks questions over text chat.
3. It adds look-alike supplier packs until the knowledge base crosses the inline limit.
4. It adds a web page by link.

The time measured is the full text-chat turn: HTTP, the LLM's whole answer, and persistence. This is not first audio.

| Run | Change | Inline (small) | Retrieval (large) | Link |
|---|---|---|---|---|
| 191746 | first run: 20 packs, 7,422 tokens, still inline | 4/4, 1176 ms | 5/5, 2208 ms (inline) | 1/1 |
| 192007 | 40 packs, 17,640 tokens → retrieval; injector bypassed in text chat, so the lookup tool answered | 4/4, 1190 ms | 5/5, 3205 ms | 1/1 |
| 192518 | injector fixed, lookup tool still registered: the model called it anyway | 4/4, 1498 ms | 5/5, 3596 ms | 1/1 |
| 193144 | lookup tool off, rerank pool 12 / 512 chars | 4/4, 1180 ms | **4/5**, 1845 ms | 1/1 |
| 193838 | query fix (standalone turns searched alone) | 4/4, 1653 ms | **4/5**, 2644 ms | 1/1 |
| **194151** | chunks placed before the question | **4/4, 1454 ms** | **5/5, 1979 ms** | **1/1** |

In the final runs, in-app retrieval took 303–446 ms per turn, as logged by the injector.

## Decisions and why

1. **Inline up to 8k tokens, retrieve above it.**
   - Inline was the fastest and most accurate option on the small set.
   - At 51k tokens it costs 4–5 s to first audio and about 100× the price.
   - 8k is where a cached prompt stays well under 1 s on small models and the per-turn cost stays negligible.
   - The limit is configurable with `AWAZ_KB_INLINE_MAX_TOKENS`.
2. **Retrieve in the pipeline, not through a tool.** The tool path needs a second LLM round trip and depends on the model choosing to search. It was the slowest option and 33–40% accurate on the large set.
   - In the app, the model kept calling the tool even when the answer was already injected, which cost about 1.5 s per turn.
   - The tool is now off by default; `AWAZ_KB_TOOL=1` brings it back.
3. **Local embeddings and reranker, not an API.** An API embedding took 1.2–1.5 s on its own, more than the whole local search including the rerank, and adds a dependency to every turn. bge-small is 384 dims, so the index stays small.
4. **Hybrid BM25 + dense with RRF.** Voice questions are full of IDs and numbers (invoice numbers, units, plants). BM25 nails those, and dense handles paraphrase. RRF needs no score calibration.
5. **Contextual headers on every chunk:** +34 points, for free at query time.
6. **Rerank 12 candidates reading 512 characters.** The reranker added 20 points of accuracy on the large set. Trimming the pool and passage length cut its cost by two thirds with no recall loss.
7. **Search the turn alone unless it's a follow-up.** Always prepending the previous turn let an unrelated earlier question drown out a new one (run 193144). Short or connective turns ("and…", "what about…") still get the previous turn, which keeps follow-ups at 100%.
8. **Reference before the question, in a copy of the context.** Llama 8B answered "I don't know" with the right chunk appended after the question, and answered correctly with it placed before (run 193838 → 194151). Using a copy keeps history clean and the cache prefix stable.
9. **Skip retrieval for small talk.** If the best rerank score is below −4, nothing is added, so "hello, how are you" doesn't pull in invoices.
10. **Core facts are a separate field, always in the prompt.** Facts the business can't afford to get wrong shouldn't depend on retrieval recall.

## Dropped or deferred

- **LLM query rewriting:** the follow-up rule already reaches 100% on follow-ups, and a rewrite costs a full LLM call (0.3–1 s).
- **Wider top-k (8) instead of reranking:** cheaper (16 ms) but 7 points less accurate and twice the prompt tokens.
- **pgvector search at query time:** an in-memory index per agent is faster at these sizes (hundreds to low thousands of chunks). pgvector stays as the store. Revisit above about 50k chunks per agent.
- **Speculative retrieval on interim transcripts:** the "early" column shows about 350 ms to gain. It needs the pipecat fork's speculation hooks wired to the injector. This is next.
- **Multi-hop questions:** one of the two remaining misses. Would need iterative retrieval or a planner, at a latency cost that is hard to justify on a phone call.

## Caveats

- 15 questions over one synthetic domain. The accuracy differences that matter (33 → 67 → 87%) are large, but single-point differences are noise.
- Benchmark latencies were measured from India against OpenRouter, with about 210 ms of network round trip. Absolute numbers will differ elsewhere; the order of pipelines didn't change between runs.
- The e2e turn times include the full LLM answer and API overhead, not first audio, and vary with provider load: run 194119 had every turn about 2 s slower, inline included.
- Container CPU is slower than the benchmark host, so in-app retrieval is about 330 ms where the bench measured about 214 ms.

## Reproduce

```bash
cd evals/rag-latency
pip install fastembed pypdf httpx numpy loguru
python bench.py --docs <demo-documents> --repeats 2         # needs OPENROUTER_API_KEY in ../../.env
python retrieval_sweep.py --docs <demo-documents>           # no API key needed
python e2e_app.py --docs <demo-documents>                   # needs the stack running and web/.env.local test login
```
