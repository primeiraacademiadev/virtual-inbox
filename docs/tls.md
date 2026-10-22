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
