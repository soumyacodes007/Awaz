# Logs API handoff

The backend now supplies the Calls, Chat, Sessions, Webhooks, and API tables and
the call drawer shown in the reference screenshots. These are authenticated,
selected-organization APIs under `/api/v1/logs`. Detail/mutation requests for
foreign-organization IDs return 404. Sensitive responses use
`Cache-Control: private, no-store`.

## Frontend integration
functions
Use the generated /types in `ui/src/client`. The existing runtime
configuration supplies authentication. The standalone contract is
`api/logs.openapi.json`; regenerate it with `python -m scripts.dump_logs_openapi`.

| Screen | Endpoint | Notes |
| --- | --- | --- |
| Calls table | `GET /calls` | Lightweight rows, total count, pagination, pinned version, phone numbers, completion reason, duration, recorded cost |
| Chat table | `GET /chats` | Same contract, forced text-chat channel |
| Agent filter options | `GET /workflows?search=...&limit=50` | Organization-scoped workflow names/IDs |
| Export | `GET /calls/export` | CSV using the table filters; at most 100,000 rows |
| Drawer header | `GET /calls/{run_id}` | Summary, contexts, timing origin, artifact references, availability |
| Transcript | `GET /calls/{run_id}/transcript` | Final speaker messages with stable event IDs and seek offsets when recorded |
| Logs | `GET /calls/{run_id}/events?source=realtime` | `source=diagnostics` gives native call events |
| Messages | `GET /calls/{run_id}/messages` | Actual captured model/tool spans, with parent IDs, input/output attributes and timings |
| Analysis | `GET /calls/{run_id}/analysis` | Existing QA/LLM-judge results, including skipped/failed evaluators |
| Structured outputs | `GET /calls/{run_id}/structured-outputs` | Extracted variables and custom JSON fields returned by each judge |
| Cost | `GET /calls/{run_id}/cost` | Recorded billing totals and provider usage; unavailable amounts are null |
| Latency summary | `GET /calls/{run_id}/latency` | Native stage breakdowns or legacy TTFB metrics, averages and per-turn values |
| Waveforms | `GET /calls/{run_id}/waveform/{track}` | `track=mixed,user,bot`; up to 2,000 normalized peaks |
| Audio/transcript URL | `GET /calls/{run_id}/artifacts/{track}/url` | JSON with signed URL and 300-second lifetime; `track` also supports `transcript` |
| Artifact download | `GET /calls/{run_id}/artifacts/{track}` | Authenticated 307 redirect to signed object URL |
| Feedback | `GET`, `PUT /calls/{run_id}/feedback` | Per-user upsert for whole call or a transcript message |
| Sessions | `GET /sessions`, `GET /sessions/{run_id}` | Existing text-session metadata, revision, workflow and pinned version |
| Webhooks | `GET /webhooks`, `GET /webhooks/{delivery_id}` | Durable delivery status, attempts, last result, sanitized payload; no credential headers |
| API requests | `GET /api`, `GET /api/{log_id}` | HTTP metadata: request ID, route template, status, duration and timestamp |

All paths in the table are relative to `/api/v1/logs`.

### Table filters and pagination

`start_at` and `end_at` accept timezone-aware ISO 8601 timestamps. Start is
inclusive, end exclusive. Display timestamps in the viewer's timezone.

```text
/api/v1/logs/calls?start_at=2026-10-01T00:00:00Z&end_at=2026-11-01T00:00:00Z&workflow_ids=12&workflow_ids=15&channels=web&limit=25
```

Calls/Chat also support `definition_ids`, `directions`, `ended_reasons`, `run_id`,
`provider_call_id`, `customer_number`, `assistant_number`, `completed`,
`min_duration`, `max_duration`, `sort_by=created_at|duration`, and
`sort_order=asc|desc`. List filters use repeated query keys. Phone searches are
literal substring matches; `%` and `_` are escaped. Use at least three characters
for selective trigram searches. The call ID is Dograh's integer run ID; a
telephony provider ID is a separate string. Versions are the run's pinned workflow
definition, rather than the workflow's current version.

Numbered pagination is `page=1&limit=25` (limit at most 100). For continuous
scrolling, send the returned `next_cursor` with the same filters/sort and `page=1`.
A cursor fixes the creation-time and ID upper bounds and uses an ID tie breaker.
It excludes newly inserted calls; updates to an existing call's duration/status
can still change membership/order. Reset pagination on refresh or filter changes.
Exact counts can be expensive for broad searches on very large installations;
default to a bounded date range. The 10,000-row index check is not a production
load-test SLA.

Operational tables use `start_at`, `end_at`, `run_id`, `status`, `page`, and
`limit`. Session status is `initialized|running|completed`; webhook status is
`pending|succeeded|dead_letter`. API status is an HTTP code (100–599); API logs
do not accept `run_id`. IDs are validated against PostgreSQL integer bounds.

Export accepts filters without `cursor` or a page other than 1. It streams
100-row keyset batches in newest-first order, releases each DB transaction before
network delivery, and neutralizes spreadsheet formula prefixes. A result over
100,000 rows returns 422 before CSV headers; narrow the date range and retry.

### Drawer loading and audio

Load the header and active tab first, then fetch other tabs when selected. Table
queries do not load entire event/annotation JSON documents. Event, transcript,
and message endpoints use `offset=0&limit=100` (limit at most 500), returning
`available`, `truncated`, `total_count`, and `has_more`.

For `<audio>`, fetch the JSON artifact URL through the authenticated SDK, then
assign `url` to the audio element. Fetch a fresh URL when expired. Waveforms are
computed during successful artifact upload and read from metadata; opening a
drawer does not download/decode the whole recording on the backend. Mixed, user,
and bot tracks are available only when the call recorded/uploaded them. Respect
`ENABLE_CALL_RECORDING_UPLOAD` and each artifact's availability. Configure object
storage CORS for frontend-origin fetches if the UI accesses bytes directly.

Transcript offsets come from speech timestamps relative to a persisted recording
start, not from event arrival times. Only enable seek for messages whose
`start_seconds` is non-null. Text chat has no audio timeline. Historical calls
without a recording origin/waveform remain readable and report missing timing
and waveform data explicitly; there is no automatic backfill.

Feedback body:

```json
{"event_id":"rtf:12","rating":"negative","note":"Interrupted the caller"}
```

`event_id` defaults to `call`; use the transcript's returned ID for a message.
Ratings are `positive|negative`, notes at most 2,000 characters. Message feedback
is accepted only after completion so transcript indices are stable. Whole-call
feedback is allowed while running. Repeated writes update that user's existing
rating rather than duplicating it.

### Evaluation and cost states

Analysis `status` is `available`, `pending`, `failed`, `not_configured`, or
`unavailable`. New completions mark analysis queued; the worker records running,
completed or failed processing. `available` means evaluator records exist; inspect
each evaluator's status for completed, skipped or failed results. Poll only while
pending, with backoff. Existing QA nodes already support custom prompts and LLM
judges. Custom parsed JSON outputs are now retained and surfaced alongside
standard score, sentiment, summary and tags. Outputs are grouped by evaluator
and conversation node, including whole-call evaluation.

Cost states are `available|partial|unavailable`. Dograh reads recorded totals and
token/character usage. MPS owns canonical accounting and may currently return
only a metering acknowledgment. Per-provider dollar amounts are consequently
null when absent; the UI must show an unavailable value rather than zero. Exact
provider/call cost breakdown requires a canonical per-run ledger endpoint from
MPS and a subsequent integration. No guessed prices are applied.

## Capture and privacy

New voice calls save native diagnostic events even when external export is
disabled. Voice and text-chat model spans are captured locally when emitted by
the model's tracing integration; external Langfuse credentials are unnecessary
for local capture. Post-call judge spans are appended to the same run. Historical
records without saved capture report unavailability; a capture with no model
spans returns an empty list. Voice transcripts, diagnostics and messages become
readable through these APIs when completion persists them. Text-chat messages
are persisted after each turn. Live runtime streaming remains on the existing
WebSocket surface.

Capture is bounded: realtime feedback 20,000 events/8 MiB per call; diagnostic
events 20,000/4 MiB; model spans 1,000/4 MiB per run with a 32 MiB process budget
and stale-buffer expiration. Dropped capture is reported by `truncated`. Credentials
are redacted in nested structured values and serialized JSON, bearer tokens,
and sensitive URL query keys. This is credential redaction, not a PII scrubber;
authorized users still receive conversation content.

API metadata capture is asynchronous and best effort: authenticated HTTP routes
that resolve an organization are recorded, excluding the Logs viewer itself.
Request/response bodies, headers, raw query parameters, public callbacks and
WebSocket traffic are not recorded. The 1,000-entry process queue drops metadata
under overload and logs the drop count. DB timeouts/failures do not fail the
original request. Rows older than 30 days are pruned hourly in bounded batches
when traffic is being recorded. This is operational observability, not a durable
audit journal. Existing webhook records retain their own lifecycle.

## Deployment

1. Install the updated backend requirements. Google SDK/auth pins match the
   Gemini Live interaction-status contract verified by the regression suite.
2. Run `alembic -c api/alembic.ini upgrade head` with the deployment environment.
   Revision `64d2c0879a10` creates feedback/API-log tables and uses concurrent
   indexes for existing call data. PostgreSQL must allow installation of
   `pg_trgm`; a database administrator can provision that extension first.
   Concurrent index operations commit outside one transaction: if deployment is
   interrupted, inspect/repair partially created objects before retrying.
3. Restart API and ARQ workers so the runtime writes native traces, waveforms and
   evaluation states. New capture is not added to old records automatically.
4. For MinIO, `MINIO_PUBLIC_ENDPOINT` must be the browser-visible HTTP(S) origin,
   including its port, with no path/query/credentials. Startup creates the bucket
   if needed and removes the old anonymous bucket policy, failing startup if
   privacy cannot be enforced. The configured service identity therefore needs
   bucket-policy permission. Old unsigned object links stop working; authenticated
   artifact endpoints generate new signed links. Preserve the browser's exact
   `Host` header through the proxy; the remote nginx template now uses
   `$http_host` for MinIO. Changing the signed URL's hostname/port invalidates it.
5. For AWS S3, keep the bucket private and provision normal object permissions;
   this change does not rewrite S3 bucket policies.
6. Check a real call after rollout: all recorded tracks play/seek through the
   public proxy, expired/unsigned URLs fail, foreign-org IDs return 404, and QA
   reaches a terminal status. Actual production object storage and reverse-proxy
   playback have not been exercised in this local environment.

## Verification

Tests run against a dedicated PostgreSQL test database with `api/.env.test`, not
the development database. Logs tests cover tenant isolation for every drawer
section and operational tab, filter bounds, cursor ties and null durations,
malformed historical billing values, bounded streaming exports, feedback,
redaction, capture limits, worker states, storage outages and real SDK signatures.
The migration test creates its own disposable database, upgrades, validates
indexes, tests the planner on 10,000 runs, downgrades, re-upgrades and cleans up.
The generated frontend client passes `tsc --noEmit`.

Full backend regression suite: **3,793 passed, 38 skipped** (Python 3.13.12,
PostgreSQL 16, repository Pipecat source). The 117 warnings include SDK/API
deprecations and existing test fixtures with short signing keys/unawaited mocks.
Final focused Logs/capture/migration/MinIO suite: **74 passed**, including the
CSV/redirect OpenAPI contracts and the last historical-data/startup edge cases.
Backend lint/import checks, dependency compatibility checks and
the generated-client TypeScript check passed. No production deployment or live
object-store playback is implied by these local results.

Reproduce with the repository test dependencies installed:

```bash
set -a && source api/.env.test && set +a
python -m pytest api/tests
python -m pytest api/tests/test_logs_api.py api/tests/test_logs_capture.py api/tests/test_logs_migration.py api/tests/test_minio_private_artifacts.py
```

The migration round-trip test needs a dedicated PostgreSQL test identity with
permission to create/drop its disposable test database and install extensions.

## Remaining backend work outside Logs

These APIs support building the referenced Logs UX. They do not introduce a
simulation engine, test-suite CRUD/execution, version-comparison runs, standalone
reusable evaluator management, or bulk historical re-evaluation. Those require
their own backend/job/storage contracts. Existing workflow QA nodes provide the
custom LLM-judge capability surfaced here. Detailed dollar-cost parity still
depends on MPS's canonical run ledger.
