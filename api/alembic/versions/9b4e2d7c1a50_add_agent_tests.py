"""Add agent tests: test cases, test runs and per-test results.

Revision ID: 9b4e2d7c1a50
Revises: 64d2c0879a10
"""

import sqlalchemy as sa
from alembic import op

revision = "9b4e2d7c1a50"
down_revision = "64d2c0879a10"
branch_labels = None
depends_on = None


def _org():
    return sa.Column(
        "organization_id",
        sa.Integer(),
        sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _workflow():
    return sa.Column(
        "workflow_id",
        sa.Integer(),
        sa.ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False,
    )


def _created_by():
    return sa.Column(
        "created_by",
        sa.Integer(),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def upgrade():
    op.create_table(
        "agent_tests",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _workflow(),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("scenario", sa.Text(), nullable=False),
        sa.Column("behaviors", sa.JSON(), nullable=False),
        _created_by(),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_agent_tests_org_workflow", "agent_tests", ["organization_id", "workflow_id"]
    )

    op.create_table(
        "agent_test_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        _org(),
        _workflow(),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("runs_per_test", sa.Integer(), nullable=False),
        sa.Column("definition_id", sa.Integer(), nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=True),
        sa.Column("simulator_model", sa.String(200), nullable=True),
        sa.Column("judge_model", sa.String(200), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        _created_by(),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("workflow_id", "number", name="uq_agent_test_runs_number"),
    )
    op.create_index(
        "ix_agent_test_runs_org_workflow",
        "agent_test_runs",
        ["organization_id", "workflow_id"],
    )

    op.create_table(
        "agent_test_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Integer(),
            sa.ForeignKey("agent_test_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "test_id",
            sa.Integer(),
            sa.ForeignKey("agent_tests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("test_name", sa.String(200), nullable=False),
        sa.Column("scenario", sa.Text(), nullable=False),
        sa.Column("behaviors", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("transcript", sa.JSON(), nullable=False),
        sa.Column("verdicts", sa.JSON(), nullable=False),
        sa.Column(
            "workflow_run_id",
            sa.Integer(),
            sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_test_results_run", "agent_test_results", ["run_id"])
    op.create_index("ix_agent_test_results_test", "agent_test_results", ["test_id"])


def downgrade():
    op.drop_table("agent_test_results")
    op.drop_table("agent_test_runs")
    op.drop_table("agent_tests")
