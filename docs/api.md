# API reference — management and observation

**Management base:** `http://127.0.0.1:3000` (local) or `https://localhost:3443` when TLS is active. Requests can be sent to the root paths; browser production console uses the `/api` prefix. Content type for JSON requests: `application/json`.

**Important:** sending simulated SMS or a demo email is deliberately **not** available on the management port. Those are the separate **demo/input listener**, port 3001 (HTTP) or 3444 (HTTPS). See [Integration](integration.md).

## Inboxes and messages

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/mailboxes` | Create email inbox: `{address?,ttlSeconds?,observerId?}` |
| POST | `/phone-numbers` | Create SMS number: `{phoneNumber?,ttlSeconds?,observerId?}` |
| GET | `/mailboxes`, `/phone-numbers` | List resources, including system anomaly inboxes |
| GET | `/mailboxes/:id`, `/phone-numbers/:id` | Get a resource |
| DELETE | `/mailboxes/:id`, `/phone-numbers/:id` | Delete resource and stored messages |
| GET | `/:collection/:id/messages` | List messages; collection is `mailboxes` or `phone-numbers` |
| GET | `/:collection/:id/messages/:messageId` | Get one message |
| DELETE | `/:collection/:id/messages/:messageId` | Delete message |
| DELETE | `/:collection/:id/messages` | Clear messages |
| POST | `/:collection/:id/wait-for-message` | Long-poll until matching message or timeout |
| GET | `/mailboxes/:id/messages/:messageId/attachments/:attachmentId` | Download binary attachment |

The default TTL is set by `DEFAULT_INBOX_TTL_SECONDS`; maximum by `MAX_INBOX_TTL_SECONDS`. Ordinary reads do not consume messages.

### Wait request

```json
{"after":0,"timeoutMs":15000,"match":{"from":"sender@example.test","subjectContains":"OTP","bodyContains":"Code"}}
```

Returns **200** and a message, **204** on timeout, **404** for missing inbox. The `after` numeric message sequence is distinct from SSE cursors. Messages include attachment metadata `{id,filename,contentType,size}`; the binary contents and raw MIME are not returned in JSON.

## Observer sessions and events

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/observers/events` | Start SSE and get `session.initialized` (GUID) |
| GET | `/observers/:guid/events` | Resume session, receive `session.restored` |
| GET | `/observers/:guid` | Current observed inboxes |
| POST | `/observers/:guid/inboxes` | Attach inbox: `{inboxId}` |
| DELETE | `/observers/:guid/inboxes/:inboxId` | Detach without deleting |
| GET | `/logs` | Ring buffer and replay metadata |
| GET | `/logs/events` | Global SSE log stream |

SSE IDs are `runId:sequence`; reconnect with `Last-Event-ID` or `?after=...`. `log.gap` indicates missing buffered events; `log.reset` means a different server run. `inbox.notification` is limited to observed inbox message events. Fetch current message state through REST after replay gaps.

## Connection and certificate management

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health and run ID |
| GET | `/connection-info` | Host, listener ports and TLS status |
| GET | `/tls/certificate.pem` | Public server certificate |
| GET | `/tls/ca.pem` | Public local CA certificate (auto mode) |
| PUT | `/admin/tls` | Import PEM pair, HTTPS + ADMIN_TOKEN required |
| PUT | `/admin/network` | Edit network hosts and ports, HTTPS + ADMIN_TOKEN required |

## Separate demo/input listener — not on the management API

For clarity, these are listed **only as a pointer**, not part of the public management endpoint list:

- Email sample sender: POST `/mailboxes/:id/demo-send`
- SMS mock input: POST `/sms/messages`

They run on port 3001/3444. See [Integration](integration.md) for the SMS payload and [Demo](demo.md) for console email composition.

**Security:** management and observation endpoints are not authenticated in the MVP. Keep listener bindings within a trusted environment.
