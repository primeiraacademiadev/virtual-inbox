# Development and constraints

## Local workflow

```sh
npm install
npm test
npm run build
npm run dev
```

In a second terminal, run `npm install --prefix web && npm run dev:console`. Run `npm run build:console` to compile production frontend output; it is not yet automatically served from the Node process.

## Testing target

Validate: create; attach observer; SMTP delivery; SMS delivery; wait predicates; non-consuming reads; individual DELETE; resource cascade; TTL; anomaly capture; SSE reconnect with Last-Event-ID; ring-buffer gap/reset; independent observers; browser console manual send; and consistency of badge state.

The repository contains initial Node unit tests in `test/core.test.ts`. Test execution/CI status must be verified separately from the source code. This is not a claim of full integration-test coverage.

## Security and deployment constraints

The server binds HTTP and SMTP to loopback by default. It has **no authentication**; do not expose ports to the public internet without gateway authentication, network restriction, HTTPS and connection/content rate limits. SMTP AUTH is optional and STARTTLS disabled for local testing; **not suitable as a public-facing mail transport**.

No public email or real carrier SMS delivery; no inbound DNS MX configuration. Use your app-under-test's SMTP configuration to point to the sandbox server and use its HTTP SMS adapter.

## Current limitations and follow-up

- Data and sessions disappear on restart.
- TTL is periodic, with an additional expiry check on resource lookup; after the cleanup sweep, recipients are unknown rather than classified as previously expired.
- Bounded circular logs, but message store needs global capacity enforcement before internet exposure.
- SSE replay uses the circular log; snapshots may be necessary on gaps. The browser console additionally refreshes observed inboxes periodically as a recovery mechanism.
- Observer sessions and log subscriptions are designed for one Node process.
- OpenAPI generation, a standalone published SDK, browser E2E, exhaustive SMTP MIME/attachment handling and shared browser read state remain future enhancements.
- IMAP, POP3, JMAP, SMPP, Redis and production-grade auth are not in this MVP.
- Copyright is reserved: no open-source or commercial redistribution rights are granted by this repository.

## Contributing

Before changing core data structures or public API contracts, validate the change with the project owner. Keep components segregated and add regression tests for altered behavior.


## UI and dependency maintenance (22 October 2026)

- Nodemailer upgraded from major 6 to major 10; `@types/nodemailer` removed because the current package includes types. Supported runtime is Node.js 20+.
- SMTP self-send remains a local SMTP transport, with file/URL access disabled for demo messages.
- The inbox's list and message detail scroll independently of the log panel; split view uses constrained flex heights.
- Composing opens an overlay above the inbox/log workspace, with its own scrollable content and accessible sticky actions.
- The collapsed navigation no longer renders a separate clipped plus button: group and inbox actions are exposed contextually on hover or focus.
- Before release, verify keyboard focus navigation and touchscreen access to contextual actions. Tooltip hover alone is insufficient for touchscreen users.
- Regression checks: split-mode inbox scroll with 50+ messages; detail scroll with long MIME text; send form submit and cancel at small viewport heights; collapsed bar with both inbox groups and unread badges; SMTP demo after dependency major upgrade; run `npm audit --omit=dev`.

## Dependency refresh — 22 October 2026

Runtime minimum is Node.js **24**. Node.js **26** is supported as a second CI matrix target. Updated package declarations: `smtp-server ^3.19.23`, `postal-mime ^4.0.11`, `nodemailer ^10.2.0`, `typescript ^7.0.2`, `tsx ^4.23.15`, `@types/node ^24.19.2`, `@types/smtp-server ^3.5.13`, `react/react-dom ^19.3.1`, and `vite ^8.3.0`. React type definitions are aligned to the 19.3 line.

**Validation caveat:** The manifests were updated via GitHub, but no npm install, build, audit or regression test has been executed by this update. The npm registry was not accessible from the execution environment. The repository did not contain lockfiles when the upgrade began.

To complete verification with npm registry access, from the repository root:

```sh
npm install --package-lock=true
npm install --prefix web --package-lock=true
npm test
npm run build
npm run build:console
npm audit --audit-level=high
npm audit --prefix web --audit-level=high
```

Commit both generated `package-lock.json` and `web/package-lock.json`; then replace `npm install` in CI with `npm ci`. Do not use `npm audit fix --force` to bypass failing compatibility tests. Confirm SMTP delivery, MIME parsing, observer reconnection, and console functionality on Node 24 and Node 26.
