# TLS, certificates and client connections

**Audience:** developers and administrators setting up trusted local SMTP/HTTPS or bringing their own identity.

## TLS terminates in Node.js

| Listener | Default port | Encryption |
| --- | --- | --- |
| Management and compiled console | 3443 | HTTPS |
| SMTP receiver | 2525 | SMTP, advertises STARTTLS when TLS configured |
| Secure SMTP receiver | 2465 | Implicit TLS (SMTPS) |
| Demo input | 3444 | HTTPS, when TLS configured |
| Local management / demo | 3000 / 3001 | HTTP, loopback by default |

No TLS proxy is required. The same server identity is used for HTTPS, STARTTLS and SMTPS. Listener bind hosts and advertised hostname can be configured separately.

## Choose your certificate mode

**Auto (default):** `TLS_MODE=auto` uses the bundled Node.js certificate generator to generate a development CA and a 30-day server certificate. The CA is retained and the server certificate renewed near expiry. Set `TLS_SERVER_NAMES` to the DNS names/IP addresses that clients actually use *before* generation. Public CA download: `GET /tls/ca.pem`; public server certificate: `GET /tls/certificate.pem`. Both links are in **Ligações e TLS**.

**External:** set `TLS_MODE=external`, `TLS_CERT_FILE=/path/server.pem` and `TLS_KEY_FILE=/path/server-key.pem`. The Node process must have permission to read the private key. Use an externally trusted certificate for public-facing URLs.

**Off:** set `TLS_MODE=off` for trusted local testing only. HTTPS, STARTTLS and SMTPS listeners are not created.

In auto mode, private CA and server keys live under `TLS_CERTIFICATES_DIR` (default `./data/certificates`); this directory is excluded from Git. **Never share the private CA key with a client**.

## Configure clients

Use the host and port displayed in the console's **Ligações e TLS** page. For SMTP STARTTLS, select explicit TLS/STARTTLS on port 2525; for SMTPS, select implicit SSL/TLS on port 2465. The client must trust the certificate chain and use a host matching the certificate SAN. A local CA requires importing the **public** CA certificate into the appropriate client trust store. Do not disable certificate verification as a permanent workaround.

## Import certificates or edit host/port settings

Both administrative operations require a strong `ADMIN_TOKEN` and a working HTTPS connection.

- `PUT /admin/tls` receives a PEM `cert` and `key`, checks that they correspond, and writes a protected managed identity file (`TLS_MANAGED_IDENTITY_FILE`). It does not return the key. A backup copy named `.previous` is retained.
- `PUT /admin/network` stores allowed advertised-host, bind-host and listener-port settings in `NETWORK_SETTINGS_FILE`.
- Both operations respond that **restart is required**. The console exposes these controls under **Ligações e TLS**. There is no PKCS#12 UI import.

Imported identity is stored atomically in one JSON file, taking precedence after restart over `auto` or `external` identity material. Treat that JSON and its backup as private-key secrets.

**Security limits:** ordinary management endpoints are unauthenticated in this MVP. Use loopback or a controlled internal network. For public deployment, add authentication, HTTPS policy and abuse protection.

[Return to integration guide](integration.md) · [API reference](api.md)

## Portable certificate management (October 2026)

The service runs standalone or in any normal Docker container. Kubernetes is not required. All HTTP/HTTPS and SMTP/STARTTLS/SMTPS listeners use one shared active TLS identity.

### Certificate sources

- `TLS_MODE=auto`: generate a private development CA and signed leaf on disk. Leaf lifetime is 30 days; regeneration runs at startup when fewer than 7 days remain or the configured SAN set changes. The CA is local and **is not publicly trusted**.
- `TLS_MODE=external`: supply `TLS_CERT_FILE` and `TLS_KEY_FILE` containing PEM material, e.g. mounted read-only secret files or local paths. The server checks every 10 seconds for changed certificate fingerprint, validates the new certificate/key and changes active listeners without restarting. Invalid replacements are rejected and the existing identity stays active.
- Console upload: supply a PEM certificate chain and corresponding private key under **Connections and TLS** with `ADMIN_TOKEN` over HTTPS. The manager applies the validated identity to HTTP TLS listeners and SMTP TLS contexts immediately, persists the uploaded material under `TLS_MANAGED_IDENTITY_FILE` and returns `restartRequired:false`.

The REST message capture API remains unauthenticated as designed. Certificate upload and SAN regeneration are administrative actions and require an HTTPS bearer token.

### SAN sources

Set `TLS_SERVER_NAMES=localhost,127.0.0.1,demo.example.test` or provide `TLS_SERVER_NAMES_FILE` with JSON:

```json
{"dns":["localhost","demo.example.test"],"ips":["127.0.0.1","::1"]}
```

`PUBLIC_HOST` is also included automatically if suitable. Bind address `0.0.0.0` is excluded. In automatic mode, DNS/IP names can also be entered on the **Connections and TLS** page, then regenerated and activated without restarting. The browser saves those names in `TLS_MANAGED_NAMES_FILE`; the list is combined with configured defaults at startup.

`GET /tls/status` returns the active certificate metadata (source, issuer, subject, SAN, validity and SHA-256 fingerprint), never private-key material.

### Development consoles

The compiled console is served on HTTP 3000 and HTTPS 3443 alongside the main API. The demo API is available on HTTP 3001 and HTTPS 3444. SMTP uses port 2525 with optional STARTTLS and SMTPS uses 2465. Ports are configurable.

Vite is a separate development tool: `npm run dev:console` gives HTTP on port 5173; after starting the backend, `npm run dev:console:https` gives HTTPS on port 5174 using the same generated certificate files. Run both commands in different terminals to have both development endpoints simultaneously.

### Keystore, truststore and public trust

The server identity (private key + leaf + chain) is a logical *keystore* represented by PEM files. The OS image already contains public trusted CA roots for outbound TLS; a separate custom truststore is **not required** for the current inbound services. Secrets or mounts are provider mechanisms, not deployment requirements. A publicly trusted server certificate must be issued for a real domain by a publicly trusted CA; copying public CA certificates into the image cannot make a locally signed server certificate browser-trusted. Never bake private keys into a distributed image.

### Verification

After fetching the latest code, run `npm run build`, `npm test`, `npm run build:console`, and `docker build -t virtual-inbox:local .`. Exercise HTTPS, SMTP STARTTLS, SMTPS and certificate rotation end-to-end. These builds and integration checks have **not yet been executed** for this TLS change.
