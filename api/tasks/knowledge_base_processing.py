"""ARQ task: process a knowledge base document.

Awaz runs the whole pipeline locally (api/services/knowledge/ingest.py):
extraction, contextual chunk headers and local embeddings, plus the full text
for agents whose knowledge base fits in the prompt. Dograh's document service
(MPS) is only used to convert formats we can't read locally (DOCX, PPTX…).
Documents added by link (``source_url``) are fetched here, off the request path.
"""

from loguru import logger

from api.services.knowledge.ingest import ingest_document

MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
EMBEDDING_BATCH_SIZE = 64


async def _embed_texts_in_batches(
    embedding_service,
    texts: list[str],
    batch_size: int = EMBEDDING_BATCH_SIZE,
) -> list[list[float]]:
    """Generate embeddings in bounded batches for provider/MPS stability."""
    embeddings: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        embeddings.extend(await embedding_service.embed_texts(batch))
    return embeddings


async def process_knowledge_base_document(
    ctx,
    document_id: int,
    s3_key: str,
    organization_id: int,
    created_by_provider_id: str,
    max_tokens: int = 128,
    retrieval_mode: str = "chunked",
):
    """Process one document. ``max_tokens`` and ``retrieval_mode`` are kept for
    job compatibility: chunk size is fixed by the local pipeline, and every
    document now gets both chunks and full text."""
    logger.info(
        f"Processing knowledge base document {document_id} (org {organization_id})"
    )
    await ingest_document(
        document_id,
        s3_key or None,
        organization_id,
        created_by_provider_id,
        MAX_FILE_SIZE_BYTES,
    )
