# Start here

Virtual Inbox captures real SMTP email and simulated HTTP SMS for tests. It does not deliver mail to the Internet or send SMS through a carrier. Inboxes, messages and observers are ephemeral; restarting clears them. Only configuration and TLS material persist.

## Install standalone

Use Node.js 24+ and npm. In the repository root:

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm run build
npm start
```

Open `http://127.0.0.1:3000`. The same process serves HTTPS at `https://localhost:3443`, SMTP/STARTTLS at `2525` and SMTPS at `2465`. HTTPS requires explicit trust in the local CA. No `.env`, database, Kubernetes or external OpenSSL executable is required. `npm run dev` builds the console then runs the backend in watch mode; Vite is optional.

## Choose a journey

Use [Demo](demo.md) to send and inspect messages manually, [Integration](integration.md) to point another application at the sandbox, [Automated tests](sdk.md) to assert delivery, and [TLS](tls.md) to configure trusted encrypted connections. [API](api.md) contains the generated management reference and OpenAPI download.

## Docker

Build with `docker build -t virtual-inbox:local .`. For a local demonstration:

```sh
docker run --rm --name virtual-inbox -p 127.0.0.1:3000:3000 -p 127.0.0.1:3443:3443 -p 127.0.0.1:2525:2525 -p 127.0.0.1:2465:2465 -v virtual-inbox-data:/app/data virtual-inbox:local
```

The volume preserves certificates/settings, not messages. Within Compose use the service name instead of localhost. Publish additional demo ports only when required. Keep the open API on a trusted network.

## First check and troubleshooting

`GET /api/health` should return `status: ok` and a `runId`. No console: run `npm run build` and refresh. Connection refused: check process, published ports and `/api/connection-info`. Port in use: change the relevant environment variable before starting. A setting apparently ignored may be overridden by persisted network settings; see [TLS](tls.md).
