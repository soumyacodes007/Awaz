"""Turn uploads and web pages into plain-text pages, locally.

PDF (pypdf), plain text, Markdown, CSV and HTML are handled here. Other formats
(DOCX, PPTX…) fall back to Dograh's document service (MPS) for conversion.
Link scraping fetches one page with SSRF guards: http(s) only, public
addresses only, a size cap, and a timeout.
"""

from __future__ import annotations

import io
import ipaddress
import re
import socket
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

MAX_FETCH_BYTES = 5 * 1024 * 1024
FETCH_TIMEOUT = 15.0
USER_AGENT = "AwazKnowledgeBot/1.0 (+https://github.com/soumyacodes007/Awaz)"
TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json"}
HTML_EXTENSIONS = {".html", ".htm"}


class ExtractionError(ValueError):
    pass


@dataclass
class Extracted:
    title: str
    pages: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(p for p in self.pages if p.strip())


def _clean(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def from_pdf(data: bytes, title: str) -> Extracted:
    import pypdf

    try:
        reader = pypdf.PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ExtractionError(f"Couldn't read the PDF: {exc}") from None
    pages = [_clean(page.extract_text() or "") for page in reader.pages]
    if not any(pages):
        raise ExtractionError("The PDF has no extractable text (it may be a scan).")
    return Extracted(title=title, pages=pages)


def from_text(data: bytes, title: str) -> Extracted:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return Extracted(title=title, pages=[_clean(data.decode(encoding))])
        except UnicodeDecodeError:
            continue
    raise ExtractionError("Couldn't decode the text file.")


_DROP_TAGS = [
    "script",
    "style",
    "noscript",
    "svg",
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "iframe",
    "button",
]


def from_html(html: str, fallback_title: str) -> Extracted:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    title = (
        (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    )
    for tag in soup(_DROP_TAGS):
        tag.decompose()
    root = soup.find("article") or soup.find("main") or soup.body or soup
    # Keep block structure: headings and paragraphs become separate lines.
    for br in root.find_all("br"):
        br.replace_with("\n")
    blocks = []
    for el in root.find_all(
        ["h1", "h2", "h3", "h4", "p", "li", "td", "th", "pre", "blockquote", "dt", "dd"]
    ):
        text = " ".join(el.get_text(" ", strip=True).split())
        if not text:
            continue
        if el.name in ("h1", "h2", "h3", "h4"):
            text = f"## {text}"
        elif el.name == "li":
            text = f"- {text}"
        blocks.append(text)
    body = (
        "\n".join(dict.fromkeys(blocks)) if blocks else root.get_text("\n", strip=True)
    )
    body = _clean(body)
    if len(body) < 40:
        raise ExtractionError("The page has no readable text (it may need JavaScript).")
    return Extracted(title=title or fallback_title, pages=[body])


def extract_file(data: bytes, filename: str, mime: str | None) -> Extracted | None:
    """Pages for a supported file, or None when it needs the fallback converter."""
    name = filename.lower()
    title = (
        re.sub(r"\.[a-z0-9]+$", "", filename)
        .replace("_", " ")
        .replace("-", " ")
        .strip()
        or filename
    )
    if name.endswith(".pdf") or mime == "application/pdf":
        return from_pdf(data, title)
    if any(name.endswith(ext) for ext in HTML_EXTENSIONS) or (mime or "").startswith(
        "text/html"
    ):
        return from_html(data.decode("utf-8", "replace"), title)
    if any(name.endswith(ext) for ext in TEXT_EXTENSIONS) or (mime or "").startswith(
        "text/"
    ):
        return from_text(data, title)
    return None


# ── Link scraping ───────────────────────────────────────────────────────


def check_public_host(host: str) -> None:
    """Refuse hosts that resolve to private, loopback or link-local addresses,
    so the server can't be used to reach internal services."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise ExtractionError(f"Couldn't resolve {host}") from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise ExtractionError("That address isn't publicly reachable.")


def validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ExtractionError("Use a full http:// or https:// link.")
    return parsed.geturl()


async def fetch_url(url: str) -> tuple[Extracted, bytes]:
    """Fetch a web page (or a linked PDF/text file) and extract its text.
    Redirects are followed by hand so every hop passes the address check."""
    url = validate_url(url)
    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT,
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        for _ in range(5):
            check_public_host(urlparse(url).hostname or "")
            async with client.stream("GET", url) as res:
                if res.status_code in (301, 302, 303, 307, 308) and res.headers.get(
                    "location"
                ):
                    url = validate_url(str(res.url.join(res.headers["location"])))
                    continue
                if res.status_code >= 400:
                    raise ExtractionError(f"The page returned HTTP {res.status_code}.")
                chunks, size = [], 0
                async for chunk in res.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_FETCH_BYTES:
                        raise ExtractionError("The page is larger than 5 MB.")
                    chunks.append(chunk)
                data = b"".join(chunks)
                mime = (
                    (res.headers.get("content-type") or "")
                    .split(";")[0]
                    .strip()
                    .lower()
                )
                break
        else:
            raise ExtractionError("Too many redirects.")
    path_name = (
        urlparse(url).path.rstrip("/").split("/")[-1]
        or urlparse(url).hostname
        or "page"
    )
    fallback_title = urlparse(url).hostname or url
    if mime == "application/pdf" or path_name.lower().endswith(".pdf"):
        return from_pdf(data, path_name), data
    if mime.startswith("text/plain") or mime in ("text/markdown", "text/csv"):
        return from_text(data, path_name), data
    if mime.startswith("text/html") or mime == "application/xhtml+xml" or not mime:
        return from_html(
            data.decode(res.encoding or "utf-8", "replace"), fallback_title
        ), data
    raise ExtractionError(f"Links to {mime} files aren't supported yet.")
