"""Organization-scoped storage for agent tests, test runs and their results."""

from datetime import UTC, datetime

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError

from api.db.base_client import BaseDBClient
from api.db.models import AgentTestModel, AgentTestResultModel, AgentTestRunModel

T = AgentTestModel
Run = AgentTestRunModel
Res = AgentTestResultModel


def _now():
    return datetime.now(UTC)


class AgentTestsClient(BaseDBClient):
    # ── Tests ────────────────────────────────────────────────────────────

    async def list_agent_tests(self, organization_id: int, workflow_id: int):
        """Tests with their most recent result (status and run), oldest first."""
        latest = (
            select(
                Res.test_id,
                Res.status,
                Res.run_id,
                Res.finished_at,
                func.row_number()
                .over(partition_by=Res.test_id, order_by=Res.id.desc())
                .label("rn"),
            )
            .where(Res.test_id.isnot(None))
            .subquery()
        )
        query = (
            select(T, latest.c.status, latest.c.run_id, latest.c.finished_at)
            .outerjoin(latest, (latest.c.test_id == T.id) & (latest.c.rn == 1))
            .where(T.organization_id == organization_id, T.workflow_id == workflow_id)
            .order_by(T.id.asc())
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [
            (test, {"status": status, "run_id": run_id, "finished_at": finished})
            if status
            else (test, None)
            for test, status, run_id, finished in rows
        ]

    async def get_agent_test(
        self, organization_id: int, workflow_id: int, test_id: int
    ):
        async with self.async_session() as session:
            return (
                await session.execute(
                    select(T).where(
                        T.id == test_id,
                        T.organization_id == organization_id,
                        T.workflow_id == workflow_id,
                    )
                )
            ).scalar_one_or_none()

    async def get_agent_tests_by_ids(
        self, organization_id: int, workflow_id: int, test_ids: list[int] | None
    ):
        query = select(T).where(
            T.organization_id == organization_id, T.workflow_id == workflow_id
        )
        if test_ids:
            query = query.where(T.id.in_(test_ids))
        async with self.async_session() as session:
            return list((await session.execute(query.order_by(T.id))).scalars())

    async def create_agent_tests(
        self,
        organization_id: int,
        workflow_id: int,
        tests: list[dict],
        created_by: int | None,
    ):
        async with self.async_session() as session:
            models = [
                T(
                    organization_id=organization_id,
                    workflow_id=workflow_id,
                    name=t["name"],
                    scenario=t["scenario"],
                    behaviors=t["behaviors"],
                    created_by=created_by,
                )
                for t in tests
            ]
            session.add_all(models)
            await session.commit()
            for m in models:
                await session.refresh(m)
            return models

    async def update_agent_test(
        self, organization_id: int, workflow_id: int, test_id: int, **fields
    ):
        async with self.async_session() as session:
            test = (
                await session.execute(
                    select(T).where(
                        T.id == test_id,
                        T.organization_id == organization_id,
                        T.workflow_id == workflow_id,
                    )
                )
            ).scalar_one_or_none()
            if test is None:
                return None
            for key, value in fields.items():
                setattr(test, key, value)
            test.updated_at = _now()
            await session.commit()
            await session.refresh(test)
            return test

    async def delete_agent_test(
        self, organization_id: int, workflow_id: int, test_id: int
    ) -> bool:
        async with self.async_session() as session:
            result = await session.execute(
                delete(T).where(
                    T.id == test_id,
                    T.organization_id == organization_id,
                    T.workflow_id == workflow_id,
                )
            )
            await session.commit()
            return result.rowcount > 0

    # ── Runs ─────────────────────────────────────────────────────────────

    async def create_agent_test_run(
        self,
        *,
        organization_id: int,
        workflow_id: int,
        tests: list[AgentTestModel],
        runs_per_test: int,
        created_by: int | None,
        definition_id: int | None,
        version_number: int | None,
        simulator_model: str,
        judge_model: str,
    ) -> AgentTestRunModel:
        """Create a run and one queued result per test per iteration. The run
        number is the agent's next sequence value; a concurrent insert that
        takes the same number retries."""
        for _ in range(5):
            async with self.async_session() as session:
                number = (
                    await session.execute(
                        select(func.coalesce(func.max(Run.number), 0) + 1).where(
                            Run.workflow_id == workflow_id
                        )
                    )
                ).scalar_one()
                run = Run(
                    organization_id=organization_id,
                    workflow_id=workflow_id,
                    number=number,
                    status="queued",
                    runs_per_test=runs_per_test,
                    definition_id=definition_id,
                    version_number=version_number,
                    simulator_model=simulator_model,
                    judge_model=judge_model,
                    created_by=created_by,
                )
                session.add(run)
                try:
                    await session.flush()
                except IntegrityError:
                    await session.rollback()
                    continue
                session.add_all(
                    Res(
                        run_id=run.id,
                        test_id=test.id,
                        iteration=i + 1,
                        test_name=test.name,
                        scenario=test.scenario,
                        behaviors=test.behaviors,
                        status="queued",
                        transcript=[],
                        verdicts=[],
                    )
                    for test in tests
                    for i in range(runs_per_test)
                )
                await session.commit()
                await session.refresh(run)
                return run
        raise RuntimeError("Couldn't allocate a test run number")

    def _counts(self):
        return [
            func.count(Res.id).label("total"),
            func.count(case((Res.status == "passed", 1))).label("passed"),
            func.count(case((Res.status == "failed", 1))).label("failed"),
            func.count(case((Res.status == "error", 1))).label("errored"),
            func.count(case((Res.status.in_(["queued", "running"]), 1))).label(
                "pending"
            ),
        ]

    async def list_agent_test_runs(
        self, organization_id: int, workflow_id: int, limit: int = 50
    ):
        query = (
            select(Run, *self._counts())
            .outerjoin(Res, Res.run_id == Run.id)
            .where(
                Run.organization_id == organization_id, Run.workflow_id == workflow_id
            )
            .group_by(Run.id)
            .order_by(Run.id.desc())
            .limit(limit)
        )
        async with self.async_session() as session:
            return [
                (
                    run,
                    {"total": t, "passed": p, "failed": f, "errored": e, "pending": q},
                )
                for run, t, p, f, e, q in (await session.execute(query)).all()
            ]

    async def get_agent_test_run(
        self, organization_id: int, workflow_id: int | None, run_id: int
    ):
        query = select(Run).where(
            Run.id == run_id, Run.organization_id == organization_id
        )
        if workflow_id is not None:
            query = query.where(Run.workflow_id == workflow_id)
        async with self.async_session() as session:
            run = (await session.execute(query)).scalar_one_or_none()
            if run is None:
                return None, []
            results = list(
                (
                    await session.execute(
                        select(Res)
                        .where(Res.run_id == run.id)
                        .order_by(Res.test_id.nulls_last(), Res.iteration, Res.id)
                    )
                ).scalars()
            )
            return run, results

    async def update_agent_test_run(self, run_id: int, **fields):
        async with self.async_session() as session:
            await session.execute(update(Run).where(Run.id == run_id).values(**fields))
            await session.commit()

    async def update_agent_test_result(self, result_id: int, **fields):
        async with self.async_session() as session:
            await session.execute(
                update(Res).where(Res.id == result_id).values(**fields)
            )
            await session.commit()

    async def get_agent_test_run_status(self, run_id: int) -> str | None:
        async with self.async_session() as session:
            return (
                await session.execute(select(Run.status).where(Run.id == run_id))
            ).scalar_one_or_none()

    async def cancel_agent_test_run(
        self, organization_id: int, workflow_id: int, run_id: int
    ) -> bool:
        """Mark a queued or running run cancelled; queued results are cancelled
        now and the worker stops running ones between turns."""
        async with self.async_session() as session:
            result = await session.execute(
                update(Run)
                .where(
                    Run.id == run_id,
                    Run.organization_id == organization_id,
                    Run.workflow_id == workflow_id,
                    Run.status.in_(["queued", "running"]),
                )
                .values(status="cancelled", finished_at=_now())
            )
            if result.rowcount:
                await session.execute(
                    update(Res)
                    .where(Res.run_id == run_id, Res.status == "queued")
                    .values(status="cancelled", finished_at=_now())
                )
            await session.commit()
            return result.rowcount > 0

    async def fail_stale_agent_test_runs(
        self, organization_id: int, workflow_id: int, stale_before: datetime
    ) -> int:
        """A worker restart can strand a run; mark ones with an old heartbeat failed."""
        async with self.async_session() as session:
            stale = (
                (
                    await session.execute(
                        select(Run.id).where(
                            Run.organization_id == organization_id,
                            Run.workflow_id == workflow_id,
                            Run.status.in_(["queued", "running"]),
                            func.coalesce(Run.heartbeat_at, Run.created_at)
                            < stale_before,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if not stale:
                return 0
            await session.execute(
                update(Run)
                .where(Run.id.in_(stale))
                .values(
                    status="failed",
                    error="The run was interrupted (worker restarted). Run it again.",
                    finished_at=_now(),
                )
            )
            await session.execute(
                update(Res)
                .where(Res.run_id.in_(stale), Res.status.in_(["queued", "running"]))
                .values(status="error", error="Interrupted", finished_at=_now())
            )
            await session.commit()
            return len(stale)
