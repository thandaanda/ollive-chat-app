# Architecture Notes

## Ingestion Flow

1. The user adds a provider API key in Settings; the browser stores it in `localStorage`.
2. The browser can call `POST /api/providers/models` to fetch live model IDs through the server without persisting the key.
3. The browser posts a chat request to `POST /api/chat`, including the selected provider, model, and browser key when present.
4. The chat route persists the user message and a placeholder assistant message.
5. The internal inference SDK creates a `requestId`, emits a `started` event with a unique `eventId`, and sends it to `POST /api/ingest/inference`.
6. Vercel AI SDK `streamText` calls the selected provider and smooths text output before it becomes UI stream chunks.
7. The chat route forwards AI SDK UI message stream parts to the browser and persists final or partial assistant output.
8. The SDK emits `completed`, `failed`, or `cancelled` with a fresh `eventId`.
9. Ingestion stores the raw event and upserts the processed `InferenceLog` in one transaction. Duplicate `eventId` submissions are returned as deduped without reapplying the transition.

## Logging Strategy

Each inference request has a stable `requestId`; each ingestion event has a unique `eventId` for retry idempotency. Raw `InferenceEvent` rows preserve event history, while `InferenceLog` stores the latest query-friendly state for dashboards. Input/output previews are redacted before ingestion; full chat text is kept only in `ChatMessage` so users can resume conversations. Provider API keys entered in the UI are stored only in browser `localStorage`, sent only to same-origin provider proxy/chat APIs, and never written to logs or Postgres.

## Scaling Considerations

The demo uses synchronous HTTP ingestion into Postgres. For higher throughput, the same payload can be placed behind a queue or event bus, with workers performing validation, redaction verification, and aggregate rollups. Dashboard reads should move from recent-row scans to precomputed time buckets once volume grows.

## Failure Handling Assumptions

Provider failures are surfaced in the UI and logged as failed inference requests. Model-list failures return sanitized error messages to Settings. Client cancellation calls AI SDK `stop()`, aborts the provider stream where supported, and stores the partial response. Ingestion is retried once and then logged server-side so observability failures do not block chat. A late `started` event cannot regress a terminal aggregate log.
