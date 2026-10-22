# Virtual Inbox

Ephemeral **email and SMS mock server** for manual demonstrations, application integration and automated tests. Node.js 24+ (Node 26 accepted), npm, and **OpenSSL on PATH** when using automatic TLS.

> Source is proprietary (no license granted). Request authorization before distribution, modification or commercial reuse.

## Choose your route

| I want to… | Read first |
| --- | --- |
| Try the console in 5 minutes | [Try the product](docs/demo.md) |
| Point an application at a mock SMTP/SMS provider | [Integrate an application](docs/integration.md) |
| Assert that a message arrived from a test runner | [Automate tests](docs/sdk.md) |
| Configure trusted HTTPS/STARTTLS/SMTPS | [TLS and connection configuration](docs/tls.md) |
| Consult exact REST/SSE methods | [API reference](docs/api.md) |
| Understand implementation and limitations | [Architecture](docs/architecture.md), [Development](docs/development.md) |

## Local start

```sh
git clone https://github.com/primeiraacademiadev/virtual-inbox.git
cd virtual-inbox
npm install
npm install --prefix web
npm run build:console
npm run dev
```

**Default TLS_MODE is `auto`.** The first start invokes OpenSSL to generate a local CA and server identity. Open **https://localhost:3443** after explicitly trusting the local CA in your browser/device (or use the separate Vite development console below). Find the public CA at `http://127.0.0.1:3000/tls/ca.pem`; **never install or distribute the CA private key**. Do not bypass certificate checks on applications under test.

For the Vite development console, run `npm run dev:console` in another terminal, then visit **http://127.0.0.1:5173**. The backend must still be running. Do not expose these local listeners to the internet without access controls.

### Default ports

| Service | Port | Protocol |
| --- | --- | --- |
| Management REST, SSE (local) | 3000 | HTTP |
| Compiled console and management API | 3443 | HTTPS, when TLS enabled |
| Demo sender API | 3001 | HTTP |
| Secure demo sender API | 3444 | HTTPS, when TLS enabled |
| Email receiver | 2525 | SMTP with STARTTLS when TLS enabled |
| Secure email receiver | 2465 | SMTPS, when TLS enabled |
| Vite development console | 5173 | HTTP |

Hosts and ports can be configured; consult [.env.example](.env.example) and [TLS setup](docs/tls.md). The demo sender endpoints are on their **own listeners**; they are not part of the management API.

## Scope and constraints

Inbox, observer, message, attachment and log data are **in-memory only** and disappear at restart. Email is actually received through SMTP, including MIME attachment metadata/binary download. SMS is **simulated via HTTP**, not sent to a carrier. The API is not authenticated except for TLS/network configuration writes; keep it on a trusted network. Limits, TTL and quotas are configurable.

**Validation status:** implementation is published, but compilation, dependency resolution/lockfiles, TLS interoperability, browser E2E and security checks still require validation. See [acceptance checklist](docs/backlog.md).
