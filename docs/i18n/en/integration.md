# Integrate an application

Create an inbox through `POST /api/mailboxes` or `POST /api/phone-numbers`; an empty JSON object requests server-generated defaults. Save both `id` (REST UUID) and `address` (recipient address). Configure the application under test to use the sandbox, trigger its normal workflow, then read or wait for the captured message.

## Email transports

| Transport | Port | Nodemailer options |
| --- | --- | --- |
| Plain SMTP | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS required | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

For TLS, supply the trusted CA and a `servername` that appears in the server certificate SAN. Never set `rejectUnauthorized:false`. SMTP authentication is not required. In Compose, the SMTP hostname is the service name; outside Docker it is the published host/port. Add that hostname to certificate SANs when using TLS.

From a source checkout with the server running:

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls data/certificates/ca.pem
node examples/smtp-roundtrip.mjs smtps data/certificates/ca.pem
```

Each example creates an inbox, sends MIME with a binary attachment, waits for delivery, compares SHA-256 and removes its resources. For Docker, copy the public CA first: `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Pass `vi-ca.pem` as the final argument. Only copy the public CA, never the key.

## SMS

There is no real telecom transport. POST JSON `{"from":"test-app","to":"+351912345678","body":"Test message"}` to `/demo/sms/messages` on the main origin, or `/sms/messages` on the demo listener (default 3001/3444). The destination must match the created number; supported national/international aliases refer to the same inbox. `node examples/sms-roundtrip.mjs` runs a complete example.

The [demo OpenAPI contract](/api/openapi-demo.json) documents these auxiliary endpoints. The main API reference intentionally excludes them. Email demo sending returns `202`; simulated SMS capture returns `201`.

## Boundaries

A successful SMTP transaction indicates acceptance; assert capture through REST as well. Unknown/expired destinations go to anomaly inboxes. Metadata responses omit attachment bytes; download `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}` separately. The SMTP limit covers complete MIME, including encoding overhead. HTTP/SMTP quotas may reject messages instead of retaining them.

CORS affects browser origins, not ordinary Node/SMTP clients. A `421` indicates a rejected Host; a `403` may be Origin or administrative authorization. Configure allowed hosts/origins, not a wildcard exemption. Continue with [Automated tests](sdk.md).
