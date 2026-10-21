# Virtual Inbox

**Disposable email and SMS inboxes for automated testing, manual QA and demos.**

A lightweight Node.js/TypeScript sandbox with a React console. Email arrives through a real local SMTP listener; simulated SMS arrives by HTTP. Inboxes and messages live exclusively in process memory; no database, Redis or Kafka is needed.

## Quick start

Requirements: Node.js 20+ and npm.

```sh
git clone https://github.com/primeiraacademiadev/virtual-inbox.git
cd virtual-inbox
npm install
npm run dev
```

In a second terminal:

```sh
npm install --prefix web
npm run dev:console
```

Open **http://127.0.0.1:5173**. Backend REST on **http://127.0.0.1:3000**, SMTP on **127.0.0.1:2525**.

> No license was intentionally selected. Copyright remains reserved; do not assume permission to redistribute or commercialize the source. Consult the repository owner for licensing.

## Try it in 90 seconds

1. Open the React console. Its first SSE connection receives a GUID session.
2. In **Inboxes — Email**, press **+**. Leave the identifier blank to generate a mailbox, or enter an address. Press the clock button to change TTL.
3. Select the mailbox, press the round **+** in the inbox and send a sample email to itself. The demo uses SMTP, not an in-memory shortcut.
4. View the received email and **Live Logs** below it. Click a sidebar inbox or Live Logs to maximize that pane; click again to return to split view.
5. Repeat with **Inboxes — SMS**. The SMS demo goes through the same HTTP SMS gateway used by applications under test.
6. Try an unknown recipient through the API: the system's anomaly inbox captures it.

## Automated testing example

```sh
curl -s -X POST http://127.0.0.1:3000/mailboxes -H 'content-type: application/json' -d '{"ttlSeconds":300}'
```

Take the returned `id` and `address`, configure the application under test to deliver SMTP to `127.0.0.1:2525`, and await a message:

```sh
curl -s -X POST http://127.0.0.1:3000/mailboxes/INBOX_ID/wait-for-message -H 'content-type: application/json' -d '{"timeoutMs":15000,"match":{"subjectContains":"OTP"}}'
```

The wait returns the message as JSON when found or HTTP 204 on timeout. Reading or waiting never consumes messages.

## Documentation

- [Try manually and demos](docs/demo.md)
- [API usage and examples](docs/api.md)
- [Architecture and events](docs/architecture.md)
- [Developer notes and limitations](docs/development.md)

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3000` | HTTP port |
| `SMTP_HOST` | `127.0.0.1` | SMTP bind address |
| `SMTP_PORT` | `2525` | SMTP port |
| `LOG_CAPACITY` | `2000` | Number of buffered log entries |

## Status

Early MVP implementation. Not a public SMTP relay or a real SMS provider. Data is ephemeral; restarting the process deletes inboxes, observer sessions, messages and logs. Review [known limitations](docs/development.md) before exposing it outside localhost.
