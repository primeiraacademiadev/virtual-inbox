# Integrate Virtual Inbox as a communication mock

Use Virtual Inbox to replace real communication services during development, demonstrations and automated tests. It is not a public SMTP relay or a carrier SMS service.

## 1. Configure reachability

By default, the server binds to `127.0.0.1`. From another container or machine, **localhost refers to that machine**, not the Virtual Inbox host. Configure `HOST`, `SMTP_HOST` and `PUBLIC_HOST`, with appropriate network access restrictions. The client hostname must match a certificate SAN entry.

## 2. Connect SMTP

| Transport | Port | Client setting |
| --- | --- | --- |
| SMTP | 2525 | Plain transport only on a trusted network |
| SMTP + STARTTLS | 2525 | TLS upgrade after EHLO |
| SMTPS | 2465 | Implicit TLS |

Create a mailbox through the management API and use the returned `address` as the outbound recipient. For automatic development certificates, trust **only the public CA** from `GET /tls/ca.pem`. Keep TLS hostname verification enabled.

## 3. Replace the SMS provider

The SMS adapter sends to the **demo listener on port 3001**, or 3444 with HTTPS, not to the management listener on 3000.

```sh
curl -X POST http://127.0.0.1:3001/sms/messages \
  -H 'Content-Type: application/json' \
  -d '{"from":"+351911111111","to":"+351900000001","body":"Code: 123456"}'
```

Register the number beforehand using `POST /phone-numbers` on the management API.

## 4. Inspect received messages and attachments

Read `GET /mailboxes/:id/messages` or `GET /phone-numbers/:id/messages`. JSON includes attachment metadata (`id`, `filename`, `contentType`, `size`) but not binary data. Download a file via `GET /mailboxes/:id/messages/:messageId/attachments/:attachmentId`.

## 5. Errors and diagnostics

Errors preserve the legacy `error` field while adding `errorCode` and `errorParams`. Depend on stable codes rather than English prose. SSE event types and identifiers remain unchanged.

The management API is mostly unauthenticated. Restrict it to trusted networks and avoid production personal data.

[Automated testing](sdk.md) · [API reference](api.md) · [TLS](tls.md)
