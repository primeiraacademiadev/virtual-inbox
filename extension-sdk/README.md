# Virtual Inbox Extension Application SDK (V1)

Small Express-like **application model**, deliberately **not Express-compatible**. It does not open a socket, grant access to VI internals or implement an extension Host. The future Host owns listeners and atomically publishes route descriptors. The first transport is embedded JavaScript; logical request and response data are JSON-compatible for a possible IPC dispatcher later.

```ts
import { createApp } from "@virtual-inbox/extension-sdk";

const app = createApp();
app.use(async (ctx, next) => {
  await next();
  ctx.response.headers["x-trace"] = "captured";
});
app.post("/sms/messages", async (ctx) => {
  // Use @virtual-inbox/client or the public VI HTTP API, not internal core functions.
  ctx.response.status = 201;
  ctx.response.body = { accepted: true };
});

// Host: app.routes() -> atomic publication and ownership checks
// Host: await app.dispatch({ method: "POST", audience: "demo", path: "/sms/messages", body: {} });
```

## Semantics

- `app.use(middleware)` applies to this extension only. `app.use("/prefix", middleware)` applies to this path segment subtree, including `/prefix` itself. Registration order determines middleware order.
- `await next()` invokes the rest of the chain and allows response changes on the way back; returning without calling it short-circuits. Calling `next()` more than once is an error.
- Routes support GET/POST/PUT/DELETE, `{name}` params and the existing `demo`/`management` audiences (default: `demo`). Ambiguous route shapes within the same method/audience are rejected. The Host must also reject conflicts with core routes or other extensions.
- `dispatch()` returns `null` on route miss; the Host owns 404, operational limits, timeouts, failures, TLS, CORS and final response writing. Successful handlers should explicitly set `ctx.response.status` and `body`; default status is 204.
- Request and response JSON shapes are the contract; avoid Node HTTP socket objects, callbacks, streams and non-JSON values. Request-local `ctx.state` exists only during dispatch and is not exported.
- This is **trusted in-process code**, not a security sandbox. Never pass real data to a VI test instance.

## Scope

Package is private until API stabilizes; it is distinct from `@virtual-inbox/client`. The Host lifecycle/ESM loading and physical route mounting follow in #99; the public ingestion API in #100; the bundled SMS extension in #101. No IPC runtime or provider-specific contract is included.
