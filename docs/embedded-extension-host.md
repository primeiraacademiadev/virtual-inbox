# Embedded Extension Host (implemented V1)

This document describes the **initial runtime** implemented for #99. See [ADR-0002](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/adr/0002-http-extensions.md) and [routing contract](extension-routing-contract.md). This is an HTTP test sandbox, **not** a runtime for untrusted plugins.

## Enable a trusted local extension

Configure `VI_EXTENSIONS` as a JSON array of absolute or working-directory-relative paths to compiled `.js`/`.mjs` modules. When omitted or `[]`, no third-party extensions are installed. The bundled `sms-native` extension remains enabled by default and owns the existing demo sender endpoints.

```sh
npm run build:server
VI_EXTENSIONS='["./examples/extensions/ping.mjs"]' npm start
```

In PowerShell, set `$env:VI_EXTENSIONS='["./examples/extensions/ping.mjs"]'` before starting the service. The example imports the SDK from the repository's compiled `dist/extension-sdk` location. Until a separate extension SDK package is published, external module authors must use a compatible local build of the SDK.

After startup, on a main listener `GET /api/extensions/ping?name=test` invokes the example management handler; on the main listener `GET /demo/ping` and on dedicated demo listeners `GET /ping` invoke the same demo handler. Existing ports, TLS policies, Host/Origin checks, CORS and built-in endpoints remain unchanged.

## Minimal API

A module exports `default { id, version, app }`, where `app` is created with `createApp()`, contains routes and middleware, and exposes `routes()` and `dispatch()`. V1 app route audiences are `management` and `demo`. Route handling is Express-like, with async onion-style `await next()`, but **not Express compatible**.

The Host loads modules through ESM `import()`, validates each entire module's declared route set against the current core catalogue and already activated modules, then registers the module atomically. A failed module records a diagnostic and other modules continue loading. Errors are logged during startup and sanitized failure states are available through `GET /api/extensions` (#102). The read-only System → Extensions page is implemented (#103); dynamic activation and persistent diagnostics are **not** implemented.

External URL mounts such as `/WebAPI/*` on the **main listener root** are not yet supported. Existing explicit physical mappings are `/api/` (management), `/demo/` (demo), and `/` on dedicated demo listeners. Host bindings for arbitrary public roots belong to the next routing iteration; no path should silently override console or core routes.

## Functional API and limits

Extensions are **trusted process-local code**; they have the same Node process privileges and can block/crash the VI. The SDK itself grants no privileged access to core. Functional operations must use the same public VI API as ordinary clients. Never recursively call an extension's own public sender endpoint; the implemented common ingestion operation is `POST /api/sms/ingestions` (#100).

V1 responses are JSON-compatible objects, with optional bounded `X-*` and `Cache-Control` headers; no streaming, cookies, binary response bodies, arbitrary HTTP socket APIs or WebSockets. The Host caps response JSON to 1 MiB and has a 10-second asynchronous request deadline. A timeout cannot interrupt a blocking synchronous handler or roll back a capture already performed. A handler/transport failure returns a controlled 502, a deadline returns 504; no automatic retry is performed.

`VI_EXTENSIONS` must be valid JSON array input, otherwise startup fails explicitly. Loaded optional extensions that fail to import or validate are reported in startup diagnostics and do not prevent base listeners from starting. Hot reload, actual ESM unloading, private module isolation and per-extension resource quotas are intentionally not promised.

## Bundled native SMS sender

The `sms-native` extension is installed and enabled by default. It registers the single logical `demo /sms/messages` operation, published as `POST /demo/sms/messages` on the main listener and `POST /sms/messages` on the dedicated demo listener. The **OpenAPI operationId, request shape, 202 Accepted response (previously 201) and existing URLs remain unchanged**. The handler calls `@virtual-inbox/client.ingestSms()` using the normal `POST /api/sms/ingestions` public HTTP endpoint; it does not access the VI Sandbox directly.

`VI_SMS_NATIVE_ENABLED=false` disables only the bundled sender endpoint. Calls to the former public demo URLs return `503` with error code `SMS_EXTENSION_UNAVAILABLE`; the functional public ingestion API, inboxes, SMTP, POP3 and other extensions remain available. Any other value, including an unset variable, leaves it enabled. Changing this setting requires restart. If native registration fails, startup fails visibly rather than silently serving a different implementation. A third-party extension cannot take over this reserved route merely by using the `sms-native` identifier.

The embedded handler uses the **existing main public API listener**. If TLS is configured it calls HTTPS with certificate verification: the generated local CA is trusted explicitly (or the active external/uploaded certificate is pinned), and TLS failure never downgrades to plaintext. Only an instance with TLS explicitly disabled uses the existing HTTP listener, following the test-sandbox configuration. There is no new listener and no IPC. A failed internal HTTP call produces a controlled extension error; provider-facing error responses from the public SMS API retain their original status and structured error body.

## Registry, console and further reading

The bundled sender and its routes are real SDK/Host registrations, not simulated console metadata. `GET /api/extensions` reports active, failed and disabled modules; System → Extensions shows the registry, endpoints, metrics and filtered log access. See [public registry](extension-registry.md) and the [extension author guide](extension-author-guide.md). The reusable conformance harness remains planned for #105.
