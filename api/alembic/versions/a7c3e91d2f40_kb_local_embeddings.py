"""Add local (384-dim) embeddings to knowledge base chunks.

Revision ID: a7c3e91d2f40
Revises: 9b4e2d7c1a50
"""

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision = "a7c3e91d2f40"
down_revision = "9b4e2d7c1a50"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "knowledge_base_chunks",
        sa.Column("embedding_local", Vector(384), nullable=True),
    )


def downgrade():
    op.drop_column("knowledge_base_chunks", "embedding_local")
