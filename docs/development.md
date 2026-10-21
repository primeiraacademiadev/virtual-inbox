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
