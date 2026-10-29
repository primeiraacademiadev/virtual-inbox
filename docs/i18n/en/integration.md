# Integrate an application

Create an inbox through `POST /api/mailboxes` or `POST /api/phone-numbers`; an empty JSON object requests server-generated defaults. Save both `id` (REST UUID) and `address` (recipient address). Configure the application under test to use the sandbox, trigger its normal workflow, then read or wait for the captured message.

## Email transports

| Transport | Port | Nodemailer options |
| --- | --- | --- |
| Plain SMTP | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS required | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

For TLS, supply the trusted CA and a `servername` that appears in the server certificate SAN. Never set `rejectUnauthorized:false`. SMTP AUTH is optional; when used, its username must be an active email inbox address and its password can be a dummy test value. In Compose, the SMTP hostname is the service name; outside Docker it is the published host/port. Add that hostname to certificate SANs when using TLS.

From a source checkout with the server running:

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls
node examples/smtp-roundtrip.mjs smtps
```

Each example creates an inbox, sends MIME with a binary attachment, waits for delivery, compares SHA-256 and removes its resources. For Docker, copy the public CA first: `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Set `VI_TEST_CA_FILE=./vi-ca.pem` in the environment when running the example with this alternative public CA path. The example deliberately does not accept a CA path as a command-line argument. Copy only the public CA, never the key.

## SMS

There is no real telecom transport. POST JSON `{"from":"test-app","to":"+351912345678","body":"Test message"}` to `/demo/sms/messages` on the main origin, or `/sms/messages` on the demo listener (default 3001/3444). For normal delivery, the destination must match the created number; supported national/international aliases refer to the same inbox. Unknown or expired numbers are accepted into anomalies as described below. `node examples/sms-roundtrip.mjs` runs a complete example.

The [demo OpenAPI contract](/api/openapi-demo.json) documents these auxiliary endpoints. The main API reference intentionally excludes them. Email demo sending returns `202`; simulated SMS capture returns `201`.


## Unknown or expired recipients

**Sending a message does not automatically create an inbox.** By default, Virtual Inbox accepts messages addressed to unregistered or expired email addresses/phone numbers and stores them in that channel's system anomaly inbox rather than silently discarding them.

| Recipient | Email (SMTP/STARTTLS/SMTPS) | SMS (demo API) |
| --- | --- | --- |
| Active inbox | Normal delivery; `250 Accepted` after `DATA` | Normal capture; HTTP `201 Created` |
| Unregistered | `RCPT TO` succeeds; `250 Accepted` after `DATA`; `UNKNOWN_RECIPIENT` capture | HTTP `201 Created`; `UNKNOWN_RECIPIENT` capture |
| Expired | Accepted and captured with `EXPIRED_RECIPIENT` | HTTP `201 Created`; `EXPIRED_RECIPIENT` capture |
| Limits/failures | Acceptance is not guaranteed: e.g. `552` for size, `452` for capacity, or an injected failure | May return `413`, `507` or fail other validation |

System anomaly inboxes are created automatically: `anomalies@sandbox.test` (email) and `+999000000000` (SMS). To inspect captured messages:

1. Call `GET /api/mailboxes` (email) or `GET /api/phone-numbers` (SMS) and find the system inbox (`system: true` and the address above).
2. Use its `id` (UUID) in `GET /api/mailboxes/{id}/messages` or `GET /api/phone-numbers/{id}/messages`.
3. Read `originalRecipient` for the requested destination and `captureReason` (`UNKNOWN_RECIPIENT` or `EXPIRED_RECIPIENT`) for the reason. The logged event is `message.captured`, not `message.received`.

Example of relevant fields in a captured message:

```json
{"originalRecipient":"missing@example.test","captureReason":"UNKNOWN_RECIPIENT"}
```

**Do not confuse delivery with authentication:** `RCPT TO` accepts unknown destinations, but `SMTP AUTH` requires a *username* matching an active email inbox, otherwise it returns `535`. A REST read of a missing inbox UUID can return `404`; that is not the SMTP delivery result. All captures are ephemeral and subject to quotas.

## Boundaries

A successful SMTP transaction indicates acceptance; assert capture through REST as well (in the normal inbox or a system anomaly inbox). Metadata responses omit attachment bytes; download `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}` separately. The SMTP limit covers complete MIME, including encoding overhead. HTTP/SMTP quotas may reject messages instead of retaining them.

CORS affects browser origins, not ordinary Node/SMTP clients. A `421` indicates a rejected Host; a `403` may be Origin or administrative authorization. Configure allowed hosts/origins, not a wildcard exemption. Continue with [Automated tests](sdk.md).

## Communication compatibility and SMTP authentication

Virtual Inbox is a **test-only sandbox**. It advertises SMTP AUTH `PLAIN` and `LOGIN`. Create an email inbox first and use its address as the username; any dummy password identifies a logical test session (the same inbox/password pair resolves to the same GUID while that inbox exists). Unknown or expired usernames are rejected with `535`. Passwords are never logged or stored in plaintext: salted hashes remain in memory, and only `authUser` is attached to captured messages. Unauthenticated delivery still works. This is **not secure access control**: do not expose the SMTP listener to the Internet or an untrusted network. AUTH over plaintext SMTP is deliberately allowed for sandbox-only tests; use STARTTLS/SMTPS for sensitive traffic.

Communication always supplies SMTP credentials. Point it at Virtual Inbox using a previously created email inbox as username and a dummy password. The former `535 Authentication not implemented` failure is fixed, but an unknown username still returns `535`. For Node STARTTLS/SMTPS clients, set `NODE_EXTRA_CA_CERTS=/path/to/vi-ca.pem` **before starting** the Communication process. For Docker, mount the public CA file and use its path inside the container. The connection hostname must match a server certificate SAN. Never set `rejectUnauthorized:false`.

Message list/detail/wait responses now include `headers` (ordered array, duplicates preserved, with lowercase `key`, `originalKey`, and `value`), `envelope: {mailFrom,rcptTo}`, and `authUser` when supplied. Inspect `From` for the display name and `Reply-To`, `Cc`, `X-Message-ID` as received. **Bcc commonly has no MIME header**; verify the envelope `rcptTo` instead. The existing `from` field remains the SMTP envelope sender.

To match HTML and a custom header during wait:

```json
{"timeoutMs":10000,"match":{"bodyContains":"code-123","header":{"name":"X-Message-ID","valueContains":"trace-abc"}}}
```

`bodyContains` searches plain-text body **or raw HTML**; `htmlContains` searches only raw HTML. Header names are case-insensitive and `valueContains` is case-sensitive. Filters are combined with AND. HTML-only messages can have an empty `body`.

MIME/attachment size errors return SMTP **552** (permanent), not 450. Exhausted global storage can return **452** (transient). Map retries and DLQ accordingly. Integration tests exercise AUTH PLAIN/LOGIN across SMTP/STARTTLS/SMTPS, MIME metadata and 552.
