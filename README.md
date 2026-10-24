# Virtual Inbox

An ephemeral email/SMS sandbox for demonstrations, application integration and automated tests. One Node.js process serves the React console, REST, SSE, SMTP, STARTTLS and SMTPS. No database, Kubernetes or external certificate executable is required.

> Proprietary source: no licence for redistribution, modification or commercial reuse is granted. Message APIs are intentionally unauthenticated. Run on a trusted test network, never as a public production mailbox.

## Start here

| Purpose | English | Português | Français |
| --- | --- | --- | --- |
| Install and choose a workflow | [Overview](docs/i18n/en/overview.md) | [Começar](docs/i18n/pt-PT/overview.md) | [Démarrer](docs/i18n/fr/overview.md) |
| Try the console | [Demo](docs/i18n/en/demo.md) | [Demonstração](docs/i18n/pt-PT/demo.md) | [Démonstration](docs/i18n/fr/demo.md) |
| Integrate a real application | [Integration](docs/i18n/en/integration.md) | [Integração](docs/i18n/pt-PT/integration.md) | [Intégration](docs/i18n/fr/integration.md) |
| Automate assertions | [Tests](docs/i18n/en/sdk.md) | [Testes](docs/i18n/pt-PT/sdk.md) | [Tests](docs/i18n/fr/sdk.md) |
| Configure certificates | [TLS](docs/i18n/en/tls.md) | [TLS](docs/i18n/pt-PT/tls.md) | [TLS](docs/i18n/fr/tls.md) |

The console renders these same Markdown sources and a generated API reference. There is no independently maintained console manual.

## Standalone: Windows, Linux or macOS

Install Node.js 24 or newer and npm. Run from the repository root:

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm run build
npm start
```

Open `http://127.0.0.1:3000`. HTTPS is also available at `https://localhost:3443`; trust the generated local CA explicitly before using it. Missing `.env` is allowed. Optional development mode is `npm run dev`, which builds the console first. Vite is optional and is not needed to use the application.

Verify installation with `GET /health`, then run `node examples/smtp-roundtrip.mjs plain` in another terminal. The example creates an inbox, sends a real SMTP email with an attachment, verifies its bytes and cleans up.

## Docker

```sh
docker build -t virtual-inbox:local .
docker run --rm --name virtual-inbox -p 127.0.0.1:3000:3000 -p 127.0.0.1:3443:3443 -p 127.0.0.1:2525:2525 -p 127.0.0.1:2465:2465 -p 127.0.0.1:3001:3001 -p 127.0.0.1:3444:3444 -v virtual-inbox-data:/app/data virtual-inbox:local
```

The volume preserves configuration and certificates, **not** inboxes or messages. Publish only the ports needed for your scenario. Other Compose services use the service name, e.g. `virtual-inbox:2525`; host clients use published ports. The container listens on `0.0.0.0`, while these mappings restrict host access to loopback. See [Docker](docs/docker.md).

## Connections

| Service | Default port | Use |
| --- | --- | --- |
| HTTP | 3000 | Console, `/api/*`, same-origin `/demo/*` |
| HTTPS | 3443 | Same routes, plus authenticated administration over TLS |
| Demo HTTP / HTTPS | 3001 / 3444 | External test sender clients: `/sms/messages`, `/mailboxes/{id}/demo-send` |
| SMTP | 2525 | Plain or STARTTLS |
| SMTPS | 2465 | TLS from connection establishment |

Ports are configurable. `GET /api/connection-info` reports the running values. `Host` accepts literal IPs and single-label container names; other domains require the configured hosts or `HTTP_ALLOWED_HOSTS`. Browser origins must be same-origin or explicitly allowed by `HTTP_ALLOWED_ORIGINS` (plus the configured local development origins). These controls do not authenticate clients.

## OpenAPI

`npm run build` generates `docs/openapi.json`, `docs/openapi-demo.json`, static JSON downloads and the console API reference from `src/http/api-contract.ts`. The runtime uses the same route catalogue. The generator fails when a documented operation has no handler, or a handler has no catalogue entry. Request/response schema changes still require updating the catalogue and tests; generation cannot infer business semantics automatically.

Running endpoints: `/api/openapi.json` and `/api/openapi-demo.json`. The main API page excludes demo sending operations; their separate contract remains available from the integration guide. SMTP is documented as a protocol, not misrepresented as an HTTP endpoint. See [OpenAPI maintenance](docs/openapi.md).

## Persistence and limits

Inboxes, messages, attachments, observers and logs are memory-only. Expired/unknown recipients are captured in system anomaly inboxes subject to the same global quotas. A restart clears that data and changes `runId`. Explicitly delete fixtures after tests and handle HTTP `204`, `404`, `413` and `507`. Limits, TTL, identity generation and security controls are documented in [Configuration](docs/configuration.md).

Do not disable certificate verification to work around TLS errors. Private CA keys and server keys must not be committed, included in reports, downloaded to clients or baked into distributed images.
