# SonarQube integration

The GitHub Actions CI includes a `sonar` job, configured by `sonar-project.properties` at the repository root.

## GitHub repository secrets

Configure these two **Actions repository secrets** in `primeiraacademiadev/virtual-inbox` under Settings → Secrets and variables → Actions:

- `SONAR_HOST_URL`: externally reachable SonarQube base URL (for example `https://sonarqube.example.org`, **not** a localhost or Docker-internal URL when using a GitHub-hosted runner).
- `SONAR_TOKEN`: SonarQube analysis token authorized for the project.

No credentials are committed to the repository. Until both secrets exist, the scan is intentionally skipped and Actions issues a notice.

## SonarQube project

Create a SonarQube project with key `virtual-inbox` (or edit `sonar.projectKey` in `sonar-project.properties`). SonarQube Server must be reachable from a GitHub-hosted runner; for an internal-only server, use an appropriate self-hosted runner or permitted network ingress instead.

The scan runs on pushes and pull requests where secrets are available, with backend sources `src`, React sources `web/src`, and tests under `test`. It generates LCOV coverage through `npm run test:coverage` and checks the Quality Gate. The Quality Gate job is deliberately independent of the dependency audit/build job; neither silently bypasses the other.

**Note:** PR analysis and branch support depend on the SonarQube Server edition. For installations without PR analysis, restrict the scan to `main` in the workflow.

## Local validation

```sh
npm install
npm install --prefix web
npm run test:coverage
npm run build
```

Then inspect `coverage/lcov.info`. The Sonar scanner and Quality Gate require a configured server and token. No real SonarQube scan has been verified at the time of this change.

For SonarQube Cloud, additional organization-level settings are required; this baseline targets SonarQube Server.
