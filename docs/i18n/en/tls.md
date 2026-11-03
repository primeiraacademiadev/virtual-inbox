# Connections and TLS

HTTP and HTTPS run in parallel. HTTPS is not SMTP: SMTP uses plain/STARTTLS on 2525 and implicit TLS on 2465. One active server identity is shared by HTTPS, demo HTTPS, STARTTLS and SMTPS.

## Automatic local identity

`TLS_MODE=auto` is the default. Startup generates a local CA and a server certificate using Node.js cryptography. No OpenSSL executable is required. The server certificate is valid for 30 days and is regenerated on startup or SAN management when fewer than seven days remain. There is no periodic in-process renewal scheduler. The CA lasts 365 days; plan its replacement and client trust before expiry.

Download the [public CA](/api/tls/ca.pem) and [server certificate](/api/tls/certificate.pem). Verify the CA fingerprint through a trusted channel before trusting it. Prefer a client-specific CA file over installing the root system-wide. In Windows, importing the CA into the current user's Trusted Root Certification Authorities is an explicit trust decision; never import `ca-key.pem`. A local CA is not automatically browser-trusted and is not a public certificate authority.

## Names, addresses and ports

SANs must contain the DNS/IP clients actually use, including a Compose service name when applicable. Names are merged from `TLS_SERVER_NAMES`, `TLS_SERVER_NAMES_FILE`, the console-managed file and `PUBLIC_HOST`. JSON files use `{"dns":["localhost"],"ips":["127.0.0.1","::1"]}`. IPv4-embedded IPv6 is supported; interface scope identifiers such as `%eth0` are rejected. Wildcard listening addresses are excluded.

In Connections and TLS, enter console-managed DNS/IP additions and choose regenerate/apply. This replaces those additions, not environment/file entries, and activates the new certificate without a process restart. Changing a SAN does not change DNS or bind a new address. Network address/port edits require restart.

## Administrative access

Set `ADMIN_TOKEN` in a private `.env` or environment and restart. Access the page over trusted HTTPS and supply the token. Message APIs remain unauthenticated. Never paste private keys into an untrusted service or include them in logs/reports. A valid admin token over HTTP is refused.

## Import or mount an external identity

Console upload sends a PEM certificate chain (leaf first, then intermediates) and matching unencrypted PEM private key. The manager validates dates/key correspondence and activates the identity; invalid material must leave the previous identity active. Uploads persist in the managed data directory and take precedence on restart.

For standalone or Docker mounts set `TLS_MODE=external`, `TLS_CERT_FILE` and `TLS_KEY_FILE`. Mount secret files read-only; do not bake them into the image. Changed files are checked approximately every ten seconds while the external identity is selected. Certificate trust belongs to the clients, not the container image's CA store.

To return from upload to automatic mode, use SAN regeneration in auto mode. To return to an external source, stop the process, back up and remove the managed uploaded-identity selection file, configure external paths and restart. Keep the prior certificate and key for recovery.

## Configuration precedence and diagnosis

Persisted network settings override environment values, then defaults. Startup warns about overridden keys. Back up/edit `network-settings.json` with the process stopped to restore environment control. Volume persistence includes configuration and certificates, not message data.

Name mismatch: correct SAN/servername. Unknown CA: supply the correct public CA. SSL protocol error: check that the port speaks TLS (3443/3444/2465), not plain HTTP/SMTP. `403` on admin: check HTTPS and token. `409` on SAN regeneration: requires auto mode. Do not solve these failures by disabling certificate verification.
