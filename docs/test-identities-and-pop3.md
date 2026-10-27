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
