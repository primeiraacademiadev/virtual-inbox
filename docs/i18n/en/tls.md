# Connections and TLS

Node.js terminates HTTPS, STARTTLS and SMTPS without an external TLS proxy.

## Ports and modes

HTTPS 3443, SMTP/STARTTLS 2525, SMTPS 2465; HTTP API 3000 and demos 3001/3444. `TLS_MODE=auto` generates a local CA using OpenSSL; `external` loads PEM; `off` disables TLS.

## Certificates and safety

Import the **public** CA certificate into clients, never its private key. The hostname must match a certificate SAN. The console supports importing PEM files and changing advertised addresses, effective after restart.

---

[Management API](api.md) · [TLS](tls.md) · [SDK](sdk.md)
