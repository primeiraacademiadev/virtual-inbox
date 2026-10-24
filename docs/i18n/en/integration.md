# Integrate an application

Create an inbox through `POST /api/mailboxes` or `POST /api/phone-numbers`; an empty JSON object requests server-generated defaults. Save both `id` (REST UUID) and `address` (recipient address). Configure the application under test to use the sandbox, trigger its normal workflow, then read or wait for the captured message.

## Email transports

| Transport | Port | Nodemailer options |
| --- | --- | --- |
| Plain SMTP | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS required | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

For TLS, supply the trusted CA and a `servername` that appears in the server certificate SAN. Never set `rejectUnauthorized:false`. SMTP AUTH is optional and accepts dummy credentials. In Compose, the SMTP hostname is the service name; outside Docker it is the published host/port. Add that hostname to certificate SANs when using TLS.

From a source checkout with the server running:

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls
node examples/smtp-roundtrip.mjs smtps
```

Each example creates an inbox, sends MIME with a binary attachment, waits for delivery, compares SHA-256 and removes its resources. For Docker, copy the public CA first: `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Set `VI_TEST_CA_FILE=./vi-ca.pem` in the environment when running the example with this alternative public CA path. The example deliberately does not accept a CA path as a command-line argument. Copy only the public CA, never the key.

## SMS

There is no real telecom transport. POST JSON `{"from":"test-app","to":"+351912345678","body":"Test message"}` to `/demo/sms/messages` on the main origin, or `/sms/messages` on the demo listener (default 3001/3444). The destination must match the created number; supported national/international aliases refer to the same inbox. `node examples/sms-roundtrip.mjs` runs a complete example.

The [demo OpenAPI contract](/api/openapi-demo.json) documents these auxiliary endpoints. The main API reference intentionally excludes them. Email demo sending returns `202`; simulated SMS capture returns `201`.

## Boundaries

A successful SMTP transaction indicates acceptance; assert capture through REST as well. Unknown/expired destinations go to anomaly inboxes. Metadata responses omit attachment bytes; download `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}` separately. The SMTP limit covers complete MIME, including encoding overhead. HTTP/SMTP quotas may reject messages instead of retaining them.

CORS affects browser origins, not ordinary Node/SMTP clients. A `421` indicates a rejected Host; a `403` may be Origin or administrative authorization. Configure allowed hosts/origins, not a wildcard exemption. Continue with [Automated tests](sdk.md).

## Communication compatibility and SMTP authentication

Virtual Inbox is a **test-only sandbox**. It advertises SMTP AUTH `PLAIN` and `LOGIN` and accepts any username/password pair. Only the `authUser` name is retained with the captured message; the password is **never stored or logged**. Unauthenticated delivery still works. AUTH here **does not authenticate or authorize** clients: do not expose the SMTP listener to the Internet or an untrusted network. AUTH over plaintext SMTP is deliberately allowed for sandbox-only tests; use STARTTLS/SMTPS for sensitive traffic.

Communication always supplies SMTP credentials. Point it at Virtual Inbox and use dummy credentials; the previous `535 Authentication not implemented` failure is addressed. For Node STARTTLS/SMTPS clients, set `NODE_EXTRA_CA_CERTS=/path/to/vi-ca.pem` **before starting** the Communication process. For Docker, mount the public CA file and use its path inside the container. The connection hostname must match a server certificate SAN. Never set `rejectUnauthorized:false`.

Message list/detail/wait responses now include `headers` (ordered array, duplicates preserved, with lowercase `key`, `originalKey`, and `value`), `envelope: {mailFrom,rcptTo}`, and `authUser` when supplied. Inspect `From` for the display name and `Reply-To`, `Cc`, `X-Message-ID` as received. **Bcc commonly has no MIME header**; verify the envelope `rcptTo` instead. The existing `from` field remains the SMTP envelope sender.

To match HTML and a custom header during wait:

```json
{"timeoutMs":10000,"match":{"bodyContains":"code-123","header":{"name":"X-Message-ID","valueContains":"trace-abc"}}}
```

`bodyContains` searches plain-text body **or raw HTML**; `htmlContains` searches only raw HTML. Header names are case-insensitive and `valueContains` is case-sensitive. Filters are combined with AND. HTML-only messages can have an empty `body`.

MIME/attachment size errors return SMTP **552** (permanent), not 450. Exhausted global storage can return **452** (transient). Map retries and DLQ accordingly. Integration tests exercise AUTH PLAIN/LOGIN across SMTP/STARTTLS/SMTPS, MIME metadata and 552.
