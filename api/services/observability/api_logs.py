"""Bounded asynchronous HTTP metadata capture. Bodies and headers are excluded."""

import asyncio
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from loguru import logger

from api.db import db_client


class APIRequestLogWriter:
    def __init__(self, max_pending=1000):
        self.queue = asyncio.Queue(maxsize=max_pending)
        self.worker = None
        self.dropped = 0
        self._last_warning = 0

    def start(self):
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._consume())

    def submit(self, metadata):
        if self.worker is None or self.worker.done():
            return
        try:
            self.queue.put_nowait(metadata)
        except asyncio.QueueFull:
            self.dropped += 1
            if time.monotonic() - self._last_warning > 60:
                logger.warning(
                    "API metadata queue full; dropped {} requests", self.dropped
                )
                self._last_warning = time.monotonic()

    async def _consume(self):
        last_prune = 0
        while True:
            metadata = await self.queue.get()
            try:
                async with asyncio.timeout(3):
                    await db_client.record_api_request(**metadata)
                if time.monotonic() - last_prune > 3600:
                    last_prune = time.monotonic()
                    async with asyncio.timeout(3):
                        before = datetime.now(UTC) - timedelta(days=30)
                        for _ in range(100):
                            if await db_client.prune_api_request_logs(before) < 1000:
                                break
            except Exception as exc:
                logger.warning(
                    "API metadata persistence failed ({})", type(exc).__name__
                )
            finally:
                self.queue.task_done()

    async def shutdown(self):
        if self.worker is None:
            return
        try:
            async with asyncio.timeout(5):
                await self.queue.join()
        except TimeoutError:
            logger.warning("API metadata shutdown drain timed out")
        self.worker.cancel()
        await asyncio.gather(self.worker, return_exceptions=True)
        self.worker = None


writer = APIRequestLogWriter()


class APIRequestLogMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/v1/"):
            return await self.app(scope, receive, send)
        started = time.perf_counter()
        request_id = str(uuid4())
        status = 500
        scope.setdefault("state", {})["request_id"] = request_id

        async def capture_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = [
                    *message.get("headers", []),
                    (b"x-request-id", request_id.encode()),
                ]
                if scope.get("path", "").startswith("/api/v1/logs"):
                    headers = [
                        (key, value)
                        for key, value in headers
                        if key.lower() != b"cache-control"
                    ]
                    headers.append((b"cache-control", b"private, no-store"))
                message = {
                    **message,
                    "headers": headers,
                }
            await send(message)

        try:
            await self.app(scope, receive, capture_send)
        finally:
            org_id = scope.get("state", {}).get("organization_id")
            route = scope.get("route")
            path = getattr(route, "path", None)
            if org_id and path and not path.startswith("/api/v1/logs"):
                writer.submit(
                    {
                        "organization_id": org_id,
                        "request_id": request_id,
                        "method": scope["method"],
                        "path": path[:500],
                        "status_code": status,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                        "query": {},
                        "created_at": datetime.now(UTC),
                    }
                )
