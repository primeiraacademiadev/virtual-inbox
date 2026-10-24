# Virtual Inbox Test Harness

The harness tests the sandbox as an external HTTP, SMTP and browser client. It does not import the Sandbox to simulate delivery. Unit tests in root `test/` are a separate layer.

## Clean setup

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm ci --prefix testing --ignore-scripts
node testing/node_modules/@playwright/test/cli.js install chromium
npm run build
```

All three packages have committed lockfiles. Do not replace `npm ci` with an unpinned install in CI. ESLint is not required.

## Managed execution

```sh
npm test
npm run test:integration
npm run test:e2e
npm run test:all
```

`test:integration` runs network scenarios; `test:e2e` runs Chromium scenarios; `test:all` runs both (not the root unit tests). The launcher starts compiled code on alternate ports with temporary certificates, settings and a test-only admin token. It removes temporary data at shutdown. Shared global-quota and TLS-mutating scenarios run with one worker. Never run destructive tests against shared data.

## Attached execution

The testing package can target an existing service using `VI_TEST_PROFILE`, `VI_BASE_URL`, `VI_BROWSER_URL`, `VI_SMTP_HOST`, `VI_SMTP_PORT`, `VI_SMTPS_PORT`, `VI_TEST_CA_FILE` and `VI_TLS_SERVERNAME`. Local API defaults use HTTP. STARTTLS and SMTPS require an explicit CA file and retain certificate verification. Managed-only scenarios intentionally reject attached mode: select only compatible tests rather than setting a false managed flag.

## Reports and contracts

HTML/JUnit/traces are generated under `testing/reports/` and published as CI artifacts. They must not be committed. Screenshots, traces and logs may contain captured test data: use synthetic messages and review artifacts before sharing. Never include tokens or private keys.

`npm run build:openapi` generates management/demo OpenAPI in `docs/` and the console reference. Unit tests check route/handler agreement and schema references; HTTP scenarios check that the running service returns those contracts. Keep behavioral tests alongside metadata checks.

The Docker smoke job is separate from the process-based harness. It validates actual image startup, HTTP health and SMTP greeting; it is not a full browser/SMTP TLS matrix against Docker.
