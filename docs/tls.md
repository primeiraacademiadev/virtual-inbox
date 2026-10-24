# TLS and connections

Use the maintained [TLS guide](i18n/en/tls.md), also rendered by the console. [Português](i18n/pt-PT/tls.md) · [Français](i18n/fr/tls.md). The [configuration reference](configuration.md) lists environment variables, precedence and quotas.

Automatic TLS uses Node.js cryptography, not an external OpenSSL command. Public CA downloads do not include private keys. Certificate replacement is live; listener network changes require restart. Renewal checks run at startup and SAN management, not on a periodic timer.
