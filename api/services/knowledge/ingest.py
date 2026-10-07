"""Ingest a knowledge base document: extract → chunk with headers → embed
locally → store chunks and full text.

Every document gets both:
  * full_text, used when an agent's whole knowledge base fits in the prompt;
  * header-prefixed chunks with local embeddings, used for retrieval when it
    doesn't.
So the same upload serves either mode, and an agent switches automatically
as documents are added or removed.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from urllib.parse import urlparse

from api.db import db_client
from api.db.models import KnowledgeBaseChunkModel
from api.services.knowledge import chunking, extract, local_models
from loguru import logger

PIPELINE_VERSION = "awaz-local-v1"


async def _fallback_convert(
    path: str, filename: str, mime: str, organization_id: int, created_by: str | None
) -> extract.Extracted:
    """DOCX, PPTX and other formats: convert to text with Dograh's document service."""
    from api.services.mps_service_key_client import mps_service_key_client

    try:
        response = await mps_service_key_client.process_document(
            file_path=path,
            filename=filename,
            content_type=mime or "application/octet-stream",
            retrieval_mode="full_document",
            organization_id=organization_id,
            created_by=created_by,
        )
    except Exception as exc:
        raise extract.ExtractionError(
            f"Can't read {os.path.splitext(filename)[1] or 'this'} files locally, and the conversion service failed: {exc}"
        ) from None
    text = (response.get("full_text") or "").strip()
    if not text:
        raise extract.ExtractionError("The document has no extractable text.")
    return extract.Extracted(title=os.path.splitext(filename)[0], pages=[text])


async def _read_upload(s3_key: str) -> tuple[bytes, str]:
    from api.services.storage import storage_fs

    filename = s3_key.split("/")[-1]
    fd, path = tempfile.mkstemp(suffix=os.path.splitext(filename)[1] or ".bin")
    os.close(fd)
    try:
        if not await storage_fs.adownload_file(s3_key, path):
            raise extract.ExtractionError("Couldn't download the uploaded file.")
        with open(path, "rb") as f:
            return f.read(), path
    except Exception:
        os.remove(path)
        raise


async def ingest_document(
    document_id: int,
    s3_key: str | None,
    organization_id: int,
    created_by: str | None,
    max_bytes: int,
) -> int:
    """Process one document; returns the number of chunks stored."""
    document = await db_client.get_document_by_id(document_id)
    if document is None:
        raise ValueError(f"Document {document_id} not found")
    await db_client.update_document_status(document_id, "processing")

    path = None
    try:
        if document.source_url:
            extracted, raw = await extract.fetch_url(document.source_url)
            mime = "text/html"
            host = urlparse(document.source_url).hostname or ""
            title = extracted.title or host
            await db_client.set_document_filename(
                document_id,
                f"{title} ({host})" if host and host not in title else title,
            )
            filename = title
        else:
            key = s3_key or (document.custom_metadata or {}).get("s3_key")
            if not key:
                raise extract.ExtractionError(
                    "The document has no file or link to read."
                )
            raw, path = await _read_upload(key)
            filename = key.split("/")[-1]
            mime = db_client.get_mime_type(path)
            if len(raw) > max_bytes:
                raise extract.ExtractionError(
                    f"The file is larger than {max_bytes // (1024 * 1024)} MB."
                )
            extracted = extract.extract_file(
                raw, filename, mime
            ) or await _fallback_convert(
                path, filename, mime, organization_id, created_by
            )

        file_hash = hashlib.sha256(raw).hexdigest()
        duplicate = await db_client.get_document_by_hash(file_hash, organization_id)
        if duplicate and duplicate.id != document_id:
            await db_client.update_document_status(
                document_id,
                "failed",
                error_message=f"This content is identical to '{duplicate.filename}'. Keep only one copy of it in the knowledge base.",
                docling_metadata={"duplicate_of": str(duplicate.document_uuid)},
            )
            return 0
        await db_client.update_document_metadata(
            document_id, file_size_bytes=len(raw), file_hash=file_hash, mime_type=mime
        )

        chunks = chunking.chunk_document(extracted.title, extracted.pages)
        vectors = await local_models.embed_passages([c.contextualized for c in chunks])
        records = [
            KnowledgeBaseChunkModel(
                document_id=document_id,
                organization_id=organization_id,
                chunk_text=c.text,
                contextualized_text=c.contextualized,
                chunk_index=c.index,
                chunk_metadata={"page": c.page},
                embedding_model=local_models.EMBED_MODEL,
                embedding_dimension=local_models.EMBED_DIM,
                embedding_local=vec.tolist(),
                token_count=c.tokens,
            )
            for c, vec in zip(chunks, vectors)
        ]
        await db_client.replace_chunks_for_document(
            document_id=document_id, organization_id=organization_id, chunks=records
        )
        full_text = extracted.text
        await db_client.update_document_full_text(document_id, full_text)
        await db_client.update_document_status(
            document_id,
            "completed",
            total_chunks=len(records),
            docling_metadata={
                "pipeline": PIPELINE_VERSION,
                "pages": len(extracted.pages),
                "tokens": chunking.estimate_tokens(full_text),
                "embedding_model": local_models.EMBED_MODEL,
                "header": chunking.header_for(extracted.title, extracted.pages),
            },
        )
        logger.info(
            f"[knowledge] document {document_id}: {len(extracted.pages)} pages, {len(records)} chunks"
        )
        return len(records)
    except extract.ExtractionError as exc:
        await db_client.update_document_status(
            document_id, "failed", error_message=str(exc)
        )
        return 0
    except Exception as exc:
        logger.exception(f"[knowledge] processing document {document_id} failed")
        await db_client.update_document_status(
            document_id, "failed", error_message=f"Processing failed: {exc}"[:500]
        )
        raise
    finally:
        if path and os.path.exists(path):
            os.remove(path)
