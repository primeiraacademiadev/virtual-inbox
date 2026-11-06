# Extensions

The Virtual Inbox console discovers extensions using the **read-only public registry** at `GET /api/extensions`.

Open **System → Extensions** to inspect loaded, failed and disabled modules. Each entry shows its capabilities, active HTTP route mappings, invocation counts, error counts, cumulative duration and last response status. The list refreshes every 15 seconds and can be refreshed manually. These are in-memory metrics; restarting VI resets them.

Select **View this extension's logs** to open the main log console with an `extensionId` server-side filter. To isolate matching extension requests, the anomaly filter is turned off. The log shows the route template, status, duration and a correlation ID but never provider request bodies or secrets.

The bundled `sms-native` extension is enabled by default. It owns the two existing demo entry points: `POST /demo/sms/messages` on the main listener and `POST /sms/messages` on the dedicated demo listener. It invokes the shared functional `POST /api/sms/ingestions` public API. To disable only the sender, set `VI_SMS_NATIVE_ENABLED=false` and restart; the registry then shows it as disabled.

Other trusted ESM extensions may be listed via `VI_EXTENSIONS`. A failed module appears as `failed-N` with a sanitized diagnostic. The console does not install modules, display provider-specific forms, load third-party scripts, or modify server configuration.

See the [integration guide](integration.md), [SDK documentation](sdk.md), and [architecture](architecture.md) for further information. Extensions can reference a local guide in their manifest; only documentation known to exist in the console can be opened as a navigation link. Unknown paths appear as text instead of broken links.


## Author an HTTP extension (V1)

The extension SDK (`extension-sdk/src/index.ts`) constructs HTTP handlers and middleware; the **functional** `sdk/client.ts` invokes the same VI public API as any external client. These are separate responsibilities. The first runtime loads **trusted ESM** into the VI Node process. It is neither Express-compatible nor a sandbox, and it does not allocate extra ports.

Build the repository before loading the executable example:

```sh
npm ci
npm run build:server
VI_EXTENSIONS='["./examples/extensions/ping.mjs"]' npm start
```

The example registers a `management` route `GET /extensions/ping` and a `demo` route `GET /ping`. From the main listener, request `GET /api/extensions/ping?name=test` and `GET /demo/ping`; the dedicated demo listener exposes `GET /ping`. The main listener does **not** support arbitrary external root mounts such as `/WebAPI` yet.

Minimal application pattern (place in a compiled ESM module, using a compatible local SDK build):

```js
const app = createApp();
app.use(async (ctx, next) => {
  await next();
  ctx.response.headers["x-test"] = "ok";
});
app.post("/provider/send", async ctx => {
  ctx.response.status = 202;
  ctx.response.body = { accepted: true };
});
export default { id: "provider-test", version: "1.0.0", app };
```

Import `createApp` from the compiled local extension SDK as shown in `examples/extensions/ping.mjs`; the standalone package is **private/not published**. The default audience is `demo`; use `{ audience: "management" }` to publish under `/api`. Middleware may short-circuit or override the response after `await next()`. The entire route set must pass collision validation before it becomes visible.

For actual SMS capture, use `VirtualInboxClient.ingestSms({from,to,body})` or the common HTTP `POST /api/sms/ingestions`, **not** the provider-facing `/demo/sms/messages` route or private core functions. A provider failure response **after** capture does not undo the message; the distinction matters when testing retries. Optional `X-VI-Correlation-ID` on public ingestion is echoed but not persisted in message metadata.

For a complete installation example, manifest fields, lifecycle, timeouts, TLS trust, routing table, error codes, OpenAPI ownership and troubleshooting, consult the [full extension author guide](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/extension-author-guide.md), [ADR-0002](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/adr/0002-http-extensions.md), and [extension routing contract](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/extension-routing-contract.md). The public registry is read-only; V1 does not include IPC, hot reload, provider-specific console UI or automatic publication of extension-owned OpenAPI files.
