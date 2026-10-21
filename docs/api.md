# REST and SSE API

Base URL: `http://127.0.0.1:3000`. All JSON POST requests use `Content-Type: application/json`.

## Recipient lifecycle

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /mailboxes | Create email inbox: `{address?,ttlSeconds?,observerId?}` |
| POST | /phone-numbers | Create SMS inbox: `{phoneNumber?,ttlSeconds?,observerId?}` |
| GET | /mailboxes, /phone-numbers | List resources, including system anomaly inboxes |
| GET | /mailboxes/:id, /phone-numbers/:id | Read one |
| DELETE | /mailboxes/:id, /phone-numbers/:id | Delete resource and messages |
| GET | /mailboxes/:id/messages | List messages |
| GET | /phone-numbers/:id/messages | List messages |
| GET | /mailboxes/:id/messages/:messageId | Read one message |
| DELETE | /mailboxes/:id/messages/:messageId | Delete one message |
| DELETE | /phone-numbers/:id/messages/:messageId | Delete one message |
| DELETE | /mailboxes/:id/messages | Delete all messages |
| DELETE | /phone-numbers/:id/messages | Delete all messages |

`ttlSeconds` defaults to 1800 (30 min) and is capped at 604800 (7 days).

## Delivery

- **SMTP:** send to port 2525; the adapter parses MIME with postal-mime.
- **SMS:** `POST /sms/messages`, `{"from":"+351911111111","to":"+351922222222","body":"Hi"}`.
- **Demo email:** `POST /mailboxes/:id/demo-send`, `{"from":"demo@sandbox.test","subject":"Hello","body":"Hi"}`. Sends using localhost SMTP, returns 202.
- Invalid or expired recipients route to the default anomaly inbox of their channel. No real SMS delivery exists.

## Wait API

`POST /mailboxes/:id/wait-for-message` or `POST /phone-numbers/:id/wait-for-message`

```json
{"after":0,"timeoutMs":10000,"match":{"from":"sender@example.test","subjectContains":"OTP","bodyContains":"Code"}}
```

`after` is a numeric **message sequence**, separate from log SSE cursors. Returns 200 message JSON, 204 on timeout, 404 if the inbox is missing. Timeout maximum 120000 ms. Waits do not delete messages.

## Observer sessions

- `GET /observers/events` SSE creates a GUID and sends `session.initialized`.
- `GET /observers/:guid/events` SSE resumes session, announces `session.restored`.
- `GET /observers/:guid` lists observed inboxes.
- `POST /observers/:guid/inboxes` with `{"inboxId":"..."}` attaches an existing inbox and returns its messages.
- `DELETE /observers/:guid/inboxes/:inboxId` detaches without deleting.
- On creation, providing `observerId` links the new resource in the same server operation.

Observer sessions expire after approximately one hour without activity; reconnecting extends their TTL.

## Events

- `GET /logs` returns in-memory log replay metadata and entries.
- `GET /logs/events` is the global SSE stream.
- `Last-Event-ID` header or `?after=runId:sequence` can request replay.
- An old cursor elicits `log.gap`; a cursor from an earlier run elicits `log.reset`.
- Events have global IDs `runId:sequence`, and are not durable.

Observer SSE emits `log` for global observability and `inbox.notification` for message changes on observed inboxes. Notifications carry message ID and metadata, not the full message body. Fetch the message via REST.

HTTP API is intentionally unauthenticated and should be used only on trusted networks.
