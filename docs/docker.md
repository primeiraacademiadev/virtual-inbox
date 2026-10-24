# Docker and Compose

Docker is optional. Standalone and container deployments use the same Node process and configuration; there is no Kubernetes dependency. Build with `docker build -t virtual-inbox:local .`. The Dockerfile compiles the console and generated OpenAPI, then runs as user `node`.

## Local container

```sh
docker run --rm --name virtual-inbox -p 127.0.0.1:3000:3000 -p 127.0.0.1:3443:3443 -p 127.0.0.1:2525:2525 -p 127.0.0.1:2465:2465 -v virtual-inbox-data:/app/data virtual-inbox:local
```

Open `http://127.0.0.1:3000`; use `/api/health` to confirm readiness. The named volume retains settings and certificates only. Message state is lost when the process restarts. Add 3001/3444 mappings only for clients that use the separate demo listeners; the console uses same-origin `/demo`.

## Compose

```yaml
services:
  virtual-inbox:
    build: .
    ports:
      - "127.0.0.1:3000:3000"
      - "127.0.0.1:3443:3443"
    environment:
      PUBLIC_HOST: virtual-inbox
      TLS_SERVER_NAMES: localhost,127.0.0.1,virtual-inbox
    volumes:
      - inbox-data:/app/data
volumes:
  inbox-data:
```

Other services on the Compose network use `virtual-inbox:2525` for SMTP and `http://virtual-inbox:3000/api` for HTTP. They must not use their own localhost. Add host port mappings for SMTP only when a host application needs them. The service name is accepted by the Host policy, but TLS still requires the name in SAN and trust in the CA.

## Secrets and certificates

Mount PEM files read-only and set `TLS_MODE=external`, `TLS_CERT_FILE`, `TLS_KEY_FILE` for externally issued identities. Keep private keys out of Docker images and build contexts. Copy only the public CA for client trust, e.g. `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`.

Docker does not read a host `.env` into the application automatically; use `--env-file`, `-e` or Compose environment configuration. Persisted network settings can override those environment values, with a startup warning. See [Configuration](configuration.md) and [TLS](i18n/en/tls.md).

## Validation scope

The CI docker-smoke job builds and starts the actual image, checks HTTP health and the SMTP greeting, then removes the container. The managed protocol/browser suite runs a compiled Node process separately; do not describe the smoke test as full container E2E coverage.
