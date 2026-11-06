# Extension HTTP endpoint and routing contract — implemented V1 and deferred design

- **Status:** Accepted as design baseline for #97; implementation differences and deferred capabilities are noted below.
- **Related:** #95, #96, #97, #98, #99, #100, #101, #102, #103, #104, #105.
- **Current implementation:** `src/http/api-contract.ts` owns the core route catalogue; `src/http/request-router.ts` selects the `management` or `demo` audience; `src/extension-host.ts` registers extensions and dispatches to `extension-sdk/src/index.ts`. See [author guide](extension-author-guide.md) for the exact shipped contract. Some sections below describe deliberately deferred design.

## 1. Public address, audience and ownership

The route key is `(audience, method, normalizedPathPattern)`, not just a path. V1 retains two existing audiences:

| Incoming endpoint | Current audience | Logical route key |
| --- | --- | --- |
| Main HTTP(S): `POST /demo/sms/messages` | `demo` | `demo, POST, /sms/messages` |
| Dedicated demo HTTP(S): `POST /sms/messages` | `demo` | `demo, POST, /sms/messages` |
| Main HTTP(S): `GET /api/phone-numbers` | `management` | `management, GET, /phone-numbers` |

The first two examples refer to **one logical operation and one logical route registration** exposed through two listener mappings. An extension must not need to bind twice to implement the legacy behavior. TLS/host/port variations are physical entry points, not separate registrations.

An optional provider extension might publish `/WebAPI/message/send` on a configured delivery surface. **That external root-path mapping is an explicit host configuration**, not an implicit mapping under `/demo` or `/api`. The registry must display the effective externally accessible paths, listener(s), and audience. No extension may claim VI's built-in `/api`, `/demo`, console/static or diagnostic route space by wildcard.

> **Migration exception:** The core-catalogue `sendSms` demo operation is retained for compatibility/OpenAPI, but the runtime handler has moved to bundled `sms-native` (#101). Its route is transferred only through `registerNativeSms()`; there is no general `override: true` switch.

## 2. Design descriptors (illustrative; **not** the shipped manifest)

```ts
type Audience = "management" | "demo"; // existing V1 audiences
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface ExtensionManifest {
  id: string;             // stable globally unique extension ID
  version: string;        // extension release version
  sdkCompatibility: string; // supported Extension SDK/Host contract range
  displayName: string;
  routes: RouteDescriptor[];
  documentation?: { openapi?: string }; // reference to extension-owned documentation
}

interface RouteDescriptor {
  method: HttpMethod;
  audience: Audience;
  path: string;            // normalized logical path pattern, e.g. /sms/messages
  handlerId: string;       // handler supplied by the extension app
}
```

The shipped manifest is `default { id, version, app, displayName?, capabilities?, documentation? }` (#98/#99). **`sdkCompatibility` version negotiation and nested OpenAPI references are not implemented.** The manifest declares only the surface exposed; it does not grant access to VI core internals. An extension may register middleware and handlers through `app.use` and `app.post`, and the SDK/Host must be able to associate them with each route's audience.

For arbitrary root paths such as `/WebAPI/*`, a publication binding must explicitly connect the extension's logical route to a listener/external mount. Whether the binding belongs to the manifest or VI instance configuration will be decided with #99; **no automatic takeover of the management or console origin**.

## 3. Route matching and collisions

- On startup/activation, normalize and validate the **entire** route set, then commit it atomically, or reject all routes for that extension. No partial registration.
- Reject duplicate keys, including duplicates inside one extension.
- Reject ambiguous patterns within an audience/method across owners, such as `/x/{id}` versus `/x/{name}`, and literal-versus-parameter matches where both could resolve to the same path. **V1 chooses rejection rather than precedence by insertion order**; this avoids silently changing existing clients' routing.
- Reject wildcard/catch-all patterns in V1; no unbounded shadowing of core, console or management paths.
- Compare normalized segments, not string prefixes. Enforce a single leading slash and canonical path representation; require a policy for duplicate/trailing slash and percent-decoding before accepting route definitions. Do not silently reinterpret existing client request paths as part of the extension rollout.
- Different methods can share a path. Different audiences can share a logical path, provided the physical listener mapping does not expose an ambiguous public URL.
- Path parameters are **only** named non-empty segments in V1; decode request values once with a clear failure on malformed encoding. Define static/parameter overlap as a publication conflict.
- Core routes remain reserved; an extension cannot register middleware that runs on unrelated core endpoints. Global middleware applies to **that extension's routes only**, not to every VI request.
- Route publication is validated against both the existing core catalogue and all registered extensions. Any changed route set is validated as one proposed snapshot before becoming visible.

### Request routing order

1. Host/Origin, TLS and existing HTTP operational checks apply exactly as they do today.
2. Resolve physical listener and effective audience; strip only the established `/api`/`/demo` prefixes where appropriate.
3. Resolve the core route or published extension route from the validated immutable registry snapshot.
4. For an extension route, invoke its SDK dispatcher (including middleware). The Host retains transport, timeout/size limits and final response writing.
5. If there is no match, preserve legacy 404 behavior and console static fallback. Do not introduce a global extension catch-all.

`OPTIONS` and CORS preflight remain owned by the VI HTTP runtime; extension-specific allowed methods should eventually be derived from published routes without relaxing existing origin checks. Changes to 404 vs 405 semantics are **not** part of the first migration: the current router returns 404 on unmatched methods; do not introduce a breaking 405 without a separate contract decision.

## 4. Extension handler contract and middleware

The SDK API will be Express-like for registration, with asynchronous onion-style middleware:

```ts
const app = createApp();
app.use(async (ctx, next) => {
  ctx.state.requestStart = Date.now();
  await next();
  // Observe, map or entirely replace the handler result before HTTP commit.
  ctx.response.headers["x-example"] = "done";
});
app.post("/sms/messages", async (ctx) => {
  ctx.response.status = 201;
  ctx.response.body = { /* JSON-compatible public response */ };
});
```

This example is illustrative but uses the **implemented** SDK API. `await next()` invokes downstream middleware/handler at most once; middleware runs back out in reverse order. Short-circuit without calling `next()` is permitted. The Host does not emit the HTTP response until the complete middleware chain returns successfully. Errors in pre-, handler, or post-middleware stages are caught by Host boundaries and converted to controlled, observable failures, unless an explicit response already exists under a documented error policy.

The initial payload is bounded and JSON-compatible: request ID, method, logical path, effective public path/audience, path/query parameters, normalized headers, optional correlation ID and parsed body; response has status, bounded headers, JSON-compatible body, or no body. Node `IncomingMessage`, `ServerResponse`, functions, streams, raw sockets and WebSockets are out of scope. If a client needs non-JSON media, its acceptance must be designed in a later contract version rather than silently assumed.

## 5. Functional API boundary and recursion

The extension does **not** invoke `Sandbox.capture()` or any private VI method. It calls the same external public ingestion API, via `@virtual-inbox/client` or HTTP. The shared ingestion operation is `POST /api/sms/ingestions` (#100); the extension **must not POST back to its own `/sms/messages` route**. The native sender already uses this public API (#101).

Headers for origin/correlation (`User-Agent`, proposed `X-VI-Correlation-ID`, extension ID) must be bounded, validated and treated as diagnostics, not authentication. The extension owns the provider-visible response; a provider failure response after a successful capture does not roll back the core message.

## 6. Status, timeout, error and shutdown

- **Publication failure:** none of an extension's routes become active; record a structured diagnostic and expose failed state via #102.
- **Disabled/unavailable extension:** cannot claim an active published endpoint. For an established, formerly published endpoint, define a deterministic transport-level failure (normally 503) so operators can distinguish unavailable from unknown. Exact response schema must be reviewed for compatibility with native SMS before #101.
- **Handler exception:** controlled error, without leaking stack traces/credentials to HTTP clients. Preserve existing core error contract on native SMS migration.
- **Async timeout/cancellation:** Host bounds pending operations and signals abort to the handler. It cannot kill synchronous loops in embedded code. Never retry a capture automatically: failure after capture may already have produced a message.
- **Response mutation:** allowed before response commit; no mutation of already streamed bytes (streaming not in V1).
- **Lifecycle:** load → validate → register/activate → serve → disable/shutdown. Avoid claiming unload or hot reload of ESM modules.
- **Bodies and headers:** enforce VI operational limits, reject sensitive or hop-by-hop headers where appropriate, and define response-size behavior. Do not log raw credentials/provider tokens.

## 7. OpenAPI, registry and console

- VI's existing generated management and demo OpenAPI files describe core operations and maintain backward-compatible published surfaces. The migration must keep the native SMS operation documented with its established response.
- Each extension may publish its own OpenAPI for **its** contract; it must not replace or silently merge into the authoritative VI OpenAPI. The legacy native sender remains in the core demo OpenAPI for compatibility; third-party extension OpenAPI publication is not implemented.
- The implemented public registry (#102) reports extension ID, version, enabled/active/failed state, logical routes, physical listener bindings, public paths and optional docs; the console (#103) renders these generically.
- No provider-specific UI code or provider schema parsing is required in the console.

## 8. Contract tests for #97 and downstream gates

1. Route-table examples above resolve exactly on all current listeners, retaining legacy 404/preflight behavior.
2. Two different extensions claiming one logical key are rejected atomically.
3. Core reserved route, console path, wildcard and ambiguous parameter/literal overlap are rejected.
4. Same path with different method/audience has an unambiguous mapping or is rejected when a physical listener would collide.
5. A failed manifest leaves the previous registry snapshot unchanged; healthy extensions continue serving.
6. Middleware order, short-circuit and response override are deterministic (#98).
7. Handler rejection and asynchronous timeout return bounded diagnostics without failing the core; no automatic retry (#99).
8. The native SMS extension can retain exactly the original request/status/response/headers across demo and same-origin paths (#101).
9. Another extension's independent routes appear in the public registry and console without a VI-specific provider code change (#102/#103/#105).

## Explicitly deferred decisions

- Final package/type names and schema-version negotiation (#98).
- Which user-facing configuration maps extension logical paths to arbitrary root-level mounts and how those mounts coexist with console static assets (#99).
- Exact shared SMS ingestion endpoint, authentication and backward-compatible errors (#100).
- Optional extension dynamic enable/disable at runtime versus configuration+restart (#99).
- Cross-process IPC, binary streams, WebSockets, remote catalogs and untrusted-code sandbox — **not V1**.
- Batch SMS and per-item outcome model — separate future VI evolution, independent of m-it!.
