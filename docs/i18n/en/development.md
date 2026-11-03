# Build, test and maintain

From a clean checkout install the root, console and test harness using their committed lockfiles:

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm ci --prefix testing --ignore-scripts
node testing/node_modules/@playwright/test/cli.js install chromium
npm run build
npm test
npm run test:all
```

`npm run build` generates OpenAPI, compiles the backend and builds the console. `npm run build:openapi` only regenerates contracts/reference pages. Runtime downloads are `/api/openapi.json` and `/api/openapi-demo.json`. Edit `src/http/api-contract.ts` together with handlers and regression tests; the build rejects an operation missing from either side. JSON Schema descriptions are contracts, not an automatic replacement for input validation.

`npm run dev` runs the backend with a compiled console. Rebuild the console after UI changes, or use optional `npm run dev:console` for Vite HMR. Vite is a development server only; normal use and Docker need one Node process.

Prettier conventions are in `.prettierrc.json` and `.editorconfig`. ESLint is deliberately not added because of the selected TypeScript toolchain. Keep functional changes separate from bulk formatting. Do not commit `node_modules`, `dist`, credentials, CA keys, generated docs copies or test reports.

The console renders `docs/i18n/{pt-PT,en,fr}/` via the documentation build. Update all three languages together. API listings are generated rather than manually translated route copies. Routes and JSON property names remain stable in every language.

Use short-lived branches and Pull Requests. Required checks include the Node build/test/audit matrix, managed E2E, Docker smoke and the actual SonarCloud Quality Gate. A successful wrapper job alone is not proof of a passed quality gate. No deployment or merge is part of a test run.
