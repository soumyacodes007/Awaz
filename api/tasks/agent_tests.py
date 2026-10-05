"""ARQ task: execute one agent test run (every conversation and verdict)."""

from loguru import logger

from api.services.agent_tests.runner import run_agent_test_run as _run


async def run_agent_test_run(ctx, run_id: int) -> None:
    logger.info(f"Running agent test run {run_id}")
    await _run(run_id)
