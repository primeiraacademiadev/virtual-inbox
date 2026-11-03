# SonarQube Cloud and CI

The project uses `primeiraacademiadev_virtual-inbox` in organization `primeiraacademiadev`. `sonar-project.properties` defines sources and LCOV locations. Keep analysis tokens in repository secrets, never in source or reports.

The required check is the actual `SonarCloud Code Analysis` Quality Gate. A successful GitHub job named `SonarQube analysis` may only mean its wrapper completed; inspect the real analysis and commit. If using the Actions scanner, configure `SONAR_TOKEN` and `SONAR_HOST_URL` consistently and avoid conflicting automatic/CI analyses.

Root tests, managed protocols, browser E2E, dependency audits and Docker smoke are distinct checks. Lockfiles are versioned for root/web/testing. Workflows use `npm ci --ignore-scripts`; publishing and analysis actions are pinned to full commit SHAs.

The API intentionally remains open to test clients. HTTP listeners coexist with HTTPS; administrative writes require HTTPS and a bearer token. Accept intentional static-analysis findings only after reviewing the specific data flow and recording the justification. Do not mark genuine vulnerabilities safe merely to obtain a green gate.

Coverage currently comes from `npm run test:coverage`. Do not interpret its percentage as complete application coverage unless unimported source files and managed-process execution are included in that measurement. Passing functional E2E does not itself add LCOV coverage.

Generated OpenAPI and localized API listings come from the runtime catalogue. They do not suppress source analysis or replace tests. ESLint remains deferred for the selected TypeScript toolchain.
