# Docker image and GHCR workflow

CI checks Node 24 and 26, runs tests, TypeScript builds and npm audits. A separate `container.yml` workflow receives successful **push-to-main** CI completions via `workflow_run`, builds a multi-stage Node 26 image and publishes to `ghcr.io/primeiraacademiadev/virtual-inbox`.

The image supports **linux/amd64 and linux/arm64**. Tags `main` and `sha-<full commit SHA>` are published; `latest` is deliberately withheld until an accepted release. A manual `workflow_dispatch` can also build/publish; it does not guarantee the selected commit passed CI and should be limited to maintainers.

## Run locally

```sh
docker build -t virtual-inbox:local .
docker volume create virtual-inbox-data
docker run --rm --name virtual-inbox \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:3443:3443 \
  -p 127.0.0.1:2525:2525 -p 127.0.0.1:2465:2465 \
  -p 127.0.0.1:3001:3001 -p 127.0.0.1:3444:3444 \
  -v virtual-inbox-data:/app/data \
  virtual-inbox:local
```

The image installs OpenSSL so the local CA can be generated in `TLS_MODE=auto`. The public CA can be downloaded from `http://127.0.0.1:3000/tls/ca.pem`; trust it explicitly before using HTTPS. All listeners bind inside the container to `0.0.0.0`, but the example publishes **host loopback only**. Do not publish unauthenticated endpoints to public interfaces.

The `/app/data` volume persists **certificates and network settings**, not messages: inboxes, messages and observer sessions remain in memory and vanish on restart. The runtime runs as non-root `node`. The SMTP and HTTPS services reuse one certificate identity.

The Dockerfile currently uses `npm install` because the repository does **not yet contain lockfiles**. Once lockfiles are created and committed, switch Dockerfile and CI to `npm ci` for reproducibility. Build/test success and GHCR publication are not asserted by this document.

`GITHUB_TOKEN` and `packages: write` are used for publication. Organization GHCR policies may require additional permission/configuration; verify in GitHub Actions before relying on it.
