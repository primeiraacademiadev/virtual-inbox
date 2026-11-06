# HTTP extension author guide — implemented V1

This guide describes the **implemented** trusted JavaScript/ESM extension model in Virtual Inbox. For the decision record see [ADR-0002](adr/0002-http-extensions.md), for the route semantics see [HTTP routing contract](extension-routing-contract.md), and for runtime/metrics see [Extension Host](embedded-extension-host.md) and [public registry](extension-registry.md).

## First principles

Virtual Inbox is an openly observable, synthetic-data test sandbox (ADR-0001), **not** a production provider gateway or a secure plugin host. One VI process owns the HTTP/HTTPS listeners, TLS, Host/Origin/CORS checks, core API and console. An extension owns only its provider-facing HTTP paths, middleware and responses. Functional operations use the **same public VI API** as any external test client—never private `Sandbox` methods.

Two separate interfaces exist:

| Interface | Responsibility | Status |
| --- | --- | --- |
| `@virtual-inbox/extension-sdk` | Construct application handlers, routes, middleware and JSON response | Implemented in `extension-sdk/src/index.ts`, private local package |
| `@virtual-inbox/client` | Call VI functional public API, e.g. SMS ingestion | Implemented in `sdk/client.ts`; use this or ordinary HTTP |
| Embedded Extension Host | Load local ESM, validate/register routes atomically, dispatch requests, record metrics | Implemented in `src/extension-host.ts` |
| Public registry and console | Read-only `GET /api/extensions` and System → Extensions | Implemented; no installation/activation UI |

The extension application is **not Express**: Express middleware, `req`, `res`, WebSockets and streamed bodies are not supported by this SDK. There is no independent service and no IPC channel in V1.

## A real, runnable extension

The repository contains [`examples/extensions/ping.mjs`](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/examples/extensions/ping.mjs). It is compiled-module-compatible ESM and demonstrates both audiences. From the repository root on Node 24+:

```sh
npm ci
npm run build:server
VI_EXTENSIONS='["./examples/extensions/ping.mjs"]' npm start
```

If you are using a non-default network configuration, inspect `GET /api/connection-info` or the console's Connections page for the actual address, scheme and port. Use the configured TLS trust chain (including the local CA for self-signed test certificates). On an ordinary main listener, check:

```text
GET /api/extensions                   # inventory, including example-ping
GET /api/extensions/ping?name=hello   # management audience; returns JSON
GET /demo/ping                        # demo audience; returns JSON
```

The last operation is also available as `GET /ping` on a **dedicated demo listener**. The example is included as a source file and is **not enabled by default**. It imports `../../dist/extension-sdk/src/index.js` from the repository build; the standalone extension SDK is currently private and is not advertised as a published npm dependency. When copying this example outside the repository, provide a compatible local compiled SDK and adjust that import yourself.

### Authoring and exporting an application

A minimal extension follows this pattern (illustrative JavaScript for the local SDK):

```js
import { createApp } from "../../dist/extension-sdk/src/index.js";

const app = createApp();

app.use(async (ctx, next) => {
  ctx.state.started = Date.now();
  await next();
  ctx.response.headers["x-example"] = "handled";
});

app.post("/sample/send", async (ctx) => {
  const input = ctx.request.body; // JSON-compatible object
  ctx.response.status = 202;
  ctx.response.body = { accepted: true, echoed: input ?? null };
});

export default {
  id: "sample-provider",
  version: "1.0.0",
  displayName: "Sample provider",
  capabilities: ["example"],
  documentation: "/docs/embedded-extension-host",
  app,
};
```

The module must export a **default object**, not a `register(app)` function. Required fields: `id` (lowercase alphanumeric with hyphens, beginning with a letter, at most 64 chars), nonempty `version`, and an application returned by `createApp()`. Optional fields: `displayName`, short `capabilities` array, and a relative local `documentation` path. At least one route must exist. The Host currently **does not negotiate** a `sdkCompatibility` or protocol version; do not present that suggested ADR field as part of the current manifest.

## Route registration and audiences

`app.get/post/put/delete(path, handler, { audience? })` registers an HTTP operation. Default audience: `demo`.

| Logical route | Main listener | Dedicated demo listener |
| --- | --- | --- |
| `demo: POST /sample/send` | `POST /demo/sample/send` | `POST /sample/send` |
| `management: GET /extensions/ping` | `GET /api/extensions/ping` | Not exposed |
| Bundled `demo: POST /sms/messages` | `POST /demo/sms/messages` | `POST /sms/messages` |

The tuple `audience + method + logical path` identifies a registration. The Host checks conflicts with its core catalogue and other extensions; a collision or ambiguous path pattern rejects the **entire module**. Only the bundled `sms-native` extension receives a code-controlled transfer of the legacy `/sms/messages` route. Paths are canonical absolute paths without wildcards/catch-all; named segments use `{name}` and become `ctx.params.name`.

Core and console paths remain reserved. **Mounting an extension directly at `/WebAPI/...` on the main listener root is not implemented**; on the current main listener a demo route is exposed under `/demo`, and a root-level provider path needs a dedicated demo listener or a future explicit host mount feature.

`OPTIONS`, Host/Origin/CORS and final HTTP writing belong to the VI HTTP runtime. Do not implement or bypass them inside an extension.

## Context, middleware and response lifecycle

Middleware is registered with `app.use(fn)` (all of that extension's routes) or `app.use("/sample", fn)` (only that segment subtree). It receives `(ctx, next)`, where `await next()` invokes downstream middleware and the handler; after it resolves, outer middleware can modify or replace `ctx.response`. Returning without `next()` short-circuits; calling `next()` twice raises an error.

```js
app.use("/sample", async (ctx, next) => {
  await next();
  if (ctx.response.status === 202) {
    ctx.response.status = 200;
    ctx.response.body = { outcome: "simulated" };
  }
});
```

`ctx.request` includes `method`, `path`, `audience`, `headers`, optional `body` and `correlationId`. `ctx.query` and `ctx.params` contain URL values; `ctx.state` is request-local ephemeral memory. `ctx.response` begins at `{status: 204, headers: {}}`. Set status explicitly for responses with a body. Response body must be JSON-compatible and currently limited to **1 MiB of serialized JSON**; only bounded `X-*` and `Cache-Control` response headers are supported by the Host. No arbitrary `Set-Cookie`/hop-by-hop headers, streams, binary payload or WebSockets.

These modules run **in the same Node.js process**. A ten-second deadline bounds asynchronous dispatch, but cannot interrupt a synchronous infinite loop or undo a completed capture. Do not treat the execution model as a sandbox.

## Calling the public functional API

The bundled native SMS adapter is the reference implementation: [`src/extensions/sms-native.ts`](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/src/extensions/sms-native.ts) builds the SDK app, then invokes `VirtualInboxClient.ingestSms({from, to, body})`, which sends `POST /api/sms/ingestions`.

```text
Test client -> POST /demo/sms/messages
  -> VI HTTP router -> sms-native SDK handler
  -> @virtual-inbox/client -> POST /api/sms/ingestions
  -> Sandbox capture/routing/TTL/anomaly
  -> public Message response -> sms-native response -> test client
```

This is an ordinary public HTTP request, with the same validations and error contract as an external test client. It is **not** a call into the private core and must not recursively call the provider-facing `/demo/sms/messages` endpoint. The bundled adapter uses certificate-verified HTTPS when TLS is on; plaintext HTTP is used only when VI TLS is explicitly disabled. The `X-VI-Correlation-ID` header on **public ingestion** is optional, validated and echoed; it is a diagnostic value, not an authentication token and not currently persisted in message/log metadata. The HTTP adapter also generates a distinct dispatch correlation ID for extension log events.

**Capture and provider response are different events:** if an extension captures a message successfully and then returns a simulated provider failure, that failure does not reverse the capture. The caller may retry and create a second capture. Decide whether failure injection happens before or after ingestion.

## Loading and lifecycle

- `VI_EXTENSIONS`: JSON array of local compiled `.js`/`.mjs` paths; omitted or `[]` means no **optional** extensions.
- `VI_SMS_NATIVE_ENABLED=false`: disables the **bundled** SMS sender; every other value, including unset, enables it.
- Changes to extensions require **restart**; no remote installation, dynamic enable/disable, ESM hot-unload or sandboxing.
- The Host loads each optional module, validates its complete route set, and registers it atomically. Invalid optional extensions are reported at startup and as sanitized `failed-N` entries. A malformed `VI_EXTENSIONS` JSON configuration fails startup.
- A failed bundled native registration prevents successful startup. If native SMS sending is explicitly disabled, its old demo endpoints return `503 SMS_EXTENSION_UNAVAILABLE` but public `POST /api/sms/ingestions` still works.

## Discover, inspect and troubleshoot

Use the console's **System → Extensions** or request `GET /api/extensions`. The registry contains id/version/state, capabilities, registered routes with public paths, and in-memory metrics (`count`, `errors`, `totalDurationMs`, `lastStatus`).

To inspect requests without exposing payloads, open **View this extension's logs**, or query `GET /api/logs?extensionId=sample-provider` (SSE: `GET /api/logs/events?extensionId=sample-provider`). Events are structured `extension.request` entries with route template, method, status, duration and correlation ID; circular retention applies. A route that is not registered does not appear as active.

| Symptom | First check |
| --- | --- |
| `failed-N` / `EXTENSION_LOAD_FAILED` | Module path, ESM exports, import dependencies, valid manifest and path collisions; consult **local startup logs** for detailed failure |
| 404 on expected path | Correct `/demo` vs `/api` audience and actual listener; check `GET /api/extensions` for published paths |
| `502 EXTENSION_FAILED` | Handler exception, unsupported header/body, or failed public API call |
| `504 EXTENSION_TIMEOUT` | Slow asynchronous extension handler; avoid blocking synchronous JavaScript |
| `503 SMS_EXTENSION_UNAVAILABLE` | Native sender explicitly disabled; functional public SMS ingestion remains available |
| Certificate verification error | Check TLS hostname/SAN and CA trust; do **not** disable TLS verification |
| No metrics increment | Confirm request reached a registered extension route; unmatched requests are not counted |
| Missing `/WebAPI` on main root | Arbitrary root mounts are not yet a capability of the current Host |

## OpenAPI and the roadmap

The generated VI OpenAPI is authoritative for **core and retained compatibility** operations (including the legacy native SMS sender route and public SMS ingestion). It does **not** automatically ingest third-party provider specifications. Extensions may maintain their own OpenAPI files, but the V1 Host does not serve or combine them automatically. The registry's optional `documentation` field is a relative pointer; the console only navigates known, already-published guides.

Out of scope for the current runtime: untrusted plugins, installation catalogs, generic root mounts on the main listener, arbitrary HTTP middleware packages, IPC/child-process supervision, streaming, WebSockets, provider m-it! adapter and batch SMS. The reusable conformance suite and external provider sample are planned separately in [#105](https://github.com/primeiraacademiadev/virtual-inbox/issues/105).
