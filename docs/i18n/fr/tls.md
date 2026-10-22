# TLS et certificats

HTTPS 3443, SMTP STARTTLS 2525, SMTPS 2465. `TLS_MODE=auto` génère une autorité de développement avec OpenSSL. Téléchargez uniquement le certificat public de l’autorité (`/tls/ca.pem`). L’importation PEM et les changements réseau nécessitent HTTPS et ADMIN_TOKEN et prennent effet après redémarrage.

## Voir aussi

[API](api.md) · [TLS](tls.md) · [SDK](sdk.md)
