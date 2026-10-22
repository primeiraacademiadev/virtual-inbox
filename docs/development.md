# Development, operations and known limitations

**Audience:** maintainers and engineers evaluating the implementation. This describes source that has been committed, not certified test results.

## Repository layout

- `src/server.ts`: HTTP/HTTPS, SMTP/STARTTLS, SMTPS, SSE, demo listeners and admin configuration routes
- `src/core.ts`: in-memory resource/message registry, attachments, waiters, observer sessions and event journal
- `src/config.ts`: operational limits read from environment
- `web/src/`: React console and typed management API client
- `web/public/docs/api.md`: curated API-only reference (deliberately excludes demo sender endpoints)
- `docs/`: canonical Markdown guides
- `scripts/sync-docs.mjs`: copies canonical Markdown into `web/public/wiki/` before Vite dev/build
- `sdk/client.ts`: TypeScript client helper for test runners
- `test/`: initial Node test sources; tests remain to be executed and expanded

## Developer start

Require Node.js 24+ and npm; OpenSSL on PATH for default `TLS_MODE=auto`.

```sh
npm install
npm install --prefix web
npm run build:console
npm run dev
```

For frontend hot reload, run `npm run dev:console` separately. The compiled console is served by the Node HTTPS listener, when TLS enabled.

## Dependency and reproducibility status

The package manifests have been updated but **there are no committed npm lockfiles yet**. On a machine with npm registry access, resolve dependencies, commit `package-lock.json` and `web/package-lock.json`, then change CI to `npm ci`. Do not assert build, audit or compatibility success before those commands run. The CI workflow proposes Node 24 and Node 26, but green results are not confirmed.

## State and quotas

All state is in a single Node process. Resources, messages, attachment buffers, observer sessions, log entries and expiration tombstones are ephemeral. Environment settings are documented in [../.env.example](../.env.example), including SMTP message bytes, per-attachment size/count, HTTP/SMS body sizes, memory/message counts, observer count/TTL, inbox count/TTL, timeout and server connection limits.

The SMTP cap defaults to 20 MiB **for the entire MIME message**, not each decoded attachment. The HTTP body cap supports encoded demo attachments. Resource expiration removes messages and detaches observers; a bounded tombstone cache distinguishes recently expired addresses from unknown recipients.

## TLS and administrative configuration

Node terminates TLS on HTTPS, SMTP STARTTLS and implicit SMTPS. In local auto mode the application invokes OpenSSL to create and reuse a development CA, and reissues server certificates near expiry. Importing an external PEM pair or changing advertised host/ports uses an administrative bearer token over HTTPS, stored locally and applied after restart. The ordinary management API remains unauthenticated.

## Security boundaries and limitations

- Bind to trusted networks only; no public SMTP relay or carrier SMS.
- TLS CA **private key** and imported identity JSON contain secrets; keep outside Git, secure file permissions and restrict filesystem access.
- Imported TLS identity has a local `.previous` backup; recovery and rollback have not been exercised.
- SSE global logs are bounded; clients must reconcile message snapshots on gaps or run changes.
- The current React console does not implement a general-purpose identity or user management system.
- Memory quota checks are currently derived from stored messages and can become expensive at high volume.
- MIME attachment bytes are held in memory, not persisted; binary uploads and large email paths need acceptance testing.
- IMAP, POP3, RCS, Redis, Kafka, multi-instance deployments and fully authenticated public API access are outside the agreed MVP.

## User acceptance and test coverage

Execution is reserved for the project owner. Follow [backlog / acceptance checklist](backlog.md), including TypeScript compilation, npm audit, SMTP and TLS handshake interoperability, MIME attachment roundtrips, SSE reconnections, browser keyboard/mobile navigation and host/port configuration.

**No deployment was performed.**

## Console navigation (22 October 2026)

The header hamburger now opens a page menu (Inboxes, Connections/TLS, Documentation, API); the former second-row top navigation is removed. Inbox sidebar collapse/expand is controlled independently within the sidebar. Relative `.md` links in both the API and Documentation views use `web/src/components/documentation/MarkdownView.tsx` to navigate among localized documents without leaving the React console. Absolute HTTP(S) links remain external. Verify keyboard, mobile and browser navigation during acceptance; no browser test has been run for this change.
