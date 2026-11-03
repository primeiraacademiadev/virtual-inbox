# Automate delivery assertions

Use unique inboxes and correlation markers per test. Do not use arbitrary sleeps to guess when a message arrives. REST reads and waits are non-consuming, so independent tests must filter messages and clean up their own resources.

## Reliable sequence

1. POST `/api/mailboxes` with `{"ttlSeconds":180}` and retain `id`/`address`.
2. Start POST `/api/mailboxes/{id}/wait-for-message` with `{"timeoutMs":10000,"match":{"subjectContains":"run-unique-marker"}}`.
3. Trigger the real application workflow, not the console sender when testing that application.
4. Assert HTTP `200`, the expected sender/body and attachment contents. `204` has no JSON body and means no match before timeout or inbox removal.
5. DELETE `/api/mailboxes/{id}` in `finally`.

`after` is an exclusive message sequence number, not an SSE event id. All supplied filters (`from`, `bodyContains`, `htmlContains`, `subjectContains`, `header`) must match. Wait time must be within `MAX_WAIT_TIMEOUT_MS`; `404` means the inbox was already absent/expired. Do not swallow those errors as successful empty results.

See the executable `examples/smtp-roundtrip.mjs` and `examples/sms-roundtrip.mjs`. The optional source SDK lives in `sdk/client.ts`; the direct HTTP contract remains authoritative.

## Observers and SSE

GET `/api/observers/events` opens a stream and first announces `session.initialized` with `observerId` and watched inboxes. POST `/api/observers/{observerId}/inboxes` with `{"inboxId":"UUID"}` to subscribe; the response includes existing messages. Reconnect through `/api/observers/{observerId}/events`; `session.restored` announces the server projection. Register any missing subscriptions again.

Retain the last `log` event id and send `Last-Event-ID` or query `after` for replay. `log.gap` requires reconciling state by REST; `log.reset` indicates a different process run. Notification payloads contain identifiers, not full attachment bytes. Sessions expire independently of inboxes. Current streams include global log events as well as inbox notifications: subscriptions are not an access-control boundary.

## Test the sandbox itself

```sh
npm ci --prefix testing --ignore-scripts
node testing/node_modules/@playwright/test/cli.js install chromium
npm run build
npm test
npm run test:all
```

The managed harness starts a temporary isolated server. TLS rotation and quota tests must not run against a shared installation. Reports are generated under `testing/reports/`; they are not source files. Docker CI currently adds a real-container HTTP/SMTP smoke test; it is not the full browser suite against Docker.
  
## Message metadata and rich filtering

The optional TypeScript SDK `sdk/client.ts` exposes `InboxMessage.headers` (ordered, unfolded raw MIME values), `envelope` (including envelope-only Bcc recipients), `html`, `authUser`, `smtpSessionId` and `decodedFrom` (`name` and `address`). `decodedFrom` is parsed and RFC 2047-decoded; it does not change the original `From` header.

Use `wait(inbox, { header: { name: "X-Message-ID", valueContains: marker }, htmlContains: "code" })`. `bodyContains` matches either text or HTML; `htmlContains` matches HTML only. All conditions are ANDed; `204` maps to `null`. Remember that `after` is a message sequence number, not an SSE event ID.

SMTP session and filtered attempt diagnostics are openly observable on HTTP or HTTPS without `ADMIN_TOKEN`, in accordance with ADR-0001. Credential verification and administrative writes still require HTTPS and `ADMIN_TOKEN`; keep tokens and credential-verification inputs out of test logs. SMTP, STARTTLS and SMTPS retain one session per underlying connection; STARTTLS upgrades that session to `secure: true`.

## Standalone SDK and typed errors

`@virtual-inbox/client` version 0.2.0 is a compiled ESM package. Produce an installable archive with `npm run build --prefix sdk` and `cd sdk && npm pack --dry-run`, then install the `.tgz` in another project without a Virtual Inbox checkout. The SDK is published to npm; use the published release for consumer integration. Future releases follow the SDK release workflow. `VirtualInboxError` preserves HTTP `status`, `errorCode`, `errorParams` and `cause`; `waitOrThrow()` explicitly reports *not observed in the window*, not SMTP rejection. Timeout diagnostics contain only the last five message metadata items from the requested inbox, never global logs or other suites' anomaly inboxes. `wait()` remains non-throwing on HTTP 204. Available helpers include `findInbox`, `clearMessages`, `connectionInfo`, `waitForConnectionProbe`, SMTP sessions and simulation rules. Administrative **write and credential-verification** methods require an explicit HTTPS `adminUrl` and `adminToken`: `new VirtualInboxClient('http://127.0.0.1:3000', {adminUrl:'https://localhost:3443',adminToken:token})`. Never write the token into test logs.

## Negative assertions and SMTP attempt correlation (#39)

`messages(inbox, after)` lists only messages with sequence greater than the exclusive cursor. `expectNoMessage(inbox, {after, forMs, match?})` waits for the entire observation window: a matching message raises `VirtualInboxError` with `UNEXPECTED_MESSAGE`, while non-observation completes normally. **Non-observation never establishes SMTP rejection.** Without administrative credentials, `smtpAttempts({smtpSessionId, sender, recipient, messageId, ruleId})` returns bounded, correlatable attempts; at least one filter is mandatory and filters are ANDed. Outcomes are `in_progress`, `rejected`, `stored_and_acknowledged`, and `stored_without_ack`, with phase, message/rule IDs and persistence state. `stored_and_acknowledged` means the server sent a successful callback, not proof the remote client received it. The store keeps at most 2000 attempts and queries return at most 200; no passwords or message content. Fully structured event filtering and SSE belong to #44.

## Opt-in idempotency and capability discovery (#41)

Duplicate explicit addresses continue to return `409` by default. Supply `ifExists: "return"` to `POST /api/mailboxes` or `POST /api/phone-numbers` to reuse the current inbox (`200`) rather than create another (`201`). The original ID and TTL remain unchanged. Expired addresses are recreated with new IDs; reserved `@virtual.inbox` addresses cannot be provisioned this way. The SDK exposes `create(channel, address, ttlSeconds, "return")`. `GET /api/capabilities` returns software `version`, `schemaVersion`, protocols, effective `smtpAuthPolicy`, idempotent provisioning, and SMTP simulation phases/actions. Query `client.capabilities()` to negotiate features.

## Log retention and sequence (#44 increment)

`MAX_LOG_BUFFER_BYTES` limits the circular event history to 10485760 bytes (10 MiB) by default and requires a positive integer. Oversize events are not retained but still emitted to live subscribers. Each event exposes a per-run increasing `log_id`, while `id=runId:sequence` remains unchanged for SSE compatibility. On missing history `log.gap` includes `missingFrom` and `missingTo`; `log.reset` indicates a new process run. Console history depth is selectable (500, 2000, 5000, 10000) per browser session. Retained event count varies with serialized event size. Synthetic test data only. REST and SSE accept exact-match filters `type`, `inboxId`, `messageId`, `smtpSessionId`, `attemptId`, `sender`, `recipient`, `ruleId` with AND semantics; recipient matches any element of a recipient array. Filtered-out events are not gaps.

## SMTP AUTH simulation and rule scopes (v0.3)

The administrator can `resolveSmtp({credentials:{username,password}, origin:{ip}})` before connecting; either dimension can be omitted, but not both. It returns opaque credential/origin IDs and a tree of **observed** connections, without the password. Use `credentialsId` from the result in `createSmtpRule`, or select an IP without restricting credentials:

```ts
await sdk.createSmtpRule({phase:"AUTH",action:"reply",code:454,remaining:3,
  priority:1,selectors:{origin:{ip:"10.1.1.53"}}});
```

**GLOBAL** rules omit `selectors` or set `{}`; **SPECIFIC** rules have at least one selector. All selectors are **AND**; absent means unrestricted and `"*"` is **not supported**. Eligible SPECIFIC rules always precede GLOBAL; within each scope higher `priority` wins, then earlier insertion. Only one rule is consumed per event. AUTH supports reply codes 400–599; CONNECT/EHLO and inbox/SMS selection are future work. The resolve and rule mutation APIs require administrative HTTPS and token; the SMTP runtime and logs never reveal passwords. [Full behavior and examples](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/smtp-rule-scopes.md).
