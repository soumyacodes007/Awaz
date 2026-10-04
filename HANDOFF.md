# Awaz handoff

Everything decided and built so far, why, and what comes next. Read this before
touching `web/` or the backend patches.

Last updated: 4 Oct 2026. Branch: `dev`.

---

## 1. What Awaz is

Awaz is an open source voice-agent platform for India (Hindi, English, Hinglish
and regional languages), built on a fork of [Dograh](https://github.com/dograh-hq/dograh).
It is a resume project aimed at **product engineer** and **AI engineer** roles,
so it optimises for:

- a polished, Vapi-quality product surface (frontend, UX, onboarding, dashboard)
- one hard engineering story: **latency** (real-world voice agents sit around
  2 seconds; see `VOICE_AGENT_LATENCY_RESEARCH.md`)
- platform depth over a single vertical: a general agent platform with CRM,
  tracing and evals, not "an AI receptionist for clinics"

The name was chosen knowingly even though awaz.ai exists; it is a portfolio
project, so the clash does not matter.

## 2. Strategy decisions

| Decision | Why |
|---|---|
| Build on Dograh, not from scratch or on LiveKit | Dograh already has telephony (Vobiz, Exotel, Plivo, Twilio, SIP), campaigns, tools, knowledge base and a FastAPI backend on Pipecat. Pipecat handles phone and WebSocket transports directly; LiveKit's room model adds a SIP bridge for phone calls. |
| Fork with full git history | Keeps upstream merges possible (`upstream` remote) and shows the work clearly on top of Dograh. |
| New frontend in `web/`; old `ui/` deleted (2026-10-05) | Everything moved to `web/`. The source is gone; format/pre-commit/worktree scripts and the CI lint-drift and image-build workflows now point at `web/`. The upstream `ui` compose service is parked behind the `legacy-ui` profile. Still referencing `ui/`: `scripts/setup_remote.sh`, `setup_fork.sh`, `worktree-sync-env.sh` and nginx's remote template (remote deploys need a `web/` image first). |
| Own backend features go in new modules under `api/services/` | Tracing, evals and CRM connectors later, kept separate from Dograh code to ease upstream merges. |
| Replace Pipecat pieces gradually | Later phase: swap parts of the pipeline for our own engine, one at a time, guided by a `PROBLEMS.md` log of real issues hit while building. |
| **No workflow canvas; agents are single prompts** | See section 6. Vapi retired its visual Workflows in favour of Assistants and Squads because LLMs don't reliably track which node they are in. |
| Squads (multi-agent handoff) deferred to v2 | Dograh already has a `transfer_agent` tool type that maps to it. |

## 3. Repo and branches

- Repo: `C:\Users\soumy\Desktop\voice-agent\dograh`
- `origin` = https://github.com/soumyacodes007/Awaz.git, `upstream` = dograh-hq/dograh
- `main` = pristine Dograh history; all work happens on **`dev`**
- `librnnoise.so` symlinks are marked skip-worktree (Windows checkout noise)

Commits on `dev`:

1. `feat(api)`: latency and local-dev patches on top of Dograh 1.48
2. `chore`: local WSL run setup and latency research notes
3. `chore`: keep shell scripts LF so they run in WSL (`.gitattributes`)
4. `feat(web)`: Awaz landing page
5. `feat(web)`: auth, onboarding and the agents-only dashboard (this handoff)

## 4. Running it locally

**Backend (Dograh in Docker inside WSL Ubuntu, not Docker Desktop):**

```bash
wsl -u root -e bash -lc "systemctl stop redis-server postgresql"
wsl -e bash -lc "cd /mnt/c/Users/soumy/Desktop/voice-agent/dograh && ./restart-dograh.sh"
```

- API on `:8000`, MinIO on `:9000`. The frontend is `web/` on `:3000` (below).
- The api runs **`awaz-api:local`**: the published image plus `api/requirements.txt`
  installed with `--no-deps` (`deploy/local/api.Dockerfile`). The restart script
  rebuilds it (cached). `--no-deps` matters: resolving deps lets `tuner-pipecat-sdk`
  pull `pipecat-ai` from PyPI over Dograh's forked Pipecat and the api won't start.
- Ubuntu's native Postgres and Redis grab 5432/6379 and come back on every WSL
  boot. Preference: **stop them**, don't remap Dograh's ports.
- **WSL shuts its VM down when no WSL session is open**, which stops every
  container. Keep a WSL terminal open, or run the script in a session that stays
  alive (`./restart-dograh.sh; exec sleep infinity`).
- `restart-dograh.sh` warns "mirrored networking did NOT take effect"; that is a
  false alarm (it checks for eth0). Verify with `wslinfo --networking-mode`.
- From Windows use `127.0.0.1`, not `localhost`: `localhost` resolves to `::1`,
  which WSL doesn't answer.

**Frontend:**

```bash
cd web
npm install
npm run dev -- -p 3000
```

- `web/.env.example` documents `BACKEND_URL` (default `http://127.0.0.1:8000`).
- Regenerate the typed API client after backend changes: `npm run generate-client`
  (reads `/api/v1/openapi.json`, writes `src/client/`).
- A local test account lives in `web/.env.local` (gitignored):
  `AWAZ_DEV_EMAIL` / `AWAZ_DEV_PASSWORD`. It belongs to the local dev database only.

## 5. Backend patches (commit 1)

- `api/services/pipecat/service_factory.py`: OpenRouter `extra_body` merges both
  `provider.order` and `reasoning: {enabled: false}` (the latter for `qwen/` models,
  to cut thinking latency).
- `api/services/configuration/registry.py`: provider `api_key` fields default from
  env vars. This is why **Sarvam and OpenRouter work with no key in the UI**
  (`SARVAM_API_KEY`, `OPENROUTER_API_KEY` are in `.env`). The model schemas show
  these providers as not requiring a key.
- `api/utils/tunnel.py`: caching.
- `docker-compose.override.yaml` mounts `tunnel.py` and `registry.py` into the
  published image.

## 6. The big product decision: agents, not workflows

Dograh stores every agent as a graph (`workflows` row + versioned
`workflow_definitions` with `{nodes, edges}`). At runtime the engine walks the
graph: each node's prompt becomes the system prompt, and each edge becomes a
"transition tool" the LLM calls to move on. That is exactly the pattern Vapi
deprecated (Workflows retired 19 Aug 2026).

Awaz hides the graph completely:

- An **agent = one `startCall` node** (Dograh's own tests confirm a start-only
  workflow is valid). The node holds the prompt, greeting, interrupt setting,
  `tool_uuids`, `document_uuids` and extraction variables.
- Ending and transferring calls are **tools** (`end_call`, `transfer_call`), not
  nodes. New agents get a shared "End call" tool attached automatically.
- Non-conversation nodes become **settings**: `trigger` (API trigger, Advanced
  tab), `webhook` (post-call webhooks, Advanced tab), `qa` (quality review,
  Analysis tab). They are kept in the definition untouched.
- **Old multi-step agents** show a banner with "Convert to single prompt", which
  merges every step's prompt into sections of one prompt and unions the tools
  and documents. Saved as a draft; the published version keeps working.
- All of this lives in the backend **Agents API** (`/api/v1/agents`):
  `api/schemas/agent.py` (the flat `AgentSpec`), `api/services/agents/spec.py`
  (pure graph ↔ spec conversion, unit-tested) and `api/routes/agents.py`, which
  delegates to the workflow routes so Dograh's validation, masking, versioning and
  trigger registration still run. The frontend never sees nodes or edges.
- `PUT` on a multi-step agent returns 409; `POST /agents/{id}/convert` flattens it.
- The engine is unchanged on purpose. For a one-node agent it registers no
  transition tools and never runs context summarization (both need edges), so a
  dedicated single-prompt engine would duplicate ~90% of `pipecat_engine.py`
  (greetings, answer supervision, transfers, realtime, dispositions, extraction)
  for no runtime gain. Revisit only as part of replacing Pipecat pieces.

## 7. `web/` architecture

Stack: Next.js 15.5 (App Router, Turbopack), React 19, Tailwind v4,
lucide-react, `motion`, `lenis` (landing only), `@hey-api/openapi-ts` client.

**Auth and API access**

- `POST /api/v1/auth/login|signup` via server actions in `src/app/(auth)/actions.ts`.
  The JWT goes into an **httpOnly cookie `awaz_session`** (30 days).
- `src/middleware.ts` proxies `/api/v1/*` to the backend and attaches
  `Authorization: Bearer` from the cookie, so browser code calls same-origin
  `/api/v1/...` and never sees the token. It also redirects signed-out users away
  from app paths. **Keep its `matcher` in sync with `APP_PREFIXES` in
  `src/lib/session.ts`.**
- Server components call the generated client with `authHeaders()` from
  `src/lib/server-api.ts`; a 401 sends the user to `/logout`.

**Route groups**

- `(marketing)`: landing page
- `(auth)`: login, signup
- `(app)/onboarding`: three-step onboarding
- `(app)/(shell)`: the dashboard (sidebar layout); new accounts that haven't
  finished or skipped onboarding are redirected there first

**Shared code**

| Path | What |
|---|---|
| `lib/agent.ts` | Graph ↔ agent conversion, side nodes, legacy flattening |
| `lib/agent-client.ts` | Create agent + ensure the shared End call tool |
| `lib/agent-templates.ts` | Starter prompts (receptionist, lead qualifier, payment reminder, support) |
| `lib/models.ts` | Model config v2 types, provider/language names, effective config |
| `lib/estimates.ts` | Model presets and cost/latency estimates |
| `lib/latency.ts` | Parses `run.logs.realtime_feedback_events` into per-stage TTFB, transcript |
| `lib/runs.ts` | Run filters (Dograh's JSON filter format), channel labels |
| `lib/tools.ts` | Tool kinds and blank tool defaults |
| `components/app/ui.tsx` | Server-safe UI kit: `btn()`, `inputCls`, `Card`, `Badge`, `Table`, `Stat`… |
| `components/app/client.tsx` | `Modal`, `Dropdown`, `Switch`, `Tabs`, `CopyButton` |
| `components/app/SchemaFields.tsx` | Renders any provider's settings from the backend's JSON schema |

## 8. Landing page (commit 4)

Design brief: Sarvam's hero and footer, ElevenLabs India's sections, our own
copy and design system.

- Order: Hero, PlatformShowcase, VoiceLibrary, ApiSection, Industries, Enablers,
  SelfHosted, Footer (`web/src/app/(marketing)/page.tsx`).
- Fonts: **Geist** for display (weight 525), **Figtree** for body.
- Hero headline "India's open source voice AI" (no hyphen); three text tiers.
- Navbar is absolute, **not pinned** (pinning was tried and rejected).
- PlatformShowcase: black 16:9 frame with a `YOUTUBE_ID` slot (video pending).
- ApiSection: four real endpoints auto-cycling every 4s, Python/JS/cURL tabs,
  corner-bloom SVGs.
- Industries and Enablers follow ElevenLabs India's layouts; SelfHosted is the
  security-style accordion with crossfading wireframe SVGs.
- Footer: Sarvam layout, light mint wash, big black "Awaz" wordmark with letter
  reveal and cursor spotlight.
- Smooth scroll via Lenis; reduced-motion respected.
- **Rejected, do not bring back:** ornaments (wave, lotus, diya, torana), the BSD
  chip, the "open-source" hyphen, a dark footer, a pinned navbar, the pillars
  section, em dashes in copy, Instrument Sans.

## 9. Dashboard

### Design system

The user asked for **Vapi's layout one-to-one, inverted to light, with a sharp
shadcn look** and the serious SaaS fonts shadcn uses.

- Fonts: **Geist + Geist Mono** for the whole dashboard via the `.font-app` class
  on the shell (Figtree stays landing-only).
- Colors: shadcn zinc tokens in `globals.css` (`bg-background`, `border`,
  `muted`, `muted-foreground`, black `primary`, `sidebar`). Bare `border`
  utilities inside `.font-app` pick up the token color.
- Shape: `rounded-md` controls, `rounded-lg` cards, 1px borders, `shadow-xs`,
  `text-sm` density. Status colors use Tailwind emerald/amber/red.
- Use the kit in `components/app/ui.tsx`; avoid hand-picked hex colors and soft
  `rounded-2xl` cards. `inputCls` includes `w-full`; use `inputBase` for controls
  that size themselves.

### Sidebar (Vapi's structure)

Workspace row, Search (⌘K jump-to-page menu), then:

- **Home**
- **Build:** Agents, Tools, Phone numbers, Campaigns, Resources (Knowledge base, Audio clips)
- **Test:** Evals, Simulations (placeholders marked "Soon")
- **Observe:** Logs, Recordings, Metrics, Agent runs
- **Integrations:** API keys, Integrations
- **Manage:** Billing & usage, Workspace settings, Profile

### Pages and what backs them

| Page | Built | Backend |
|---|---|---|
| Home | Stats, recent calls, agents, getting-started checklist from real state | usage, runs, workflows, telephony, api-keys |
| Agents | List + editor (see below) | `/agents/*`, text-chat, telephony initiate-call |
| Tools | List, create/edit End call, Transfer, API request (with live test), MCP (with tool discovery), Calculator | `/tools/*` |
| Phone numbers | Providers from metadata-driven forms, numbers, inbound agent per number, default caller ID, provider page with setup checklist, SIP endpoints, trunks | `/organizations/telephony-configs/*` |
| Campaigns | List, create (CSV via presigned upload, retries, calling hours), detail with progress, start/pause/resume, redial, report, activity | `/campaign/*`, `/s3/presigned-upload-url` |
| Knowledge base | Upload, processing status, "try a question" search | `/knowledge-base/*` |
| Audio clips | Upload with auto-transcription, play, delete | `/workflow-recordings/*` |
| Logs | Vapi-style call logs, drawer with transcript/recording/analysis/cost/latency, API/webhook/session logs | `/logs/*` |
| Recordings | Calls with audio, lazy signed-URL playback | usage runs, `/s3/signed-url` |
| Metrics | Vapi layout: minutes/calls/spend/cost-per-call KPIs with trend lines; end reasons, cost breakdown and success donuts; duration by agent; unsuccessful calls; peak concurrency; measured latency. 24h/7d/30d/90d, grouped by hour/day/week | `/metrics`, per-agent runs |
| Agent runs | Filterable table → call page with recording, per-turn latency trace, transcript, structured outputs, QA, call data | usage runs, run detail |
| API keys | Create (shown once), revoke/restore, quick start | `/user/api-keys` |
| Integrations | Model providers (schema-driven), Credentials, Langfuse, BigQuery call events, MCP; CRM and WhatsApp marked "Soon" | model config v2, credentials, langfuse, preferences |
| Billing & usage | Period usage, Dograh model credits + ledger + buy credits, daily breakdown | usage, billing credits |
| Settings / Profile | Timezone, test number, outcome mapping / account info, sign out | preferences, `/auth/me` |

### Agent editor (Vapi one-to-one)

- **List pane:** count, "Create agent" split button (chevron = templates),
  search, rows with name, provider line ("Sarvam · OpenRouter · Sarvam") and a
  version badge (amber when there are unpublished changes). Collapsible from
  the editor's panel button.
- **Header:** version menu ("Draft v3 ⌄", restore any older version as the draft),
  short agent ID with copy, save status; **Talk** split (chat in browser, or call
  my phone), **Publish** split, ⋮ (duplicate, archive).
- **Tabs:** Agent, Logs, Tools, Analysis, Advanced.
- **Autosave:** every change is written to Dograh's draft version after ~0.9s;
  Publish promotes it. Ctrl+S saves now.
- **Agent tab:**
  - Cost and latency card. Latency is **measured** from the agent's last 25
    calls (median time-to-first-byte per stage); before that it shows typical
    numbers marked "est.". Cost is always an estimate from list prices.
  - **Model presets:** Workspace default, Balanced, High Intelligence, Ultra
    Fast, Cost Saver, Hindi First. Built on Sarvam + OpenRouter because this
    deployment has those keys in env. A preset writes the agent's
    `model_configuration_v2_override`; the backend validates keys on save.
  - Transcriber / Model / Voice cards; the edit button opens the model dialog
    (Dograh-managed: language, voice, speed; BYOK: provider + schema fields).
  - System prompt editor: Visual (rendered) / Code (edit), full screen, find,
    undo/redo, headings, bold, italic, lists, insert `{{variable}}`.
  - First message (spoken text or audio clip) and "caller can interrupt".
- **Tools tab:** attach tools and knowledge documents (warns when there's no End call tool).
- **Analysis tab:** structured outputs (extraction), call outcomes (dispositions), QA review.
- **Advanced tab:** call limits, turn-taking, context compaction, TTS cache,
  delayed start, pronunciation dictionary, API trigger (URL + curl), webhooks, archive.
- **Test panel:** text chat with the draft (real Dograh text-chat sessions,
  ended on close) or a phone call through a connected provider.

### Onboarding

Three steps (business, languages, call type + description). It now builds a
single-prompt agent locally from the answers and a matching template, instead of
calling Dograh's hosted workflow generator (MPS), then opens the agent.

## 10. Verified vs not verified

**Verified in the browser or against the API:** signup → onboarding → agent;
autosave and publish; test chat (including a Hinglish reply on the Balanced
preset via OpenRouter gpt-4.1-mini); converting a multi-step agent; API trigger
URL generation; per-agent model override; every dashboard route returns 200;
mobile width of the agent editor.

**Not verified yet:** real phone calls (no telephony configured), a campaign
running end to end, browser uploads to MinIO (CORS), Metrics/Recordings/latency
views with real voice calls.

## 11. Open questions and next steps

1. ~~Delete the old `ui/`~~ Done; see section 2 for what still references it.
2. **Delete `web/public/landing/*-preview.html`** (design previews)? Asked, not answered.
3. In-browser **voice** test call (WebRTC; the old UI has a Pipecat client hook to port).
4. Vapi's **Composer** and prompt **Generate** buttons need an LLM writing assistant; not built.
5. **Evals and Simulations** (placeholders now) and own backend modules for
   tracing, evals and CRM connectors (HubSpot, Zoho, Salesforce, LeadSquared, WhatsApp).
6. **Squads** (multi-agent handoff) in v2 using `transfer_agent`.
7. **Latency work**, the headline: start a `PROBLEMS.md` log, then replace Pipecat
   pieces one at a time. Per-stage TTFB is already captured and shown, which is the baseline.
8. Landing: voice samples for VoiceLibrary, the YouTube ID for PlatformShowcase,
   and a README credit line ("Landing page design inspired by Sarvam and ElevenLabs").
9. ~~Tests for the agent conversion~~ Done: `api/tests/test_agent_spec.py`.
10. Metrics cost is **estimated** (self-hosted Dograh records no charges):
    LLM tokens × per-model prices, STT/TTS/telephony per call minute, in
    `api/services/metrics/pricing.py` (same numbers as `web/src/lib/estimates.ts`).
    Keep the two tables in sync.

## 12. Gotchas we hit

- Newer Chrome returns a Promise from `scrollIntoView`; never write
  `useEffect(() => el.scrollIntoView(...))` (React treats it as a bad cleanup). Use braces.
- Server pages can't call functions exported from `"use client"` files; shared
  helpers go in `lib/` (e.g. `blankTool` in `lib/tools.ts`).
- The API trigger path is generated by the backend on save; the editor adopts it
  without marking the draft dirty.
- `PUT /workflow/{id}` replaces `workflow_configurations` wholesale, so the editor
  always sends the full config object when it changes.
- Model override keys come back masked; sending the masked value back is fine
  (the backend resolves it), but switching to a provider the workspace doesn't
  have needs a real key.
- On Windows, PowerShell `Set-Content -Encoding utf8` writes a BOM; don't use it for JSON.
- Tailwind v4 + next/font: font variables must sit on `<html>` and the theme must
  use `@theme inline`, or everything silently falls back to the system font.
- Arc UI charts (`web/src/components/arc/`) are vendored from uiarc.dev. Their
  tokens are scoped to `.arc` in `foundation.css` (the stock file sets `:root`
  vars that clash with ours and removes focus outlines). Two local patches are
  marked `// Awaz:`: the line chart no longer floors the y-axis at 1, and the bar
  chart keeps one decimal in its average.
