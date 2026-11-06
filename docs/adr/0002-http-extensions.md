# ADR-0002 — Embedded HTTP extensions with a public-API boundary

- **Status:** Accepted
- **Date:** 2026-11-06
- **Scope:** Virtual Inbox HTTP entry points, Extension Host, Extension Application SDK and extensions
- **Related:** #95, #96, #97, #98, #99, #100, #101, #102, #103, #104, #105; compatible with ADR-0001

## Context

Virtual Inbox is a memory-resident, openly observable **test sandbox**, not a multi-tenant production integration platform (ADR-0001). An application under test may depend on a provider-specific HTTP contract, for example the m-it! SMS provider, without that contract belonging in VI's core. The existing SMS demonstration endpoint provides a known first case with which to prove extensibility. Today the server owns the management HTTP(S), same-origin demo HTTP(S) and dedicated demo listeners; one operation is reachable as `POST /demo/sms/messages` on the main listener and `POST /sms/messages` on the demo listener.

Goals: preserve all existing consumer-facing behavior and ports; allow independently authored contracts and handlers; expose extension presence in the console; keep the **same stable functional public VI API** for every consumer, including extensions; keep implementation proportional to a trusted test environment.

## Decision

1. **The VI HTTP runtime owns entry points.** The existing listeners, TLS, Host/Origin/CORS checks, HTTP request lifecycle, route registration and routing, operational metrics and observability remain VI responsibilities. No new publicly exposed listener is required to install an extension. The SDK does not call `listen()`.
2. **V1 extensions run as trusted ESM modules in the VI Node.js process**, enabled by explicit local configuration or bundled by VI. The Extension Host loads them through supported module loading, performs manifest validation (protocol-version negotiation remains deferred), validates route declarations and registers routes atomically before activation. Installation from arbitrary URLs, remote catalogs and execution of untrusted code are **not** supported.
3. **The Extension Application SDK supplies application ergonomics**, broadly `createApp()`, `app.use()`, `app.get/post/put/delete()`, and async onion-style middleware `await next()`. Middleware may short-circuit, transform or replace a completed handler response before the HTTP runtime sends it. This is not Express compatibility; neither Node request/response objects nor arbitrary Express middleware are part of the extension contract.
4. **Only the public functional VI API is an integration boundary.** The existing `@virtual-inbox/client` (or ordinary HTTP) is used by extensions as by every other client. No privileged access to the Sandbox, store, event emitter, SMTP internals or private helper functions; in-process loading is not permission isolation, so this is an architectural convention with tests, not a security guarantee. The common public SMS ingestion operation is now `POST /api/sms/ingestions` (#100).
5. **Keep functional API, extension SDK and routing responsibilities distinct.** `@virtual-inbox/client` models VI functional operations; `@virtual-inbox/extension-sdk` models route handlers and middleware; the Extension Host owns registration and dispatch. A stable, JSON-compatible request/response model permits a later out-of-process dispatcher but does not require IPC now.
6. **An extension declares the routes and audiences it owns.** The Host must reject conflicts with core routes, other extensions, and reserved management/console namespaces. There is no general-purpose route override or middleware interception of core endpoints. The built-in SMS extension has received its existing endpoints through an **explicit, controlled ownership migration** (#101): it is the only runtime handler for the retained legacy core-catalogue operation, keeping old URLs/contracts; it is not a general route override.
7. **The native SMS sender is a bundled, enabled-by-default extension**, subject to #100 and #101. The core retains SMS inboxes, routing, captures, TTL, anomalies and diagnostics. The outgoing/demo HTTP contract migrates; the extension calls the same common public ingestion API as an ordinary client. Disabling the extension must not disable the core or other transports. Defaults must preserve existing installations.
8. **The implemented public registry/observability API is source of truth for console and automation** (#102). The console discovers installed/active/failed/disabled extensions, published routes and optional documentation, without provider-specific code or dynamically importing arbitrary UI.
9. **Fail predictably, not silently.** A route publication failure must register *none* of the extension's routes; an exception or rejected handler promise becomes a bounded, observable failure. Request body sizes, asynchronous deadlines, headers, response sizes and diagnostic fields are constrained and documented. Process crashes, `process.exit()`, global state mutation and blocking synchronous code remain risks of the embedded, trusted model. A timeout cannot preempt synchronous JavaScript.
10. **No provider semantics leak into VI.** Auth schemes, campaigns, per-provider errors, response formats and retry behavior belong to provider extensions. A response override after a successful public ingestion call does **not** undo the SMS capture; logs and documentation must distinguish provider response simulation from delivery outcomes.

## Architecture and data flow

```text
Client
  -> VI HTTP(S) listener: Host/Origin/CORS/TLS, audience and path
  -> Extension Host: registered-route lookup, correlation, bounded lifecycle
  -> Extension SDK: ordered middleware -> handler -> response middleware
  -> @virtual-inbox/client -> same public VI API used by external clients
  -> VI SMS ingestion -> inbox / anomaly / observability
  <- Extension handler creates provider-specific response
  <- HTTP runtime writes one final response
```

The client-to-VI HTTP request and the extension-to-VI **public HTTP API** call are separate transactions. The latter calls `POST /api/sms/ingestions`, distinct from the publication endpoint, to avoid recursion. The native sender has been migrated under #101.

### Execution boundary for a future IPC dispatcher

Model each request/response using JSON-compatible values: request ID, method, normalized path, audience, bounded headers, query, path parameters, body, optional correlation ID; response status, headers, body or empty response, and well-defined error. The **logical** dispatcher should be independent of Node HTTP socket objects. Embedded dispatch initially invokes handlers directly. If later needed, `child_process.fork()` or workers can carry these values using IPC; versioning, serialization, cancellation and isolation must then be specified in a separate ADR. The IPC transport is *not* a second functional API.

## Alternatives considered

| Option | Benefit | Cost / outcome |
| --- | --- | --- |
| Node process child + IPC | Crash/event-loop isolation; independent dependencies | Adds child supervision, serialization, failure recovery and IPC protocol before demonstrating need — deferred |
| Separate HTTP adapter/service | Language-independent and isolated | Additional service, networking, certificates or reverse-proxy configuration — supported as a separate deployment approach, not the first VI SDK runtime |
| Worker threads | Separate event loop in one process | Still needs messaging; does not isolate native process crashes — deferred |
| Embedded ESM | Simple registration, debugging, distribution and latency; existing ports | Trusted code can affect the entire process — **chosen for V1** |
| Embed provider routes directly in core | Lowest initial effort | Contaminates core and creates ongoing coupling — rejected |

## Compatibility, trust and operations

- ADR-0001 remains authoritative: test data only, openly observable, no production RBAC or plugin-security project. Existing operational protections for admin writes, TLS and network controls remain.
- Bundled `sms-native` is enabled by default. Legacy paths, response bodies/statuses, error semantics, sender/recipient lookup, message limits and tests must be retained without changing consumers.
- A module is trusted executable code, not sandboxed. Configuration must require explicit local installation/enabling; document provenance and the risk of `process.exit`, blocking loops, crashes and dependency side effects.
- When a configured optional extension fails to load, the core should remain operational and the failure should be visible, while bundled native registration failure prevents startup. Do not claim route availability if it was not published.
- **Deferred:** SDK/Host protocol-version negotiation is not implemented. Avoid hot-unload promises because ESM module caching and side effects make it nontrivial.
- The console displays the extension registry and links only to known local guides. **Extension-owned OpenAPI publication is not yet implemented**; do not blend external schemas into the VI core OpenAPI.
- Headers such as `User-Agent`, `X-VI-Correlation-ID` and extension identifiers are diagnostic metadata, not credentials or trusted identities; propagate only validated, bounded fields, and do not leak secrets. `X-VI-Correlation-ID` is implemented as an optional, validated and echoed header on public SMS ingestion; the extension dispatcher generates a separate correlation ID for its log events.
- Batches, SMS national-number configuration (#94), provider m-it!, remote module catalog, untrusted sandbox and IPC runtime are out of this ADR's implementation scope.

## Consequences and validation

- A new extension can publish a contract without new listener ports or edits to provider-specific core branches.
- API-level semantics and extensions' own middleware are independently testable; registration/resolution tests must establish the same behavior on the demo and main listeners.
- A public API call from a module is deliberate: the integration test must prove an external client can make the exact same call with the same validations and outcomes.
- Implemented: #97 route contract, #98 SDK, #99 Host, #100 common ingestion API, #101 native migration, #102 registry and #103 console. Documentation consolidation is #104; conformance suite is #105.

## Revisit triggers

Revisit embedded execution if an extension demonstrably blocks tests, requires a distinct runtime/dependency environment, causes process-level crashes, or untrusted extension installation becomes a requirement. Any future IPC runtime must preserve route/middleware and functional API semantics rather than introduce privileged core access.
