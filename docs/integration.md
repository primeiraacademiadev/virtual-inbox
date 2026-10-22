# Integrate Virtual Inbox as a communication mock

**Audience:** application engineers replacing a real mail/SMS provider in development, integration tests or QA. No third-party test application is necessary.

## 1. Choose the reachable host

The default bindings are **127.0.0.1**. If your application runs in Docker or on another machine, `localhost` refers to *that application*, not the Virtual Inbox process. Configure `HOST`, `SMTP_HOST` and `PUBLIC_HOST` for a reachable trusted interface; make sure firewall access is restricted. The hostname clients use must match the certificate SAN entries (`TLS_SERVER_NAMES`).

## 2. Point email sending at the SMTP receiver

| Client mode | Default host | Port | Encryption |
| --- | --- | --- | --- |
| Local plain SMTP | localhost | 2525 | Unencrypted only if TLS not required |
| SMTP + STARTTLS | localhost | 2525 | Upgrade after EHLO |
| SMTPS | localhost | 2465 | TLS from connection start |

Use a registered mailbox's `address` as the recipient. The mock receives MIME content but does not relay mail to the internet. Obtain the public CA certificate from `GET /tls/ca.pem` when `TLS_MODE=auto` and install it as a trusted CA in the **client** where required. Never set `rejectUnauthorized:false` as the permanent configuration. Verify `TLS_SERVER_NAMES` against the actual hostname.

## 3. Replace the SMS provider

Configure the SMS adapter in the application to send an HTTP POST **to the separate demo/SMS input listener**, `http://localhost:3001/sms/messages` or (when TLS active) `https://localhost:3444/sms/messages`.

```json
{"from":"+351911111111","to":"+351900000001","body":"Your verification code is 123456"}
```

The SMS endpoint accepts JSON and stores the message under the matching registered phone number. There is no SMPP or real operator connection. The mock deliberately uses the same SMS HTTP endpoint as the console demonstration.

## 4. Create recipients with the management API

```sh
curl -X POST http://127.0.0.1:3000/mailboxes -H 'Content-Type: application/json' -d '{"address":"qa@sandbox.test","ttlSeconds":600}'
curl -X POST http://127.0.0.1:3000/phone-numbers -H 'Content-Type: application/json' -d '{"phoneNumber":"+351900000001","ttlSeconds":600}'
```

Use the resulting resource IDs for message reads. Unknown/expired destinations are captured by the appropriate system inbox. For an automated test, prefer the [TypeScript SDK](sdk.md) and delete test resources in `finally`.

## 5. Read received data and attachments

`GET /mailboxes/:id/messages` returns messages and `attachments` metadata (`id`, `filename`, `contentType`, `size`). Download raw bytes with `GET /mailboxes/:id/messages/:messageId/attachments/:attachmentId`. JSON responses do not include binary buffers or raw MIME. Do not store production personal data or secrets in this mock: storage is in RAM, but the management API is not authenticated.

## Common integration mistakes

- Sending SMS to port **3000** rather than **3001**.
- Pointing SMTP to the application's own `localhost` inside a separate container.
- Using a certificate for `localhost` while clients connect via an IP/hostname absent from its SAN.
- Expecting email delivery through a public MX/domain rather than configuring the application's outbound SMTP.
- Assuming all 20 MiB are available to a binary attachment: MIME/base64 overhead counts in the SMTP message size.

Continue with [API reference](api.md) or [TLS configuration](tls.md).
