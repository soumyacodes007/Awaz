"""End-to-end check of the Awaz knowledge pipeline against a running app.

1. Uploads the demo PDFs, creates an agent with core facts, and checks the
   knowledge base is inlined (small) and answered correctly over text chat.
2. Adds look-alike supplier documents until the knowledge base passes the
   inline limit, checks it switches to retrieval, and asks again (incl. a
   follow-up).
3. Adds a web page by link and checks it's fetched, chunked and answerable.

Usage:
  python e2e_app.py --docs <demo-documents folder> [--api http://127.0.0.1:8000]
Logs in with AWAZ_DEV_EMAIL / AWAZ_DEV_PASSWORD from web/.env.local.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import time
from pathlib import Path

import httpx

import corpus

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
LLM = {"provider": "openrouter", "model": "meta-llama/llama-3.1-8b-instruct", "base_url": "https://openrouter.ai/api/v1", "provider_order": ["groq"]}
SETTINGS = {
    "model_configuration_v2_override": {
        "version": 2,
        "mode": "byok",
        "byok": {
            "mode": "pipeline",
            "pipeline": {
                "llm": LLM,
                "stt": {"provider": "sarvam", "model": "saarika:v2.5", "language": "unknown"},
                "tts": {"provider": "sarvam", "model": "bulbul:v2", "voice": "anushka", "language": "hi-IN", "speed": 1.0},
            },
        },
    }
}
PROMPT = (
    "You are a phone agent for CarbonTrace, answering questions about shipment and emissions documents. "
    "Answer in one or two short spoken sentences. Write numbers as digits. "
    "If the documents don't contain the answer, say you don't know."
)
CORE_FACTS = "CarbonTrace support line: +91 80 4000 1234. Support hours: 9 AM to 6 PM IST, Monday to Friday."
SMALL_QUESTIONS = [
    ("What's the net weight on invoice CT-INV-2025-0143?", r"10[,. ]?000"),
    ("What covered quantity does declaration SED-2025-0091 report?", r"8[,. ]?500"),
    ("What's the sea distance for shipment TD-2025-0143?", r"11[,. ]?800"),
    ("What is your support phone number?", r"4000\s?1234"),
]
LARGE_QUESTIONS = SMALL_QUESTIONS[:3] + [("How much electricity did Odisha Steel Works Unit 4 consume?", r"18[,. ]?400")]
FOLLOW_UP = [("What's the net weight on invoice CT-INV-2025-0143?", None), ("And what's the gross weight?", r"10[,. ]?420")]
LINK = "https://en.wikipedia.org/wiki/Carbon_Border_Adjustment_Mechanism"


class App:
    def __init__(self, api: str):
        env = (ROOT / "web" / ".env.local").read_text(encoding="utf-8")
        email = re.search(r"^AWAZ_DEV_EMAIL=(.+)$", env, re.M).group(1).strip()
        password = re.search(r"^AWAZ_DEV_PASSWORD=(.+)$", env, re.M).group(1).strip()
        self.http = httpx.Client(base_url=f"{api}/api/v1", timeout=120)
        token = self.http.post("/auth/login", json={"email": email, "password": password}).raise_for_status().json()["token"]
        self.http.headers["Authorization"] = f"Bearer {token}"
        # MinIO's presigned URLs say "localhost"; on Windows that tries IPv6
        # first and stalls ~20 s per upload. Force IPv4 for uploads.
        self.upload_http = httpx.Client(transport=httpx.HTTPTransport(local_address="0.0.0.0"), timeout=60)
        items, offset = [], 0
        while True:
            page = self.call("GET", "/knowledge-base/documents", params={"limit": 100, "offset": offset})
            items += page["documents"]
            offset += 100
            if offset >= page["total"]:
                break
        self.existing = {d["filename"]: d["document_uuid"] for d in items if d.get("processing_status") == "completed"}

    def call(self, method, path, **kw):
        r = self.http.request(method, path, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {r.status_code} {r.text[:300]}")
        return r.json() if r.content else None

    def upload(self, name: str, data: bytes, mime: str) -> str:
        if name in self.existing:  # identical re-uploads are refused as duplicates
            return self.existing[name]
        up = self.call("POST", "/knowledge-base/upload-url", json={"filename": name, "mime_type": mime})
        self.upload_http.put(up["upload_url"], content=data, headers={"Content-Type": mime}).raise_for_status()
        self.call("POST", "/knowledge-base/process-document", json={"document_uuid": up["document_uuid"], "s3_key": up["s3_key"], "retrieval_mode": "chunked"})
        return up["document_uuid"]

    def wait(self, uuids: list[str], timeout: float = 300) -> list[dict]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            docs = [self.call("GET", f"/knowledge-base/documents/{u}") for u in uuids]
            if all(d["processing_status"] in ("completed", "failed") for d in docs):
                return docs
            time.sleep(2)
        raise TimeoutError("documents didn't finish processing")

    def summary(self, uuids):
        return self.call("GET", "/knowledge-base/summary", params=[("document_uuids", u) for u in uuids])

    def ask(self, agent_id: int, turns: list[tuple[str, str | None]]) -> list[dict]:
        session = self.call("POST", f"/workflow/{agent_id}/text-chat/sessions", json={})
        out = []
        for text, expect in turns:
            t0 = time.perf_counter()
            session = self.call("POST", f"/workflow/{agent_id}/text-chat/sessions/{session['workflow_run_id']}/messages", json={"text": text, "expected_revision": session["revision"]})
            ms = (time.perf_counter() - t0) * 1000
            reply = ((session["session_data"]["turns"][-1].get("assistant_message")) or {}).get("text") or ""
            out.append({"q": text, "reply": reply, "turn_ms": round(ms), "ok": None if expect is None else bool(re.search(expect, reply, re.I))})
        self.call("POST", f"/workflow/{agent_id}/text-chat/sessions/{session['workflow_run_id']}/end", json={})
        return out


def report(label, rows):
    scored = [r for r in rows if r["ok"] is not None]
    print(f"\n{label}: {sum(r['ok'] for r in scored)}/{len(scored)} correct")
    for r in rows:
        mark = "-" if r["ok"] is None else ("PASS" if r["ok"] else "FAIL")
        print(f"  [{mark}] {r['turn_ms']:5d} ms  {r['q']}  ->  {r['reply'][:110]!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True, type=Path)
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    args = ap.parse_args()
    app = App(args.api)
    results = {}

    # 1. Small knowledge base → inline.
    t0 = time.perf_counter()
    small = [app.upload(p.name, p.read_bytes(), "application/pdf") for p in sorted(args.docs.glob("*.pdf"))]
    docs = app.wait(small)
    print(f"uploaded and processed {len(docs)} PDFs in {time.perf_counter() - t0:.1f}s: "
          f"{[d['processing_status'] for d in docs]}, chunks={sum(d['total_chunks'] for d in docs)}")
    agent = app.call("POST", "/agents", json={"name": "KB test · small", "agent": {"prompt": PROMPT, "core_facts": CORE_FACTS, "document_uuids": small}, "settings": SETTINGS, "attach_end_call_tool": False})
    s = app.summary(small)
    print(f"small knowledge base: mode={s['mode']} tokens={s['tokens']} (inline limit {s['inline_max_tokens']})")
    results["small"] = {"summary": s, "turns": app.ask(agent["id"], [(q, e) for q, e in SMALL_QUESTIONS])}
    report("small / inline", results["small"]["turns"])

    # 2. Large knowledge base → retrieval.
    rng = random.Random(11)
    numbers = [n for n in range(300, 800) if f"{n:04d}" not in corpus.RESERVED]
    rng.shuffle(numbers)
    extra = []
    for n in numbers[:40]:
        chunks = corpus._distractor_set(rng, n)
        text = "\n\n".join(c.text for c in chunks)
        extra.append(app.upload(f"supplier-pack-{n}.txt", text.encode(), "text/plain"))
    app.wait(extra)
    large = small + extra
    big = app.call("POST", "/agents", json={"name": "KB test · large", "agent": {"prompt": PROMPT, "core_facts": CORE_FACTS, "document_uuids": large}, "settings": SETTINGS, "attach_end_call_tool": False})
    s = app.summary(large)
    print(f"\nlarge knowledge base: mode={s['mode']} tokens={s['tokens']} indexed_chunks={s['indexed_chunks']}")
    results["large"] = {"summary": s, "turns": app.ask(big["id"], [(q, e) for q, e in LARGE_QUESTIONS]) + app.ask(big["id"], FOLLOW_UP)}
    report("large / retrieval", results["large"]["turns"])

    # 3. Link scraping.
    t0 = time.perf_counter()
    link = app.call("POST", "/knowledge-base/documents/from-url", json={"url": LINK})
    [doc] = app.wait([link["document_uuid"]], timeout=120)
    if doc["processing_status"] == "failed" and doc["filename"] in app.existing:
        # Already added by an earlier run: duplicates are refused, so use that copy.
        link = {"document_uuid": app.existing[doc["filename"]]}
        [doc] = app.wait([link["document_uuid"]])
    print(f"\nlink: {doc['processing_status']} in {time.perf_counter() - t0:.1f}s · '{doc['filename']}' · "
          f"{doc['total_chunks']} chunks · {(doc.get('docling_metadata') or {}).get('tokens')} tokens {doc.get('processing_error') or ''}")
    web_agent = app.call("POST", "/agents", json={"name": "KB test · link", "agent": {"prompt": "You answer questions about the EU carbon border mechanism in one short sentence.", "document_uuids": [link["document_uuid"]]}, "settings": SETTINGS, "attach_end_call_tool": False})
    s = app.summary([link["document_uuid"]])
    results["link"] = {"summary": s, "document": {k: doc.get(k) for k in ("filename", "processing_status", "total_chunks", "source_url")},
                       "turns": app.ask(web_agent["id"], [("What does CBAM stand for?", r"carbon border adjustment mechanism")])}
    print(f"link knowledge base: mode={s['mode']} tokens={s['tokens']}")
    report("link", results["link"]["turns"])

    out = HERE / "results" / f"e2e-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps(results, indent=1))
    print(f"\nsaved {out.name}")


if __name__ == "__main__":
    main()
