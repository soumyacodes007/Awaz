"""Awaz knowledge endpoints: add a document from a link, re-index a document
with the local pipeline, and see how an agent's knowledge will be delivered."""

from __future__ import annotations

import uuid
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from api.db import db_client
from api.db.models import UserModel
from api.routes.knowledge_base import _to_document_response
from api.schemas.knowledge_base import DocumentResponseSchema
from api.sdk_expose import sdk_expose
from api.services.auth.depends import get_user
from api.services.knowledge import extract, retrieval
from api.services.knowledge_base_content import enqueue_document_processing

router = APIRouter(prefix="/knowledge-base", tags=["knowledge-base"])
User = Annotated[UserModel, Depends(get_user)]


class AddLinkRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class KnowledgeSummary(BaseModel):
    mode: str = Field(
        description="none, inline (whole text in the prompt) or retrieval (searched every turn)"
    )
    tokens: int
    inline_max_tokens: int
    documents: list[str]
    indexed_chunks: int


@router.post(
    "/documents/from-url",
    response_model=DocumentResponseSchema,
    **sdk_expose(
        method="add_knowledge_link",
        description="Add a web page to the knowledge base by URL.",
    ),
)
async def add_link(body: AddLinkRequest, user: User):
    try:
        url = extract.validate_url(body.url)
        extract.check_public_host(urlparse(url).hostname or "")
    except extract.ExtractionError as exc:
        raise HTTPException(422, str(exc)) from None
    # Adding the same link twice gives back the first copy (use Re-index to
    # fetch it again) instead of a second document that fails as a duplicate.
    existing = await db_client.find_document_by_source_url(
        user.selected_organization_id, url
    )
    if existing is not None:
        return _to_document_response(existing)
    document = await db_client.create_document(
        organization_id=user.selected_organization_id,
        created_by=user.id,
        filename=url,
        file_size_bytes=0,
        file_hash="",
        mime_type="text/html",
        source_url=url,
        custom_metadata={"source": "url"},
        document_uuid=str(uuid.uuid4()),
        retrieval_mode="chunked",
    )
    await enqueue_document_processing(
        document_id=document.id,
        s3_key="",
        organization_id=user.selected_organization_id,
        created_by_provider_id=str(user.provider_id),
        retrieval_mode="chunked",
    )
    return _to_document_response(document)


@router.post(
    "/documents/{document_uuid}/reprocess",
    response_model=DocumentResponseSchema,
    **sdk_expose(
        method="reprocess_knowledge_document",
        description="Re-read and re-index a document (or re-fetch its link).",
    ),
)
async def reprocess(document_uuid: Annotated[str, Path(max_length=64)], user: User):
    document = await db_client.get_document_by_uuid(
        document_uuid, user.selected_organization_id
    )
    if document is None:
        raise HTTPException(404, "Document not found")
    if document.processing_status == "processing":
        raise HTTPException(409, "The document is already processing")
    await db_client.update_document_status(document.id, "pending")
    await enqueue_document_processing(
        document_id=document.id,
        s3_key=(document.custom_metadata or {}).get("s3_key") or "",
        organization_id=user.selected_organization_id,
        created_by_provider_id=str(user.provider_id),
        retrieval_mode=document.retrieval_mode,
    )
    return _to_document_response(
        await db_client.get_document_by_uuid(
            document_uuid, user.selected_organization_id
        )
    )


@router.get(
    "/summary",
    response_model=KnowledgeSummary,
    **sdk_expose(
        method="knowledge_summary",
        description="How a set of documents reaches an agent: in the prompt or by retrieval.",
    ),
)
async def summary(
    user: User, document_uuids: list[str] = Query(default_factory=list, max_length=200)
):
    knowledge = await retrieval.load(user.selected_organization_id, document_uuids)
    return KnowledgeSummary(
        mode=knowledge.mode,
        tokens=knowledge.tokens,
        inline_max_tokens=retrieval.INLINE_MAX_TOKENS,
        documents=knowledge.documents,
        indexed_chunks=len(knowledge.index.rows) if knowledge.index else 0,
    )


class TryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    document_uuids: list[str] | None = Field(
        default=None, max_length=200, description="Defaults to every ready document"
    )


class TryHit(BaseModel):
    document: str
    text: str
    score: float


class TryResponse(BaseModel):
    hits: list[TryHit]
    ms: float
    reranked: bool
    skipped: bool = Field(description="Nothing relevant enough to add to the turn")


@router.post(
    "/try",
    response_model=TryResponse,
    **sdk_expose(
        method="try_knowledge_question",
        description="Run a caller question through the same search a call uses.",
    ),
)
async def try_question(body: TryRequest, user: User):
    org = user.selected_organization_id
    uuids = body.document_uuids
    if uuids is None:
        docs = await db_client.get_documents_for_organization(
            org, processing_status="completed", limit=200
        )
        uuids = [str(d.document_uuid) for d in docs]
    result = await retrieval.search(org, uuids, body.query)
    return TryResponse(
        hits=[
            TryHit(document=h.document, text=h.text, score=h.score) for h in result.hits
        ],
        ms=round(result.ms, 1),
        reranked=result.reranked,
        skipped=result.skipped,
    )
