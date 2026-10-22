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

## Localized console and documentation

The console offers **Português (Portugal)** (`pt-PT`), **English** (`en`) and **Français** (`fr`). On first visit the browser's language is used, with English as fallback; a manual choice persists in local storage. The console switches language immediately, and the Documentation and API views load the matching Markdown and search index under `/wiki/<locale>/`. The full legacy technical manuals in `docs/` remain authoritative engineering source material; the localized console guides currently cover the key journeys in a concise format. See [internationalization design and coverage](docs/i18n.md).

For clients using the REST API, errors retain `error` for backward compatibility and also include `errorCode` and `errorParams`. These stable identifiers, HTTP status codes, route names, JSON keys, event types and UUIDs are not translated.

## Configurable recipient generation

When an inbox identifier is left empty, the Node server generates an address using the defaults in `.env.example`. Supported locales are `pt-PT`, `en-US` and `fr-FR`; email strategies include first/last, last/first, three names, random suffix and fully random. Phones use country-specific mobile-number formats ending in `401`, with optional international prefix and a separately selectable synthetic test-data mode. Addresses are retried on collision while the inbox `id` remains a stable UUID.

The browser displays inline controls immediately below the identifier field: locale flag, strategy, SAFE and phone prefix. Settings (but never the identifier) persist per browser tab session and follow a change in console language. See [Identity generation](docs/identity-generation.md).

`GET /identity-generation/options` returns supported locales, strategies and server defaults. For lookup without listing every inbox, `GET /mailboxes?address=...` and `GET /phone-numbers?address=...` return a one-item array or an empty array; national and international forms are matched where the locale profile makes them equivalent.

## Browser origin security

The API deliberately does not require login for local integration tests. To prevent unrelated browser pages from reading captured messages, browser CORS is restricted to same-origin, the local Vite development origins and any origins listed in `HTTP_ALLOWED_ORIGINS`. `Host` is checked against the configured public/bind hostnames, loopback and `HTTP_ALLOWED_HOSTS`. See `.env.example`.

## One-process console and API

Normal operation needs **one Node.js process**, which serves the compiled React console and REST/SSE API on `http://127.0.0.1:3000` and `https://127.0.0.1:3443` (default ports). The demo sender is routed through `/demo/mailboxes/:id/demo-send` and `/demo/sms/messages` **on the same origin as the console**, avoiding cross-port browser CORS. Legacy standalone demo HTTP/HTTPS listeners (3001/3444) remain available for external integration clients.

- `npm run build`: compile backend and console together.
- `npm start`: run compiled backend + console with one Node process.
- `npm run dev`: build console as a pre-step, then run the backend in TypeScript watch mode. Re-run `npm run build:console` to refresh UI assets while developing without Vite.
- `npm run dev:console` / `npm run dev:console:https`: **optional** Vite HMR workflows on 5173/5174; not needed for normal use.

Docker similarly executes the integrated build and runs a single application process. SMTP and demo listeners use additional ports, **not additional application processes**. The frontend and backend share the same TLS identity on the main HTTPS listener.
