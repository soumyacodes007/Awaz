"""Add call feedback, API metadata logs, and call timeline indexes.

Revision ID: 64d2c0879a10
Revises: 3a7b91c5d402
"""

import sqlalchemy as sa
from alembic import op

revision = "64d2c0879a10"
down_revision = "3a7b91c5d402"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_table(
        "call_feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workflow_run_id",
            sa.Integer(),
            sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_id", sa.String(32), nullable=False),
        sa.Column("rating", sa.String(16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "workflow_run_id",
            "user_id",
            "event_id",
            name="uq_call_feedback_run_user_event",
        ),
    )
    op.create_index(
        "ix_call_feedback_org_run",
        "call_feedback",
        ["organization_id", "workflow_run_id"],
    )
    op.create_table(
        "api_request_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("path", sa.String(500), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("query", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_api_request_logs_org_time",
        "api_request_logs",
        ["organization_id", "created_at", "id"],
    )
    op.create_index(
        "ix_api_request_logs_created_at", "api_request_logs", ["created_at"]
    )
    # Avoid blocking call writes while indexing an existing installation.
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_workflows_organization_id",
            "workflows",
            ["organization_id"],
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_webhook_deliveries_org_time",
            "webhook_deliveries",
            ["organization_id", "created_at", "id"],
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_workflow_runs_customer_search",
            "workflow_runs",
            [
                sa.text(
                    "(coalesce(nullif(gathered_context->>'customer_phone_number', ''), CASE WHEN call_type = 'inbound' THEN nullif(initial_context->>'caller_number', '') ELSE coalesce(nullif(initial_context->>'called_number', ''), nullif(initial_context->>'phone_number', '')) END)) gin_trgm_ops"
                )
            ],
            postgresql_using="gin",
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_workflow_runs_assistant_search",
            "workflow_runs",
            [
                sa.text(
                    "(CASE WHEN call_type = 'inbound' THEN coalesce(nullif(initial_context->>'called_number', ''), nullif(initial_context->>'phone_number', '')) ELSE nullif(initial_context->>'caller_number', '') END) gin_trgm_ops"
                )
            ],
            postgresql_using="gin",
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_workflow_runs_workflow_time",
            "workflow_runs",
            ["workflow_id", "created_at", "id"],
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_workflow_runs_time",
            "workflow_runs",
            ["created_at", "id"],
            postgresql_concurrently=True,
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_workflow_runs_assistant_search",
            "workflow_runs",
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_workflow_runs_customer_search",
            "workflow_runs",
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_webhook_deliveries_org_time",
            "webhook_deliveries",
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_workflows_organization_id", "workflows", postgresql_concurrently=True
        )
        op.drop_index(
            "ix_workflow_runs_time", "workflow_runs", postgresql_concurrently=True
        )
        op.drop_index(
            "ix_workflow_runs_workflow_time",
            "workflow_runs",
            postgresql_concurrently=True,
        )
    op.drop_table("api_request_logs")
    op.drop_table("call_feedback")
