# Ollive AI Inference Logging Demo

A lightweight fullstack LLM application with streaming chat, multi-provider adapters, SDK-style inference logging, a secured ingestion endpoint, PostgreSQL storage, and operational dashboards.

## What Is Included

- Next.js App Router UI for chat, shareable conversation URLs, conversation list/resume, response cancellation, and telemetry.
- AI SDK streaming adapters for OpenAI, Anthropic, and Gemini with smoothed UI message streams.
- Browser-only provider Settings panel for API keys and live model selection.
- SDK-style logging wrapper that emits `started`, `completed`, `failed`, and `cancelled` inference events.
- Secured ingestion API that validates payloads, stores raw events, and upserts processed inference logs.
- Prisma/PostgreSQL schema for conversations, chat messages, inference events, and aggregate logs.
- PII redaction for stored log previews.
- Docker Compose for app + Postgres.

## Setup

```bash
pnpm install
cp .env.example .env
```

Edit `.env`:

```bash
DATABASE_URL="postgresql://ollive:ollive@localhost:5432/ollive_ai"
APP_URL="http://localhost:3000"
INGESTION_API_KEY="dev-ingestion-token"
```

Provider API keys are normally added from the app Settings panel and stored only in browser `localStorage`. The server never persists those keys and does not include them in inference logs.

Optional server fallback env vars are still supported for local operators:

```bash
OPENAI_API_KEY="..."
OPENAI_MODELS="gpt-4.1-mini,gpt-4.1"
ANTHROPIC_API_KEY="..."
ANTHROPIC_MODELS="claude-3-5-sonnet-latest"
GEMINI_API_KEY="..."
GEMINI_MODELS="gemini-1.5-flash"
```

Browser-entered keys take precedence over server fallback keys for the active session. There is no normal mock provider fallback.

Start Postgres, then initialize the schema:

```bash
pnpm db:migrate
pnpm dev
```

`pnpm db:push` is still available as a quick local schema sync, but the checked-in Prisma migration is the preferred setup path for review and repeatability.

If you previously initialized this local database with `pnpm db:push`, baseline the existing schema once, then deploy the additive migration:

```bash
pnpm exec prisma migrate resolve --applied 20260522123000_init
pnpm db:deploy
```

Open [http://localhost:3000](http://localhost:3000).

### Docker Compose

```bash
docker compose up --build
```

This repository includes Compose setup for Postgres and the Next.js app. Docker is not installed in the local Codex environment used for this implementation, so Compose could not be verified here.

## Architecture

```mermaid
flowchart LR
  UI["Next.js UI + Settings"] --> ModelsAPI["POST /api/providers/models"]
  ModelsAPI --> ProviderModels["Provider model list APIs"]
  UI --> ChatAPI["POST /api/chat"]
  ChatAPI --> AISDK["Vercel AI SDK streamText + smoothStream"]
  AISDK --> Provider["OpenAI / Anthropic / Gemini"]
  Provider --> ChatAPI
  ChatAPI --> UI
  ChatAPI --> SDK["Inference Logger"]
  SDK --> Ingest["POST /api/ingest/inference"]
  Ingest --> Events["InferenceEvent raw table"]
  Ingest --> Logs["InferenceLog processed table"]
  ChatAPI --> Messages["Conversation + ChatMessage tables"]
  Metrics["GET /api/dashboard/metrics"] --> Logs
  UI --> Metrics
```

The Settings panel stores browser-entered API keys and fetched model IDs in `localStorage`. The key is sent only to same-origin app APIs for live model lookup or chat completion. The chat API creates or resumes a conversation, persists the user message, creates a streaming assistant message, then calls the configured AI SDK provider. The browser receives AI SDK UI message stream parts, including a `data-chat-meta` part for the persisted conversation and message IDs. Conversations are addressable at `/conversations/:id`; new chats started from `/` replace the URL once the conversation is created.

The internal SDK wrapper sends inference events to the ingestion endpoint in near real time. SDK-emitted events include a stable `requestId` and a unique `eventId`. Ingestion validates with `zod`, stores every raw event, then upserts a processed `InferenceLog` by `requestId` inside one transaction. Duplicate `eventId` submissions are idempotent and return the current aggregate log status.

## Schema Decisions

- `Conversation` owns durable chat sessions and supports list/resume.
- `ChatMessage` stores full message text so conversations can be resumed.
- `InferenceEvent` stores append-only raw ingestion events for auditability and replay. `eventId` is unique so ingestion retries do not duplicate raw events.
- `InferenceLog` stores one query-friendly processed row per inference request.
- `requestId` links assistant messages, raw events, and processed logs.

Full chat messages are stored for product behavior. Provider API keys entered in Settings are not stored in Postgres. Log previews are separately redacted for emails, phone numbers, credit-card-like strings, bearer tokens, and API-key-like values. A production system should add configurable retention and stronger organization-level data controls.

## Failure Handling

- Provider errors update the assistant message to `FAILED` and emit a `failed` inference event.
- Browser cancellation aborts the provider request where supported, stores partial output, and emits `cancelled`.
- Ingestion failures are retried once and then logged server-side; they do not break chat responses.
- Providers without a browser key or server fallback remain visible but cannot send chat requests until configured.
- Model lookup failures are shown in Settings with sanitized provider errors.

## Scaling Notes

- The current event-based ingestion path is HTTP + database, which is appropriate for a lightweight demo.
- At higher volume, the ingestion endpoint can publish raw events to Kafka, Redpanda, SQS, or NATS before async processing.
- Dashboard queries currently scan recent processed logs; production should add rollups for high-cardinality provider/model dimensions.
- Prisma writes are simple and transactional enough for this take-home. Heavy ingestion would benefit from batched writes and idempotency keys.
- Self-hosted Kubernetes is intentionally not included. A production deployment would add manifests or Helm, external Postgres, secrets management, HPA, readiness probes, and centralized logs.

## Verification

```bash
pnpm lint
pnpm test
pnpm build
```

Real database smoke test, when Postgres is available:

```bash
RUN_DB_TESTS=1 pnpm test:db
```

Optional browser smoke test:

```bash
pnpm test:e2e
```

The Playwright test verifies the UI shell. End-to-end provider streaming requires real API keys and a reachable Postgres database.

## Tradeoffs

- Chat completion uses Vercel AI SDK for provider streaming and UI stream parsing. Model lookup still uses direct provider HTTP APIs so users can fetch live model IDs with browser-entered keys.
- The ingestion endpoint is called over HTTP from the same app process to demonstrate the real boundary, even though a direct function call would be faster.
- Raw events and processed logs are both stored, trading extra writes for debuggability and replay.
- Browser `localStorage` keys are convenient for the demo and avoid server-side secret persistence, but production multi-user settings should use encrypted server-side secret storage or a managed vault.
- No mock provider is exposed in normal app behavior. Tests use mocks/pure functions where needed.
