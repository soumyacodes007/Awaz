"""Reads and writes for the Awaz knowledge pipeline (local index, routing)."""

from __future__ import annotations

from sqlalchemy import select, update

from api.db.base_client import BaseDBClient
from api.db.models import KnowledgeBaseChunkModel, KnowledgeBaseDocumentModel

D = KnowledgeBaseDocumentModel
C = KnowledgeBaseChunkModel


class KnowledgeIndexClient(BaseDBClient):
    async def get_knowledge_documents(
        self, organization_id: int, document_uuids: list[str]
    ) -> list[KnowledgeBaseDocumentModel]:
        """Active documents by UUID, in the order given."""
        if not document_uuids:
            return []
        async with self.async_session() as session:
            rows = (
                (
                    await session.execute(
                        select(D).where(
                            D.organization_id == organization_id,
                            D.document_uuid.in_(document_uuids),
                            D.is_active.is_(True),
                        )
                    )
                )
                .scalars()
                .all()
            )
        order = {u: i for i, u in enumerate(document_uuids)}
        return sorted(rows, key=lambda d: order.get(str(d.document_uuid), 0))

    async def get_index_chunks(self, organization_id: int, document_ids: list[int]):
        if not document_ids:
            return []
        async with self.async_session() as session:
            return (
                await session.execute(
                    select(
                        C.id,
                        C.document_id,
                        C.chunk_text,
                        C.contextualized_text,
                        C.embedding_local,
                        C.chunk_index,
                    )
                    .where(
                        C.organization_id == organization_id,
                        C.document_id.in_(document_ids),
                    )
                    .order_by(C.document_id, C.chunk_index)
                )
            ).all()

    async def find_document_by_source_url(
        self, organization_id: int, url: str
    ) -> KnowledgeBaseDocumentModel | None:
        """An active, not-failed document already added from this link."""
        async with self.async_session() as session:
            return (
                (
                    await session.execute(
                        select(D)
                        .where(
                            D.organization_id == organization_id,
                            D.source_url == url,
                            D.is_active.is_(True),
                            D.processing_status != "failed",
                        )
                        .order_by(D.id.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .first()
            )

    async def set_document_filename(self, document_id: int, filename: str) -> None:
        async with self.async_session() as session:
            await session.execute(
                update(D).where(D.id == document_id).values(filename=filename[:500])
            )
            await session.commit()
