# SMTP integration validation V1-V4 and V7-V9

Status: V1-V4 merged. V7-V9 proposed in a separate PR following real Communication E2E feedback (20/23 cases passed; three findings). Do not deploy automatically.

## V1 SMTP authentication and sessions
Accept arbitrary SMTP test credentials with onAuth. Each SMTP connection has a UUID and records remote address, TLS, authentication attempt metadata, timestamps, messages and errors. Client grouping by IP and authenticated username is observational, not proof of application identity.

Username and password are independently derived with scrypt using random per-value 16-byte salts. Digest and salt remain only in the bounded ephemeral server store, never in REST, SSE or logs. POST /api/admin/smtp/sessions/{sessionId}/verify accepts user and password over HTTPS with ADMIN_TOKEN, checks a recorded attempt and returns match booleans. The console offers an SMTP clients view, history and verification. GET /api/admin/smtp/clients and /api/admin/smtp/sessions are also admin-only over HTTPS.

## V2 Message metadata
Email responses expose MIME headers as an ordered array (including repetitions), the entire SMTP envelope and smtpSessionId. Bcc is derived from RCPT TO even when absent from headers.

## V3 Search
wait-for-message supports match.header with name/valueContains, match.htmlContains, and bodyContains on plain text and raw HTML.

## V4 SMTP errors
Message size errors return SMTP 552; capacity errors return SMTP 452; other unexpected temporary server errors return SMTP 451.

## TLS and limitations
Restrict listener exposure to trusted test networks. Configure NODE_EXTRA_CA_CERTS on SMTP clients for test STARTTLS/SMTPS. Do not disable certificate validation. Data is in memory and lost on restart; session retention is bounded.

## Validation cases
- VI-A00: Communication with SMTP AUTH sends and delivers without EAUTH 535.
- VI-A01: Credential check matches original values and rejects incorrect user/password.
- VI-A02: Distinct TCP connections get distinct sessions; client grouping is consistent.
- VI-A03: Diagnostics inaccessible over HTTP or without valid HTTPS admin token.
- VI-A04: Envelope contains Bcc recipient even where MIME headers do not.
- VI-A05: HTML-only message is located by bodyContains and htmlContains.
- VI-A06: Header search finds X-Message-Id and Reply-To.
- VI-A07: Oversize MIME returns SMTP 552 and permanent error classification.
- VI-A08: Temporary storage failure returns SMTP 451.
- VI-A09: Verified STARTTLS/SMTPS with local test CA.
- VI-A10: Session disconnect and reconnect maintain accurate history.

A code-level diagnosis is not equivalent to successful runtime E2E validation. Confirm Communication retry and DLQ behavior in integration tests.

## V7 STARTTLS diagnostics

The SMTP `onSecure` lifecycle callback updates the existing session after a successful STARTTLS handshake, marking `secure: true`. Implicit SMTPS remains secure from connect. A transport upgrade must not create a second SMTP session or store credentials in logs.

## V8 SDK alignment

`sdk/client.ts` exposes `headers`, `envelope`, `html`, `authUser`, `smtpSessionId`, `decodedFrom`, and `header`/`htmlContains`/HTML-aware `bodyContains` wait filters. `after` is an exclusive message sequence number, not an SSE cursor; HTTP 204 maps to `null`.

## V9 decoded sender

`decodedFrom?: { name: string; address: string }` provides an RFC 2047-decoded sender display name and parsed address. This is **additive**. Preserve the ordered original `headers` values (encoded words included) so tests can assert wire-level MIME as well as readable display names.

## External handoff

Virtual Inbox scope: V7-V9 and tests only. Communication owns classification of connection failures, TLS certificate configuration errors, retry/DLQ policy and the opt-in Vitest N1 suite. Do not start Communication changes until this Virtual Inbox PR is merged into `main` with both CI and E2E gates green. External groups E and F, A06 and observations O1-O4 remain separate verification items.
