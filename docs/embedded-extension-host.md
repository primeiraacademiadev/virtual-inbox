# Embedded Extension Host (experimental)

This document describes the **initial runtime** implemented for #99. See [ADR-0002](adr/0002-http-extensions.md) and [routing contract](extension-routing-contract.md). This is an HTTP test sandbox, **not** a runtime for untrusted plugins.

## Enable a trusted local extension

Configure `VI_EXTENSIONS` as a JSON array of absolute or working-directory-relative paths to compiled `.js`/`.mjs` modules. When omitted or `[]`, **nothing changes** for existing Virtual Inbox installations.

```sh
npm run build:server
VI_EXTENSIONS='["./examples/extensions/ping.mjs"]' npm start
```

In PowerShell, set `$env:VI_EXTENSIONS='["./examples/extensions/ping.mjs"]'` before starting the service. The example imports the SDK from the repository's compiled `dist/extension-sdk` location. Until a separate extension SDK package is published, external module authors must use a compatible local build of the SDK.

After startup, on a main listener `GET /api/extensions/ping?name=test` invokes the example management handler; on the main listener `GET /demo/ping` and on dedicated demo listeners `GET /ping` invoke the same demo handler. Existing ports, TLS policies, Host/Origin checks, CORS and built-in endpoints remain unchanged.

## Minimal API

A module exports `default { id, version, app }`, where `app` is created with `createApp()`, contains routes and middleware, and exposes `routes()` and `dispatch()`. V1 app route audiences are `management` and `demo`. Route handling is Express-like, with async onion-style `await next()`, but **not Express compatible**.

The Host loads modules through ESM `import()`, validates each entire module's declared route set against the current core catalogue and already activated modules, then registers the module atomically. A failed module records a diagnostic and other modules continue loading. Errors are logged during startup; a public extension registry, activation UI and persistent diagnostics are planned separately (#102/#103).

External URL mounts such as `/WebAPI/*` on the **main listener root** are not yet supported. Existing explicit physical mappings are `/api/` (management), `/demo/` (demo), and `/` on dedicated demo listeners. Host bindings for arbitrary public roots belong to the next routing iteration; no path should silently override console or core routes.

## Functional API and limits

Extensions are **trusted process-local code**; they have the same Node process privileges and can block/crash the VI. The SDK itself grants no privileged access to core. Functional operations must use the same public VI API as ordinary clients. Never recursively call an extension's own public sender endpoint; the single common ingestion operation is settled under #100.

V1 responses are JSON-compatible objects, with optional bounded `X-*` and `Cache-Control` headers; no streaming, cookies, binary response bodies, arbitrary HTTP socket APIs or WebSockets. The Host caps response JSON to 1 MiB and has a 10-second asynchronous request deadline. A timeout cannot interrupt a blocking synchronous handler or roll back a capture already performed. A handler/transport failure returns a controlled 502, a deadline returns 504; no automatic retry is performed.

`VI_EXTENSIONS` must be valid JSON array input, otherwise startup fails explicitly. Loaded optional extensions that fail to import or validate are reported in startup diagnostics and do not prevent base listeners from starting. Hot reload, actual ESM unloading, private module isolation and per-extension resource quotas are intentionally not promised.

## Next

#100 stabilizes public SMS ingestion, #101 moves existing HTTP SMS sending to a bundled, enabled-by-default extension; #102 makes the module catalogue and failures observable through a public API; #103 renders it in the console. The existing sender remains in the core until #101.
