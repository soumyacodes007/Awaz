"""Run agent tests: a simulated caller talks to the agent's draft through the
same text-chat engine the editor's Talk panel uses (real prompt, tools and
end-call), then a judge grades each expected behavior."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from loguru import logger
from pipecat.utils.run_context import set_current_run_id

from api.db import db_client
from api.enums import WorkflowRunMode
from api.services.agent_tests import prompts
from api.services.agent_tests.llm import (
    TestLLMConfig,
    TestLLMError,
    chat,
    load_config,
    parse_json,
)
from api.services.quota_service import authorize_workflow_run_start
from api.services.workflow.initial_context import merge_external_initial_context
from api.services.workflow.run_creation import prepare_workflow_run_inputs
from api.services.workflow.text_chat_session_service import (
    append_text_chat_user_message,
    complete_text_chat_session,
    default_text_chat_checkpoint,
    default_text_chat_session_data,
    execute_pending_text_chat_turn,
    initialize_text_chat_session,
    normalize_text_chat_session_data,
)

# Caller turns per conversation. Each costs a simulator call plus an agent turn.
MAX_CALLER_TURNS = 10
# Callers speak a sentence or two; anything this long is not a spoken line.
MAX_CALLER_LINE = 600


def _now():
    return datetime.now(UTC)


class Cancelled(Exception):
    pass


async def run_agent_test_run(run_id: int) -> None:
    config = load_config()
    run, results = await db_client.get_agent_test_run(
        organization_id=await _run_org(run_id), workflow_id=None, run_id=run_id
    )
    if run is None or run.status != "queued":
        return
    await db_client.update_agent_test_run(
        run_id, status="running", started_at=_now(), heartbeat_at=_now()
    )
    gate = asyncio.Semaphore(config.concurrency)

    async def one(result):
        async with gate:
            if await db_client.get_agent_test_run_status(run_id) == "cancelled":
                return
            await _run_result(run, result, config)
            await db_client.update_agent_test_run(run_id, heartbeat_at=_now())

    try:
        await asyncio.gather(*(one(r) for r in results if r.status == "queued"))
    except Exception as exc:  # defensive: _run_result records its own errors
        logger.exception(f"Agent test run {run_id} failed")
        await db_client.update_agent_test_run(
            run_id, status="failed", error=str(exc)[:500], finished_at=_now()
        )
        return
    if await db_client.get_agent_test_run_status(run_id) != "cancelled":
        await db_client.update_agent_test_run(
            run_id, status="completed", finished_at=_now()
        )


async def _run_org(run_id: int) -> int:
    # The worker only has the run id; read its organization without scoping.
    from sqlalchemy import select

    from api.db.models import AgentTestRunModel

    async with db_client.async_session() as session:
        return (
            await session.execute(
                select(AgentTestRunModel.organization_id).where(
                    AgentTestRunModel.id == run_id
                )
            )
        ).scalar_one()


async def _run_result(run, result, config: TestLLMConfig) -> None:
    await db_client.update_agent_test_result(
        result.id, status="running", started_at=_now()
    )
    items: list[dict] = []
    workflow_run_id = None

    async def save(**fields):
        await db_client.update_agent_test_result(result.id, transcript=items, **fields)

    try:
        workflow_run_id, session = await _start_conversation(run, result)
        await save(workflow_run_id=workflow_run_id)
        items = prompts.transcript_from_session(
            normalize_text_chat_session_data(session.session_data)
        )
        await save()

        for _ in range(MAX_CALLER_TURNS):
            if _ended(session):
                break
            if await db_client.get_agent_test_run_status(run.id) == "cancelled":
                raise Cancelled()
            line = prompts.caller_reply(
                await chat(
                    config,
                    run.simulator_model or config.simulator_model,
                    prompts.simulator_messages(result.scenario, items),
                    max_tokens=300,
                    temperature=0.8,
                    reasoning=False,
                )
            )
            if line and len(line) > MAX_CALLER_LINE:
                raise TestLLMError(
                    "The caller model replied with a long monologue (often leaked "
                    "reasoning) instead of a spoken line. Try another simulator model."
                )
            if line is None or prompts.goodbyes_traded(items, line):
                items.append({"role": "caller_end", "text": "Caller ended the call"})
                break
            session = await append_text_chat_user_message(
                run_id=workflow_run_id,
                text_session=session,
                user_text=line,
                expected_revision=session.revision,
            )
            session = await execute_pending_text_chat_turn(
                workflow_id=run.workflow_id,
                run_id=workflow_run_id,
                text_session=session,
            )
            items = prompts.transcript_from_session(
                normalize_text_chat_session_data(session.session_data)
            )
            await save()

        if not _ended(session):
            await complete_text_chat_session(
                run_id=workflow_run_id,
                text_session=session,
                expected_revision=session.revision,
            )

        verdicts = await _judge(run, result, items, config)
        status = (
            "passed" if verdicts and all(v["passed"] for v in verdicts) else "failed"
        )
        await save(verdicts=verdicts, status=status, finished_at=_now())
    except Cancelled:
        await save(status="cancelled", finished_at=_now())
    except TestLLMError as exc:
        await save(status="error", error=str(exc), finished_at=_now())
    except Exception as exc:
        logger.exception(f"Agent test result {result.id} failed")
        await save(
            status="error",
            error=f"{type(exc).__name__}: {exc}"[:500],
            finished_at=_now(),
        )


async def _start_conversation(run, result):
    """Create a text-chat run on the agent's draft and play its opening turn."""
    workflow = await db_client.get_workflow(
        run.workflow_id, organization_id=run.organization_id
    )
    if workflow is None:
        raise RuntimeError("The agent no longer exists")
    inputs = await prepare_workflow_run_inputs(
        db_client,
        workflow,
        initial_context=merge_external_initial_context({}, {}),
        use_draft=True,
        include_template_context=True,
    )
    workflow_run = await db_client.create_workflow_run(
        name=f"TEST-{run.number}-{result.id}",
        workflow_id=run.workflow_id,
        mode=WorkflowRunMode.TEXTCHAT.value,
        user_id=run.created_by,
        initial_context=inputs.initial_context,
        organization_id=run.organization_id,
        definition_id=inputs.definition_id,
        use_draft=inputs.use_draft,
    )
    set_current_run_id(workflow_run.id)
    quota = await authorize_workflow_run_start(
        workflow_id=run.workflow_id,
        organization_id=run.organization_id,
        workflow_run_id=workflow_run.id,
    )
    if not quota.has_quota:
        raise TestLLMError(quota.error_message or "Quota exceeded")
    await db_client.update_workflow_run(
        workflow_run.id,
        annotations={
            "tester": {
                "source": "agent_tests",
                "modality": "text",
                "test_run_id": run.id,
                "test_result_id": result.id,
            }
        },
    )
    session = await db_client.ensure_workflow_run_text_session(
        workflow_run.id,
        session_data=default_text_chat_session_data(),
        checkpoint=default_text_chat_checkpoint(),
    )
    session = await initialize_text_chat_session(
        run_id=workflow_run.id, text_session=session
    )
    session = await execute_pending_text_chat_turn(
        workflow_id=run.workflow_id, run_id=workflow_run.id, text_session=session
    )
    return workflow_run.id, session


def _ended(session) -> bool:
    data = normalize_text_chat_session_data(session.session_data)
    return data.get("status") == "completed" or bool(session.workflow_run.is_completed)


async def _judge(run, result, items, config: TestLLMConfig) -> list[dict]:
    behaviors = result.behaviors or []
    if not behaviors:
        return []
    messages = prompts.judge_messages(result.scenario, behaviors, items)
    last_error = None
    for _ in range(2):
        reply = await chat(
            config,
            run.judge_model or config.judge_model,
            messages,
            max_tokens=1500,
            temperature=0,
            json_mode=True,
        )
        try:
            return prompts.parse_verdicts(
                parse_json(reply, prefer="verdicts"), behaviors
            )
        except ValueError as exc:
            last_error = exc
    raise TestLLMError(f"The judge didn't return valid JSON ({last_error})")
