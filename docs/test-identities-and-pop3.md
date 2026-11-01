# SMTP and POP3 test identities

The Virtual Inbox is a disposable test tool. Credentials are not production accounts. Both
SMTP AUTH and POP3 USER/PASS resolve the same logical test session.

- Create a disposable email inbox through the mailboxes API **before** authenticating.
- Identity = lowercase existing inbox address / username plus password; arbitrary usernames are rejected.
- Each inbox receives one randomly generated 16-byte salt on creation, kept in memory.
- The password digest is derived with scrypt and is not exposed through HTTP, logs or events.
- The same inbox/password pair resolves the same GUID for the lifetime of the inbox.
- Different passwords for the same inbox select different logical sessions.
- Separate SMTP connections still have their own transport-session identifiers.
- Deleting or expiring an inbox removes its identity sessions and their simulation rules.
- SMTP AUTH rejects unknown inboxes with a permanent authentication error (535); POP3 and the admin session API also reject unknown or expired inboxes.
- This login requirement is separate from delivery: an unauthenticated SMTP submission can address an unknown recipient. SMTP `RCPT TO` accepts it and, after successful `DATA`, stores it in `anomalies@sandbox.test` with `captureReason: UNKNOWN_RECIPIENT` (or `EXPIRED_RECIPIENT` for an expired address). This does not create a user inbox. See [Integration](i18n/en/integration.md).

## Technical API

Administrative HTTPS requests require `Authorization: Bearer <ADMIN_TOKEN>`.
Use `POST /api/admin/test/sessions` with JSON `{"username":"case@example.test","password":"secret"}`
to obtain `sessionId` after creating the email inbox. Unknown or expired inboxes result in HTTP 404 (`TEST_INBOX_NOT_FOUND`). Subsequent calls may address the GUID:

- `GET /api/admin/test/sessions/{sessionId}` — resolve the inbox.
- `POST /api/admin/test/sessions/{sessionId}/verify` — verify username/password.
- `POST /api/admin/test/sessions/{sessionId}/simulations` — create a failure rule.
- `GET /api/admin/test/sessions/{sessionId}/simulations` — list rules.
- `DELETE /api/admin/test/sessions/{sessionId}/simulations/{ruleId}` — delete a rule.

A simulation creation body looks like:
```json
{"protocol":"SMTP","command":"DATA","code":451,"message":"Temporary failure","remaining":1}
```
SMTP injection occurs on DATA after the request has been read; POP3 injection targets authenticated
commands such as STAT, RETR or LIST. An unauthenticated connection has no eligible simulation.

## POP3

The plain POP3 listener defaults to port 2110 (override with `POP3_PORT`) and binds to `SMTP_HOST`.
It supports USER, PASS, CAPA, STAT, LIST, UIDL, RETR, TOP, DELE, NOOP, RSET and QUIT.
Use it only on a trusted test network. TLS / POP3S and further end-to-end coverage are follow-up work.

## Diagnostics

The existing SMTP transport-session password verifier is preserved.
The console also offers logical-session credential verification by GUID for SMTP and POP3.

## Connection diagnostics and footprint

SMTP and POP3 keep separate bounded connection histories. The HTTPS administrator
endpoints `GET /api/admin/smtp/sessions` and `GET /api/admin/pop3/connections`
include state, last activity and inbox identity when authenticated, but never
passwords. Closed SMTP connections are retained for up to 24 hours by default, subject to bounded capacity. POP3 history is independent.

`GET /api/admin/footprint` reports process RSS/heap, logical stored payload
bytes, bounded resource counts, connections and last cleanup. Process memory is
not equivalent to stored payload. All these endpoints require HTTPS and
`ADMIN_TOKEN`. The System → Footprint dashboard is read-only, refreshing every
five seconds.

## SMTP connection discovery using @virtual.inbox

The reserved `@virtual.inbox` domain is a **protocol endpoint**, not a normal email domain. Only SMTP delivery creates these mailboxes. To discover the connection UUID, send an SMTP message on the **same connection** to a randomly generated 32-hex-character address such as `d44eaf765b72401cae559febf14f2378@virtual.inbox`. The request must have **exactly one recipient and no Subject header, body text, HTML body, or attachments**. The usual SMTP message transport headers (such as From, Date and Message-ID) may be present. Invalid requests are rejected rather than captured as anomalies.

The first valid request creates the mailbox automatically with a fixed **60-second TTL**. The application generates a JSON response directly in that inbox; the request itself is not stored. The response body contains `protocol: "SMTP"`, `smtpSessionId`, `authenticated` and `secure`. Use `GET /api/mailboxes?address=<address>` to discover the inbox ID, then the existing `POST /api/mailboxes/{inboxId}/wait-for-message` endpoint to obtain its response. Reusing the address while it exists does not extend its TTL. Cleanup deletes the inbox and its responses after expiry (sweep interval approximately one second).

An SMTP connection UUID is **not an access token**. Diagnostic requests and simulation changes require HTTPS plus the admin bearer token. Connection-scoped DATA failure rules are supported at `POST /api/admin/smtp/sessions/{smtpSessionId}/simulations` with `{"command":"DATA","code":451,"message":"Simulated failure","remaining":1}`, and can be listed or deleted at the corresponding endpoint. Only active connections accept new rules; rules are removed on disconnect. This is currently DATA-only; sender/recipient and earlier-phase simulation rules belong to #36. The probe request bypasses simulations so discovery can work reliably.

The SMTP connection must remain open: new connections receive a different `smtpSessionId`. For concurrent test suites, never use guessable short numeric tokens or reuse an address from another suite. Mailbox reads are not individually authenticated in this version, so the random identifier is needed to reduce unintended cross-test disclosure. Do not expose this environment to untrusted networks.

Set `SMTP_AUTH_POLICY=OPEN` to allow arbitrary SMTP AUTH usernames without provisioning an inbox. `INBOX` (the default for backward compatibility) retains the legacy requirement to pre-create a mailbox and returns SMTP 535 otherwise. SMTP connections without AUTH are accepted in both modes (`authOptional: true`). POP3 still authenticates against a real mailbox with its existing credentials/session logic; it is not affected by SMTP OPEN mode.

## SMTP client identity

On startup the server generates a fresh secret salt (256 bits). Successful SMTP AUTH maps a keyed SHA-256 digest of the exact username, password and observed remote IP to a random `clientId` GUID. The digest is private. Connections with an identical triple during this process run share a client GUID; changing credentials or IP, or restarting, changes the grouping. This is a correlation identity, not authentication proof or API authorization. Anonymous SMTP connections are not grouped by IP.

The `@virtual.inbox` response includes `clientId` (`null` for anonymous) and `sessions`: all retained connections of this authenticated client or only the sending connection when anonymous. Entries expose `smtpSessionId`, `connectedAt`, `disconnectedAt`, `connected`, and `current`. Times are UTC ISO 8601. `SMTP_SESSION_HISTORY_HOURS=24` configures retention of closed SMTP connections, subject to bounded store capacity. The 60-second probe mailbox TTL is independent. In OPEN policy the SMTP diagnostic `testSessionId` equals the process-local client GUID; the inbox-based admin test session API remains unchanged.

## SMTP reply simulation — first increment of #36

Authenticated administrators may create targeted SMTP reply rules at `POST /api/admin/smtp/reply-rules`, list them at `GET /api/admin/smtp/reply-rules`, and remove individual rules at `DELETE /api/admin/smtp/reply-rules/{ruleId}`. These endpoints require HTTPS plus `ADMIN_TOKEN`. This is a separate rule collection; older inbox-backed and connection-specific DATA rules remain supported.

Example:

```json
{"phase":"RCPT","action":"reply","code":451,"message":"Temporary recipient failure","remaining":2,"selectors":{"sender":"billing@example.test","recipient":"student@example.test"}}
```

Only phases `MAIL`, `RCPT`, `DATA` and action `reply` are supported in this increment. A valid SMTP reply code is an integer from 400 to 599. `remaining` is an integer between 1 and 10000 and is consumed exactly once per matching phase evaluation. Unsupported phases, actions, unrecognized fields, invalid selectors and unavailable selectors return HTTP 400 with `INVALID_SMTP_SIMULATION`; they never create inert rules. The response exposes the rule ID and its remaining budget.

Selectors may include `sender` (SMTP envelope `MAIL FROM`, **not** MIME From), `recipient` (envelope `RCPT TO`), `clientId` (authenticated credential/IP client GUID), and `smtpSessionId` (individual connection GUID). Multiple selectors are combined with AND. MAIL cannot select a recipient because `RCPT TO` has not happened yet. RCPT evaluates one address at a time; a rejected recipient does not reject the other recipients. DATA evaluates the full accepted recipient list: if any recipient matches, the response rejects the **entire transaction before message persistence**, not just that one recipient. A rule with the same sender and recipient therefore has different scope in RCPT versus DATA. Selectors compare addresses case-insensitively and GUIDs exactly. At equal phase, the rule with more selectors takes precedence, followed by connection, client, sender, and recipient; equal priorities use insertion order. Exhausted rules remain listable until deleted.

Applied rules produce a `smtp.simulation.applied` log event containing `ruleId`, phase, response code, connection, client, sender, relevant recipients, `persisted:false`, and `outcome:rejected`; message content and credentials are not logged. An authenticated client may have several connections; an anonymous connection has a session GUID but no authenticated client GUID. The reserved `@virtual.inbox` discovery request bypasses DATA reply simulations so it can still discover a connection. `CONNECT`, `EHLO`, `AUTH`, `AFTER_DATA` and actions `delay`, `drop`, `hang` are deliberately **not** implemented in this increment and will be addressed separately.

## Transport fault simulation (#36, second increment)

The existing admin route `/api/admin/smtp/reply-rules` also supports `phase: AFTER_DATA` and `action: delay | drop | hang`, in addition to `reply` for MAIL/RCPT/DATA. Selectors and deterministic precedence are unchanged. `AFTER_DATA` is evaluated only after the complete MIME transaction has been stored for its accepted recipients; a failure there does **not** roll back storage. At DATA, MAIL, and RCPT phases, no message from that transaction has been persisted. An error at AFTER_DATA may trigger an upstream retry and duplicate deliveries, even though the first attempt was saved.

`reply` requires a 4xx/5xx `code` and returns that failure; at AFTER_DATA it returns the error **after storage**. `delay` requires `durationMs` (and may specify an optional 4xx/5xx `code`); without a code it waits then continues normally, with a code it replies with an error after waiting. `drop` immediately closes the underlying SMTP transport and never sends a final reply. `hang` requires `durationMs`, does not reply during the interval, then forcibly closes the transport so the wait is always bounded. `drop` and `hang` must not specify a reply code. Timed actions may not exceed `SMTP_SIMULATION_MAX_DURATION_MS` (default 10000 ms); unsupported combinations yield typed HTTP 400. In-flight waits are cancelled on disconnect. A client that times out before a delayed response may disconnect, in which case no later reply is sent.

A matched action emits `smtp.simulation.applied` with `ruleId`, phase, action, duration, connection/client IDs, sender, recipient(s), `persisted` and outcome. `@virtual.inbox` probes are not subject to these DATA/AFTER_DATA rules. Pre-envelope CONNECT/EHLO/AUTH injection remains outside this increment; those phases cannot select sender or recipient. This is a sandbox fault-injection mechanism, not a reliable production SMTP queue.

## Reserved probe mailbox and pre-creation wait

The entire `@virtual.inbox` domain is reserved: callers **cannot manually create any mailbox** in this domain through the mailboxes API or ordinary Sandbox creation, including malformed/non-probe local parts. Only a valid empty SMTP connection probe to a 32-hex-character nonce address may create one, with a fixed 60-second TTL. A second probe does not renew the TTL.

A consumer may start **before** the SMTP message arrives:

```http
POST /api/connection-probes/wait-for-message
Content-Type: application/json

{"address":"d44eaf765b72401cae559febf14f2378@virtual.inbox","timeoutMs":60000}
```

This long-poll is **exclusive to reserved probe addresses** and accepts an optional nonnegative `after` message sequence. A matching message yields HTTP 200 with the existing Message JSON. HTTP 204 means timeout, inbox expiry/removal, or request cancellation. Invalid addresses/timeout/cursors yield HTTP 400. Requests may wait before the inbox exists, but never create it, extend its TTL, or extend the waiting period. Wait time is capped at 60 seconds from the API request; for an already existing inbox, it also ends no later than that inbox's expiry. Pending waits are limited by `MAX_OBSERVER_COUNT`. The conventional `POST /api/mailboxes/{inboxId}/wait-for-message` is unchanged and still requires an existing inbox ID.

A 128-bit random local part should be generated per test. This endpoint is a sandbox feature on a trusted network; the unpredictable address reduces cross-test disclosure but is not an authentication credential.
