# Virtual Inbox Test Harness

This separate test application exercises the service as an external SMTP/HTTP/browser client.

## Setup

From the repository root:

```sh
npm ci
npm ci --prefix web
npm install --prefix testing
npx --prefix testing playwright install chromium
npm run build
```

The testing package does not yet have a committed lockfile. Generate `testing/package-lock.json` with the installation above and commit it before switching the harness CI to `npm ci`.

## Execution

```sh
npm run test:protocols --prefix testing
npm run test:e2e --prefix testing
npm run test:all --prefix testing
node testing/scripts/run-managed.mjs test:all
```

The first commands use the selected `VI_TEST_PROFILE` (default: local) against an **already running** server. The managed launcher starts a separate compiled server with isolated data, alternative ports and generated CA, then runs Playwright and removes its temporary files. It must never point destructive tests to a shared instance.

The API uses HTTP by default in the local profile for Node test clients. For Playwright browser testing over HTTPS, set `VI_BROWSER_URL=https://127.0.0.1:3443`. Provide `VI_TEST_CA_FILE=.../data/certificates/ca.pem` and `VI_TLS_SERVERNAME=localhost` to verify STARTTLS/SMTPS against the generated CA. The test driver refuses to disable TLS verification as a shortcut.\n\nEnvironment overrides: `VI_BASE_URL`, `VI_SMTP_HOST`, `VI_SMTP_PORT`, `VI_SMTPS_PORT`, `VI_TEST_CA_FILE` and `VI_TLS_SERVERNAME`. SMTP TLS verification uses the local CA if supplied. All SMTP TLS verification tests must run with `VI_TEST_CA_FILE` set; do not disable verification to make them pass.

Reports: `testing/reports/html`, `testing/reports/junit.xml`, `testing/reports/artifacts`. No OTP, private keys or admin tokens should be included in published reports.

## Coverage matrix

SMTP plain, STARTTLS and SMTPS each exercise delivery, MIME binary attachment integrity, and REST wait-for-message. Further suites cover SMS national/E.164 routing, browser navigation and locales, Host/CORS isolation, as well as TLS metadata. Future destructive cases (certificate rotation, listener reload, saturation and expiry) must be marked managed-only and use the guarded test environment.

The tests are independent of `src/core.ts` and use real listeners. `npm test` in the root remains the fast unit/regression suite.
