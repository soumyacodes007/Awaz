"""Exercise upgrades and downgrades on a dedicated disposable PostgreSQL DB."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import asyncpg
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.db.logs_client import ASSISTANT_NUMBER_SQL, CUSTOMER_NUMBER_SQL
from api.db.models import OrganizationModel, UserModel, WorkflowModel, WorkflowRunModel


async def _verify_search_indexes(target_url, connection):
    """Verify the real planner uses each phone index with 10,000 run records."""
    engine = create_async_engine(
        target_url.replace("postgresql://", "postgresql+asyncpg://")
    )
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            org = OrganizationModel(provider_id="logs-plan-org")
            user = UserModel(provider_id="logs-plan-user")
            session.add_all([org, user])
            await session.flush()
            workflow = WorkflowModel(
                name="Plan agent", organization_id=org.id, user_id=user.id
            )
            session.add(workflow)
            await session.flush()
            await session.execute(
                insert(WorkflowRunModel),
                [
                    {
                        "workflow_id": workflow.id,
                        "name": "plan",
                        "mode": "smallwebrtc",
                        "initial_context": {
                            "called_number": f"+1202555{index:06d}",
                            "caller_number": f"+4420555{index:06d}",
                        },
                    }
                    for index in range(10000)
                ],
            )
            await session.commit()
            organization_id = org.id
        await connection.execute("VACUUM ANALYZE workflow_runs")
        await connection.execute("ANALYZE workflows")
        for expression, index_name in (
            (CUSTOMER_NUMBER_SQL, "ix_workflow_runs_customer_search"),
            (ASSISTANT_NUMBER_SQL, "ix_workflow_runs_assistant_search"),
        ):
            plan = json.loads(
                await connection.fetchval(
                    f"EXPLAIN (ANALYZE, FORMAT JSON) SELECT workflow_runs.id FROM workflow_runs JOIN workflows ON workflows.id = workflow_runs.workflow_id WHERE workflows.organization_id = $1 AND ({expression}) LIKE '%009999%'",
                    organization_id,
                )
            )
            assert index_name in json.dumps(plan), plan
            print(f"{index_name}: {plan[0]['Execution Time']} ms on 10000 runs")
    finally:
        await engine.dispose()


async def test_logs_migration_round_trip():
    parsed = urlsplit(
        os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    )
    database = "dograh_logs_migration_test_" + uuid4().hex[:8]
    admin_url = urlunsplit(parsed._replace(path="/postgres"))
    target_url = urlunsplit(parsed._replace(path="/" + database))
    admin = await asyncpg.connect(admin_url)
    repo = Path(__file__).resolve().parents[2]
    try:
        await admin.execute(f'CREATE DATABASE "{database}" TEMPLATE template0')
        env = {
            **os.environ,
            "DATABASE_URL": target_url.replace(
                "postgresql://", "postgresql+asyncpg://"
            ),
        }

        async def migrate(*arguments):
            result = await asyncio.to_thread(
                subprocess.run,
                [sys.executable, "-m", "alembic", "-c", "api/alembic.ini", *arguments],
                cwd=repo,
                env=env,
                capture_output=True,
                text=True,
                timeout=120,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        await migrate("upgrade", "head")
        connection = await asyncpg.connect(target_url)
        try:
            indexes = await connection.fetch(
                "SELECT indexrelid::regclass::text AS name, indisvalid FROM pg_index WHERE indexrelid::regclass::text LIKE 'ix_workflow_runs_%' OR indexrelid::regclass::text IN ('ix_workflows_organization_id', 'ix_webhook_deliveries_org_time')"
            )
            expected = {
                "ix_workflow_runs_workflow_time",
                "ix_workflow_runs_time",
                "ix_workflow_runs_customer_search",
                "ix_workflow_runs_assistant_search",
                "ix_workflows_organization_id",
                "ix_webhook_deliveries_org_time",
            }
            assert expected <= {row["name"] for row in indexes if row["indisvalid"]}
            assert await connection.fetchval("SELECT to_regclass('call_feedback')")
            assert await connection.fetchval("SELECT to_regclass('api_request_logs')")
            await _verify_search_indexes(target_url, connection)
        finally:
            await connection.close()
        await migrate("downgrade", "3a7b91c5d402")
        connection = await asyncpg.connect(target_url)
        try:
            assert (
                await connection.fetchval("SELECT to_regclass('call_feedback')") is None
            )
            assert (
                await connection.fetchval("SELECT to_regclass('api_request_logs')")
                is None
            )
        finally:
            await connection.close()
        await migrate("upgrade", "head")
    finally:
        # Only this freshly minted test database is removed.
        await admin.execute(f'DROP DATABASE IF EXISTS "{database}"')
        await admin.close()
