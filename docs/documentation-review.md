# Documentation review — 2026-10-22

## Method

Static cross-check of repository documentation, source contracts in `src/server.ts`, `src/core.ts`, `src/config.ts`, `sdk/client.ts`, and the React/Vite console. This review did **not** run installs, builds, browsers, or protocol tests.

## Changes made

1. Replaced the README's outdated Node 20 prerequisite with Node 24+ and clarified OpenSSL/local HTTPS trust.
2. Separated three journeys with their own first-run instructions: [manual demo](demo.md), [mock integration](integration.md) and [automated tests](sdk.md).
3. Updated SMS sending examples to the **demo listener**, port 3001/3444, rather than the management listener (3000/3443).
4. Rewrote [TLS instructions](tls.md) to reflect automatic local CA, admin upload, managed single-file PEM identity, host/port editing and restart requirements. Removed legacy notes claiming these features were absent.
5. Rewrote [management API reference](api.md) and the curated [console API page](../web/public/docs/api.md). Console endpoint listings exclude demo sender routes.
6. Exposed integration and SDK guides in the console via the canonical Markdown sync process. Added task-first navigation and rendered Markdown with tables.
7. Replaced old developer addenda with a current architecture/operations/limitations statement.

## Personas and remaining ergonomic risks

| Persona | Landing path | Main benefit | Remaining risk |
| --- | --- | --- | --- |
| First-time tester | README → Demo or console Documentation → Experimentar | Guided first email, SMS and inbox interaction | Trusting the local CA for HTTPS is still manual and may block the very first launch |
| Application integrator | README → Integration or Documentation → Integrar | Correct host/port, SMTP TLS modes, SMS HTTP contract and container-localhost warning | No ready-made examples for common Java, .NET, Python and Node SMTP clients |
| Test engineer | README → SDK or Documentation → Automatizar | Scoped setup, wait with filters, assertions and cleanup | SDK isn't published to npm; no tested recipe for CI runners |
| Console reader | In-console task cards and inline Markdown | Chooses goal before technical chapters | Frontend documentation has no full-text search; long chapters can still require scrolling |

## Important limitations to validate

- UI and doc links are source-reviewed, **not browser-tested**. Keyboard, focus, mobile layout and overflow remain acceptance items.
- GitHub Markdown files are synchronized into the console at **frontend dev/build time**, rather than fetched live from a separate GitHub Wiki.
- Internal documentation links are mapped to known guide topics; external files may open their GitHub source page.
- There are no lockfiles in Git, no reported green CI, and the current application has not been run as part of this review.
- Source correctness, SMTP 20 MiB behavior, TLS auto certificates, MIME binary round trips, admin TLS rotation and replay still require owner validation.
