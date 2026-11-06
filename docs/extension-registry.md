# Public Extension Registry

The Virtual Inbox extension host publishes one public, read-only inventory at **`GET /api/extensions`** on the main HTTP(S) listener. The route is described in the generated management OpenAPI contract. This is observation only, not a plugin installation or authorization API.

## State and response

Each record supplies a stable `id`, `displayName`, `version`, `state` (`active`, `failed`, `disabled`), `capabilities`, routes, and per-extension request metrics. For active routes, `method`, `audience`, logical `path`, and `publicPaths` identify where callers can reach the handler. The `demo` audience appears as `/demo/<path>` on the main listener and as `/<path>` on the dedicated demo listener; `management` appears under `/api/<path>`. Physical port and TLS bindings remain discoverable through the existing `GET /api/connection-info`.

The bundled `sms-native` is **active by default**. `VI_SMS_NATIVE_ENABLED=false` declares it `disabled`, with no published routes; public SMS ingestion `POST /api/sms/ingestions` continues working. An optional ESM file that cannot load or validate becomes a `failed-N` record carrying only the `EXTENSION_LOAD_FAILED` diagnostic code. File paths, stack traces, token values and provider request bodies are never returned from the registry. Failures are also reported in the local startup diagnostics.

The optional extension manifest can supply `displayName`, `capabilities` (a short string array) and `documentation` (a local relative path). It is validated before publishing the route group. Extension-specific OpenAPI files remain separate from the core OpenAPI. V1 does not include remote installation, UI plugins, management mutations, runtime hot reload, or a process sandbox.

## Request metrics and log events

The registry counts dispatched requests and failed responses (`status >= 400`), tracks `totalDurationMs`, and exposes the most recent status. Metrics are in-memory and reset on restart. Counted errors include handler exceptions (as HTTP 502) and asynchronous timeouts (504). They do not include unmatched requests rejected before extension dispatch. The Host's final-response observer writes structured `extension.request` events into the existing circular log with `extensionId`, `method`, `audience`, logical route template, status, duration and diagnostic correlation ID. The events contain **no request or response bodies and no headers**.

Use `GET /api/logs?extensionId=<id>` or the existing `/api/logs/events?extensionId=<id>` SSE stream to inspect these requests. Existing `log_id` ordering, bounded retention and missing-sequence behavior are unchanged. This filter is observation, not authorization.

The registry is an in-memory snapshot of the Extension Host. It reports only currently activated routes; a failed or disabled extension does not claim an active route. The read-only System → Extensions console renders these same public records (implemented in #103).

## Scope and limitations

The first runtime accepts only trusted local ESM modules and does not promise isolation, hot-unloading or background process supervision. Extension states are *startup-derived*, rather than a general dynamic lifecycle management API. The route registry does not yet provide arbitrary root-level physical bindings such as `/WebAPI` on the primary listener; these require an explicit host mount policy. No private core API is exposed to extensions.
