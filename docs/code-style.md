# Code style and readability

## Purpose

Prefer code that communicates intent and is easy to review. Formatting is not a functional change. Keep formatting-only commits separate from refactors and feature work.

## Formatting

- Prettier configuration lives in `.prettierrc.json` and `.editorconfig`; use two spaces, semicolons, double quotes and a 100-character print width.
- Preserve public APIs, route names, event names, payloads, storage semantics and test behavior while formatting.
- Exclude generated output, test reports, third-party dependencies and lockfiles from bulk formatting.
- Use one formatting-only PR, then enable a blocking `format:check` gate **after** the baseline is formatted and formatter dependencies are pinned in the root lockfile.

## TypeScript and Node.js

- Prefer descriptive names, early returns and clear separation of validation, I/O and business decisions.
- Avoid `any` at boundaries; validate incoming HTTP JSON and external data before treating them as typed values.
- Avoid dense one-line branching; extract named helpers only when they represent meaningful concepts.
- Make error handling explicit: stable error codes and useful context without leaking secrets.
- Write tests for behavior and contracts, including adversarial and boundary inputs where security-sensitive.

## React

- Keep components focused on rendering and interaction, extracting stateful behavior into hooks when useful.
- Use the Rules of Hooks and specify effect dependencies deliberately; clean up listeners and subscriptions.
- Prefer typed props and explicit state shapes over `any`.
- Do not silently change UX while reformatting or splitting components.

## Planned tool integration

1. Add pinned Prettier, ESLint, `@eslint/js`, `typescript-eslint` and React Hooks configuration packages to root `devDependencies`, updating `package-lock.json` with the same npm operation.
2. Define `format`, `format:check` and `lint` scripts. Run formatting once without behavioral edits.
3. Verify `npm ci`, builds, unit/protocol/browser tests, and SonarCloud on Node 24/26.
4. Only after baseline is green, enforce `format:check` and `lint` in CI.
5. Decompose `src/server.ts` and `web/src/App.tsx` in separate PRs after tooling settles.

Do not enforce tools before their dependencies and baseline formatting are present: `npm ci` must remain reproducible.
