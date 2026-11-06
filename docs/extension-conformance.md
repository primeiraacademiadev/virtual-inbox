# Extension conformance suite — V1

The suite verifies the **implemented** trusted in-process Extension SDK/Host contract; it is not a security sandbox or a certification for untrusted plugins. See [ADR-0002](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/adr/0002-http-extensions.md) and the [extension author guide](extension-author-guide.md).

## Execute the conformance checks

From the Virtual Inbox repository root (Node 24 or 26):

```sh
npm ci
npm test
npm run build:server
node testing/scripts/extension-conformance.mjs
```

The normal `npm test` includes `test/extension-conformance.test.ts`. The reusable functions are in `test/extension-conformance-harness.ts`. They exercise SDK route publication, audiences, atomic conflicts, middleware ordering and response override, context parameters/correlation, rejection of invalid/oversized responses, handler exceptions, metrics and a real 10-second asynchronous timeout.

The standalone ESM smoke script loads `examples/extensions/provider-adapter.mjs` through **the actual Extension Host**, then routes ordinary HTTP requests through the actual `tryExtensionRequest` adapter. A separate minimal HTTP fixture provides the same **public** `POST /api/sms/ingestions` interface; it is deliberately a small test fixture rather than the VI Sandbox or a privileged mock core call. Existing HTTP integration tests cover native SMS against the **real** VI public ingestion endpoint.

The sample provider uses `createApp()`, its own `Authorization` check, an async middleware that adds an `X-*` response header, and `VirtualInboxClient.ingestSms()`. The smoke test proves that invalid provider credentials and invalid inputs do **not** capture a message, and a valid invocation captures exactly once. It verifies provider response status/body, registry metadata, published logical routes, request/error metrics, and that an unknown route stays 404. No extra process or listening port is allocated by the extension—only the self-contained test fixture binds ephemeral localhost ports.

CI runs this smoke script on both Linux Node 24 and Node 26 **after** compiling the backend. The general `npm test` suite and existing managed E2E tests continue to protect the native SMS sender's original request/response contract and console rendering.

## Develop a provider adapter in another repository

The current `@virtual-inbox/extension-sdk` is **private**; it is not available from public npm and has no version-negotiation protocol yet. For an external repository, build a compatible local copy of the SDK, then supply its compiled module path in your adapter's import. Do not expect `import '@virtual-inbox/extension-sdk'` to work through public package installation today.

A provider ESM module must export `default { id, version, app, displayName?, capabilities?, documentation? }` and be loaded through `VI_EXTENSIONS='["/absolute/path/to/adapter.mjs"]'`. It uses the SDK solely for route registration and middleware, and the common `@virtual-inbox/client` or public HTTP operations for all captures. It may contain provider-specific authentication, request translation and response simulation; it must never import `src/core.ts`, the Sandbox or private VI facilities.

The included example requires `VI_EXAMPLE_PUBLIC_API_URL` to point to the actual public HTTP(S) VI listener. Set a trusted CA for local HTTPS if needed; do not disable certificate verification. The example's provider-facing path is `POST /demo/provider/messages` on the main listener and `POST /provider/messages` on the dedicated demo listener. For `/WebAPI` at the root of the **main** listener, an explicit host mount capability is still required and **not implemented**.

After installing, restart VI and inspect `GET /api/extensions` or System → Extensions. Select the extension to view its logical/public routes, metrics, documentation and filtered `extension.request` logs. A failed ESM module appears as `failed-N` with `EXTENSION_LOAD_FAILED`; details remain in local startup logs. A module failure is not authorization or tenant isolation.

## Supported contract checklist

| Area | Verification |
| --- | --- |
| SDK routes and middleware | Explicit methods, audiences, params, query, ordered `await next()`, override |
| Publication and reserved routes | Atomic rejection on collision; no core takeover |
| HTTP and public API | Auth pre-capture; one capture per successful send; provider response |
| Errors and timeout | Bounded 502/504 outcomes, invalid header/oversized payload rejection |
| Diagnostics | Registry state, paths, metrics, correlation; no body/credentials in logs |
| Compatibility | Native `sms-native` sender remains covered by existing HTTP/E2E tests |
| Console | Existing component tests cover registry representation and localized navigation |

**Limit:** V1 has no general cancellation mechanism or sync-code preemption: the Host's asynchronous deadline does not stop a synchronous loop, roll back an already captured SMS, or provide an AbortSignal to handlers. A future IPC runtime or provider-specific OpenAPI publication requires separate design and acceptance criteria.
