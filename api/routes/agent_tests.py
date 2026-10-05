"""Agent tests: simulated-caller test cases graded by an LLM judge.

Tests belong to an agent. A run executes tests against the agent's draft in a
background job; poll GET /agents/{id}/test-runs/{run_id} for progress."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path

from api.db import db_client
from api.db.models import UserModel
from api.routes.agents import _load
from api.schemas.agent_tests import (
    AgentTestIn,
    AgentTestResponse,
    CreateTestRunRequest,
    GenerateTestsRequest,
    TestConfigResponse,
    TestResultResponse,
    TestRunDetail,
    TestRunSummary,
)
from api.sdk_expose import sdk_expose
from api.services.agent_tests import prompts
from api.services.agent_tests.llm import TestLLMError, chat, load_config, parse_json
from api.services.agents.spec import is_multi_step, normalize, read_agent
from api.services.auth.depends import get_user_with_selected_organization
from api.tasks.arq import enqueue_job
from api.tasks.function_names import FunctionNames

router = APIRouter(tags=["agent-tests"])
User = Annotated[UserModel, Depends(get_user_with_selected_organization)]
AgentID = Annotated[int, Path(gt=0, le=2147483647)]
ItemID = Annotated[int, Path(gt=0, le=2147483647)]

# A run whose heartbeat is older than this was stranded by a worker restart.
STALE_AFTER = timedelta(minutes=20)


async def _agent(agent_id: int, user: UserModel):
    workflow, version = await _load(agent_id, user)
    return workflow, version


def _test(test, last=None) -> AgentTestResponse:
    return AgentTestResponse(
        id=test.id,
        name=test.name,
        scenario=test.scenario,
        behaviors=test.behaviors or [],
        last_result=last,
        created_at=test.created_at,
        updated_at=test.updated_at,
    )


def _fields(body: AgentTestIn) -> dict:
    behaviors = prompts.normalize_behaviors([b.model_dump() for b in body.behaviors])
    if not behaviors:
        raise HTTPException(422, "Add at least one expected behavior")
    return {
        "name": body.name.strip(),
        "scenario": body.scenario.strip(),
        "behaviors": behaviors,
    }


def _summary(run, counts) -> dict:
    return {
        "id": run.id,
        "number": run.number,
        "status": run.status,
        "runs_per_test": run.runs_per_test,
        "version_number": run.version_number,
        "simulator_model": run.simulator_model,
        "judge_model": run.judge_model,
        "error": run.error,
        "created_at": run.created_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        **counts,
    }


def _counts(results) -> dict:
    status = [r.status for r in results]
    return {
        "total": len(status),
        "passed": status.count("passed"),
        "failed": status.count("failed"),
        "errored": status.count("error"),
        "pending": status.count("queued") + status.count("running"),
    }


# ── Config ──────────────────────────────────────────────────────────────


@router.get(
    "/agent-tests/config",
    response_model=TestConfigResponse,
    **sdk_expose(
        method="get_agent_test_config",
        description="Models used to simulate callers and judge tests.",
    ),
)
async def get_test_config(user: User):
    config = load_config()
    return TestConfigResponse(
        configured=config.configured,
        simulator_model=config.simulator_model,
        judge_model=config.judge_model,
    )


# ── Tests ───────────────────────────────────────────────────────────────


@router.get(
    "/agents/{agent_id}/tests",
    response_model=list[AgentTestResponse],
    **sdk_expose(
        method="list_agent_tests",
        description="List an agent's test cases with their latest result.",
    ),
)
async def list_tests(agent_id: AgentID, user: User):
    await _agent(agent_id, user)
    rows = await db_client.list_agent_tests(user.selected_organization_id, agent_id)
    return [_test(test, last) for test, last in rows]


@router.post(
    "/agents/{agent_id}/tests",
    response_model=AgentTestResponse,
    **sdk_expose(
        method="create_agent_test",
        description="Create a test case: a caller scenario and expected behaviors.",
    ),
)
async def create_test(agent_id: AgentID, body: AgentTestIn, user: User):
    await _agent(agent_id, user)
    [test] = await db_client.create_agent_tests(
        user.selected_organization_id, agent_id, [_fields(body)], user.id
    )
    return _test(test)


@router.put(
    "/agents/{agent_id}/tests/{test_id}",
    response_model=AgentTestResponse,
    **sdk_expose(method="update_agent_test", description="Update a test case."),
)
async def update_test(
    agent_id: AgentID, test_id: ItemID, body: AgentTestIn, user: User
):
    test = await db_client.update_agent_test(
        user.selected_organization_id, agent_id, test_id, **_fields(body)
    )
    if test is None:
        raise HTTPException(404, "Test not found")
    return _test(test)


@router.delete(
    "/agents/{agent_id}/tests/{test_id}",
    **sdk_expose(
        method="delete_agent_test", description="Delete a test case. Past results stay."
    ),
)
async def delete_test(agent_id: AgentID, test_id: ItemID, user: User):
    if not await db_client.delete_agent_test(
        user.selected_organization_id, agent_id, test_id
    ):
        raise HTTPException(404, "Test not found")
    return {"deleted": True}


@router.post(
    "/agents/{agent_id}/tests/generate",
    response_model=list[AgentTestResponse],
    **sdk_expose(
        method="generate_agent_tests",
        description="Write starter test cases from the agent's prompt with an LLM.",
    ),
)
async def generate_tests(agent_id: AgentID, body: GenerateTestsRequest, user: User):
    _, version = await _agent(agent_id, user)
    definition = normalize(version.workflow_json if version else {})
    if is_multi_step(definition):
        raise HTTPException(
            409, "Convert this multi-step agent to a single prompt first"
        )
    spec = read_agent(definition)
    if not (spec.prompt or "").strip():
        raise HTTPException(
            422, "Write the agent's prompt first; tests are generated from it"
        )
    tools = (
        await db_client.get_tools_by_uuids(
            spec.tool_uuids, user.selected_organization_id
        )
        if spec.tool_uuids
        else []
    )
    config = load_config()
    messages = prompts.generator_messages(
        spec.prompt,
        spec.greeting.text if spec.greeting and spec.greeting.type == "text" else None,
        [t.name for t in tools],
        body.count,
    )
    try:
        reply = await chat(
            config,
            config.judge_model,
            messages,
            max_tokens=4000,
            temperature=0.6,
            json_mode=True,
        )
        tests = prompts.parse_generated(parse_json(reply, prefer="tests"), body.count)
    except TestLLMError as exc:
        raise HTTPException(502, str(exc)) from None
    except ValueError:
        raise HTTPException(
            502, "The model didn't return usable tests. Try again."
        ) from None
    if not tests:
        raise HTTPException(502, "The model didn't return usable tests. Try again.")
    created = await db_client.create_agent_tests(
        user.selected_organization_id, agent_id, tests, user.id
    )
    return [_test(t) for t in created]


# ── Runs ────────────────────────────────────────────────────────────────


@router.post(
    "/agents/{agent_id}/test-runs",
    response_model=TestRunSummary,
    **sdk_expose(
        method="run_agent_tests",
        description="Run tests (all, or the given ids) against the agent's draft.",
    ),
)
async def create_run(agent_id: AgentID, body: CreateTestRunRequest, user: User):
    _, version = await _agent(agent_id, user)
    if version is not None and is_multi_step(normalize(version.workflow_json)):
        raise HTTPException(
            409, "Convert this multi-step agent to a single prompt first"
        )
    config = load_config()
    if not config.configured:
        raise HTTPException(
            503, "Tests need an LLM key on the server (AWAZ_TEST_OPENROUTER_API_KEY)"
        )
    tests = await db_client.get_agent_tests_by_ids(
        user.selected_organization_id, agent_id, body.test_ids
    )
    if body.test_ids and len(tests) != len(set(body.test_ids)):
        raise HTTPException(404, "Some tests weren't found")
    if not tests:
        raise HTTPException(422, "Add a test first")
    run = await db_client.create_agent_test_run(
        organization_id=user.selected_organization_id,
        workflow_id=agent_id,
        tests=tests,
        runs_per_test=body.runs_per_test,
        created_by=user.id,
        definition_id=version.id if version else None,
        version_number=getattr(version, "version_number", None),
        simulator_model=config.simulator_model,
        judge_model=config.judge_model,
    )
    try:
        await enqueue_job(FunctionNames.RUN_AGENT_TEST_RUN, run.id)
    except Exception:
        await db_client.update_agent_test_run(
            run.id,
            status="failed",
            error="Couldn't queue the run",
            finished_at=datetime.now(UTC),
        )
        raise HTTPException(
            503, "Couldn't queue the run. Is the worker running?"
        ) from None
    total = len(tests) * body.runs_per_test
    return _summary(
        run, {"total": total, "passed": 0, "failed": 0, "errored": 0, "pending": total}
    )


@router.get(
    "/agents/{agent_id}/test-runs",
    response_model=list[TestRunSummary],
    **sdk_expose(
        method="list_agent_test_runs", description="Recent test runs for an agent."
    ),
)
async def list_runs(agent_id: AgentID, user: User):
    await _agent(agent_id, user)
    await db_client.fail_stale_agent_test_runs(
        user.selected_organization_id, agent_id, datetime.now(UTC) - STALE_AFTER
    )
    rows = await db_client.list_agent_test_runs(user.selected_organization_id, agent_id)
    return [_summary(run, counts) for run, counts in rows]


@router.get(
    "/agents/{agent_id}/test-runs/{run_id}",
    response_model=TestRunDetail,
    **sdk_expose(
        method="get_agent_test_run",
        description="A test run with every transcript and verdict.",
    ),
)
async def get_run(agent_id: AgentID, run_id: ItemID, user: User):
    run, results = await db_client.get_agent_test_run(
        user.selected_organization_id, agent_id, run_id
    )
    if run is None:
        raise HTTPException(404, "Run not found")
    return {
        **_summary(run, _counts(results)),
        "results": [
            TestResultResponse(
                id=r.id,
                test_id=r.test_id,
                iteration=r.iteration,
                test_name=r.test_name,
                scenario=r.scenario,
                behaviors=r.behaviors or [],
                status=r.status,
                transcript=r.transcript or [],
                verdicts=r.verdicts or [],
                workflow_run_id=r.workflow_run_id,
                error=r.error,
                started_at=r.started_at,
                finished_at=r.finished_at,
            )
            for r in results
        ],
    }


@router.post(
    "/agents/{agent_id}/test-runs/{run_id}/cancel",
    response_model=TestRunSummary,
    **sdk_expose(
        method="cancel_agent_test_run", description="Stop a queued or running test run."
    ),
)
async def cancel_run(agent_id: AgentID, run_id: ItemID, user: User):
    await db_client.cancel_agent_test_run(
        user.selected_organization_id, agent_id, run_id
    )
    run, results = await db_client.get_agent_test_run(
        user.selected_organization_id, agent_id, run_id
    )
    if run is None:
        raise HTTPException(404, "Run not found")
    return _summary(run, _counts(results))
