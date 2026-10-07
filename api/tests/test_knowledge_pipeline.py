import asyncio

import pytest

from api.schemas.agent import AgentSpec
from api.services.agents.spec import read_agent, write_agent
from api.services.knowledge import chunking, extract, retrieval
from api.services.knowledge.local_models import embed_passages_sync
from api.services.pipecat.knowledge_injector import augment_messages, user_turns

INVOICE_P1 = "COMMERCIAL INVOICE\nInvoice No: CT-INV-2025-0143\nSeller: Odisha Steel Works, Unit 4"
INVOICE_P2 = (
    "COMMERCIAL INVOICE (continued)\nNet weight: 10,000 kg\nGross weight: 10,420 kg"
)


def test_every_chunk_carries_the_document_header():
    chunks = chunking.chunk_document("commercial invoice", [INVOICE_P1, INVOICE_P2])
    assert [c.page for c in chunks] == [1, 2]
    assert chunks[1].text.startswith("COMMERCIAL INVOICE (continued)")
    # Page 2 alone doesn't name the invoice; its header does.
    assert "CT-INV-2025-0143" in chunks[1].contextualized


def test_long_text_is_split_with_overlap_under_the_limit():
    text = "\n\n".join(f"Paragraph {i}. " + "word " * 60 for i in range(30))
    chunks = chunking.chunk_document("doc", [text])
    assert len(chunks) > 3
    assert all(
        len(c.text) <= chunking.MAX_CHARS + chunking.OVERLAP_CHARS for c in chunks
    )


def test_html_extraction_keeps_content_and_drops_chrome():
    html = """<html><head><title>Clinic hours</title><script>x()</script></head><body>
      <nav>Home | About</nav><main><h1>Opening hours</h1><p>Monday to Saturday, 9 AM to 7 PM.</p>
      <ul><li>Sunday closed</li></ul></main><footer>(c) 2026</footer></body></html>"""
    out = extract.from_html(html, "fallback")
    assert out.title == "Clinic hours"
    assert "## Opening hours" in out.text and "- Sunday closed" in out.text
    assert (
        "Home | About" not in out.text
        and "x()" not in out.text
        and "2026" not in out.text
    )


@pytest.mark.parametrize(
    "url", ["ftp://example.com/a", "example.com", "javascript:alert(1)"]
)
def test_only_http_links_are_accepted(url):
    with pytest.raises(extract.ExtractionError):
        extract.validate_url(url)


@pytest.mark.parametrize(
    "host", ["localhost", "127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1"]
)
def test_private_hosts_are_refused(host):
    with pytest.raises(extract.ExtractionError):
        extract.check_public_host(host)


def test_follow_ups_are_searched_with_the_previous_turn():
    assert retrieval.retrieval_query(
        ["What's the net weight on invoice X?", "And the gross weight?"]
    ) == ("What's the net weight on invoice X? And the gross weight?")
    assert retrieval.retrieval_query(["a", "b", "c"]) == "b c"
    # A turn naming its own subject is searched alone.
    assert (
        retrieval.retrieval_query(
            [
                "What's the net weight on invoice CT-INV-2025-0143?",
                "What covered quantity does declaration SED-2025-0091 report?",
            ]
        )
        == "What covered quantity does declaration SED-2025-0091 report?"
    )
    assert retrieval.retrieval_query(
        ["Tell me about invoice CT-INV-2025-0143", "And what about SED-2025-0091?"]
    ).startswith("Tell me")


def _index(texts):
    vecs = embed_passages_sync(texts)
    return retrieval.Index(
        [
            {"id": i, "document": f"d{i}", "text": t, "embedding": v}
            for i, (t, v) in enumerate(zip(texts, vecs))
        ]
    )


def test_search_finds_the_right_page_and_both_ids_and_skips_small_talk():
    docs = chunking.chunk_document("commercial invoice", [INVOICE_P1, INVOICE_P2])
    decl = chunking.chunk_document(
        "declaration",
        [
            "SUPPLIER EMISSIONS DECLARATION\nDeclaration reference: SED-2025-0091\nReporting period: 1 Jan 2025 - 31 Mar 2025"
        ],
    )
    noise = [
        chunking.chunk_document(
            f"invoice {n}",
            [
                f"COMMERCIAL INVOICE\nInvoice No: CT-INV-2025-0{n}\nNet weight: {n},000 kg"
            ],
        )[0]
        for n in range(200, 230)
    ]
    texts = [c.contextualized for c in docs + decl + noise]
    index = _index(texts)

    result = asyncio.run(
        index.search("What's the gross weight on invoice CT-INV-2025-0143?")
    )
    assert any("10,420" in h.text for h in result.hits)

    both = asyncio.run(
        index.search(
            "Does SED-2025-0091 cover the same period as invoice CT-INV-2025-0143?"
        )
    )
    joined = " ".join(h.text for h in both.hits)
    assert "SED-2025-0091" in joined and "CT-INV-2025-0143" in joined

    assert asyncio.run(index.search("hello, how are you?")).skipped


def test_reference_goes_on_a_copy_of_the_last_caller_turn():
    messages = [
        {"role": "user", "content": "What's the net weight?"},
        {"role": "assistant", "content": "10,000 kg."},
        {"role": "user", "content": "And the gross weight?"},
    ]
    out = augment_messages(messages, "[invoice]\nGross weight: 10,420 kg")
    # Reference first, then the caller's words.
    assert out[-1]["content"].endswith("Caller: And the gross weight?")
    assert out[-1]["content"].index("10,420") < out[-1]["content"].index("Caller:")
    assert messages[-1]["content"] == "And the gross weight?"  # original untouched
    assert user_turns(messages) == ["What's the net weight?", "And the gross weight?"]


def test_core_facts_round_trip_through_the_graph():
    spec = AgentSpec(
        prompt="You are a receptionist.", core_facts="Open 9 to 7, Mon to Sat."
    )
    assert read_agent(write_agent(spec)).core_facts == "Open 9 to 7, Mon to Sat."
