"""Split extracted pages into chunks and give each one a contextual header.

The header (document title plus its first identifying lines) is the single
biggest accuracy lever we measured: on look-alike documents it took hybrid
retrieval from 33% to 67% correct, because page 2 of an invoice otherwise
doesn't say which invoice it belongs to (evals/rag-latency).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MAX_CHARS = 1200  # ~300 tokens: one or two short sections
OVERLAP_CHARS = 150
HEADER_LINES = 3
HEADER_MAX_CHARS = 220


@dataclass
class Chunk:
    index: int
    page: int
    text: str
    contextualized: str

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.contextualized)


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def header_for(title: str, pages: list[str]) -> str:
    """Title plus the document's first few non-empty lines, e.g.
    "commercial invoice | COMMERCIAL INVOICE | Invoice No: CT-INV-2025-0143"."""
    first = next((p for p in pages if p.strip()), "")
    lines = [ln.strip(" #-") for ln in first.splitlines() if ln.strip()][:HEADER_LINES]
    parts = [title.strip()] + [
        ln for ln in lines if ln.lower() != title.strip().lower()
    ]
    header = " | ".join(dict.fromkeys(p for p in parts if p))
    return header[:HEADER_MAX_CHARS]


def _split(text: str) -> list[str]:
    """Pack paragraphs (then lines, then sentences) into chunks of ≤ MAX_CHARS."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    units: list[str] = []
    for p in paragraphs:
        if len(p) <= MAX_CHARS:
            units.append(p)
            continue
        for line in p.splitlines():
            if len(line) <= MAX_CHARS:
                units.append(line)
            else:
                units.extend(s for s in re.split(r"(?<=[.!?])\s+", line) if s)
    chunks, current = [], ""
    for unit in units:
        if len(unit) > MAX_CHARS:  # one enormous sentence: hard-wrap it
            for i in range(0, len(unit), MAX_CHARS):
                chunks.append(unit[i : i + MAX_CHARS])
            continue
        if current and len(current) + 1 + len(unit) > MAX_CHARS:
            chunks.append(current)
            tail = current[-OVERLAP_CHARS:]
            current = (
                (tail[tail.find(" ") + 1 :] + "\n" + unit) if " " in tail else unit
            )
        else:
            current = f"{current}\n{unit}" if current else unit
    if current:
        chunks.append(current)
    return chunks


def chunk_document(title: str, pages: list[str]) -> list[Chunk]:
    header = header_for(title, pages)
    out: list[Chunk] = []
    for page_no, page in enumerate(pages, start=1):
        for piece in _split(page):
            out.append(
                Chunk(
                    index=len(out),
                    page=page_no,
                    text=piece,
                    contextualized=f"{header}\n{piece}",
                )
            )
    return out
