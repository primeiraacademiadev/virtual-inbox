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
passwords. Closed connections expire after one hour.

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
