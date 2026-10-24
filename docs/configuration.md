# Configuration reference

No `.env` is required for a local start. Copy `.env.example` only when overriding defaults. `npm start` and `npm run dev` read `.env`; Docker requires `-e` or `--env-file` explicitly. Keep credentials and keys out of version control.

## Sources and precedence

Network settings use **persisted settings > process environment > defaults**. `NETWORK_SETTINGS_FILE` defaults to `data/network-settings.json`. Startup warns with the names of environment settings that are overridden. A console network update returns `202` and requires a restart; it does not immediately move listeners. To restore environment control, stop the application, back up the file, remove the relevant keys and restart. Do not remove the certificate directory.

TLS SANs combine `TLS_SERVER_NAMES`, `TLS_SERVER_NAMES_FILE`, console-managed `TLS_MANAGED_NAMES_FILE`, and `PUBLIC_HOST`, with validation and deduplication. Both startup and SAN regeneration use the same resolver. `0.0.0.0` and `::` are listening addresses and are excluded from certificate names. The JSON name files use `{"dns":["localhost"],"ips":["127.0.0.1"]}`. Console updates replace only the console-managed additions; environment/file entries remain.

Uploaded identities override generated/external identity selection across restart. `TLS_MODE=off` disables TLS. See the [TLS guide](i18n/en/tls.md) before replacing or reverting a certificate.

## Network and TLS

Defaults: `HOST=127.0.0.1`, `SMTP_HOST=127.0.0.1`, `PUBLIC_HOST=localhost`, `PORT=3000`, `HTTPS_PORT=3443`, `SMTP_PORT=2525`, `SMTPS_PORT=2465`, `DEMO_PORT=3001`, `DEMO_HTTPS_PORT=3444`. Docker sets the listening hosts to `0.0.0.0`.

`TLS_MODE=auto|external|off`; `TLS_CERTIFICATES_DIR=./data/certificates`; `TLS_SERVER_NAMES=localhost,127.0.0.1`. External PEM identities use `TLS_CERT_FILE` and `TLS_KEY_FILE`. `TLS_MANAGED_IDENTITY_FILE` and `TLS_MANAGED_NAMES_FILE` default to files inside the certificate directory. `ADMIN_TOKEN` enables administrative writes over HTTPS. Public message APIs remain open. `HTTP_ALLOWED_HOSTS` and `HTTP_ALLOWED_ORIGINS` accept comma-separated additions.

## Resource limits

| Variable | Default |
| --- | ---: |
| MAX_SMTP_MESSAGE_BYTES | 20971520 |
| MAX_ATTACHMENT_BYTES | 20971520 |
| MAX_HTTP_BODY_BYTES | 33554432 |
| MAX_SMS_BODY_BYTES | 65536 |
| MAX_MESSAGE_BODY_CHARS | 2097152 |
| MAX_MESSAGE_COUNT | 10000 |
| MAX_STORED_BYTES | 268435456 |
| MAX_LOG_ENTRIES | 2000 |
| DEFAULT_INBOX_TTL_SECONDS | 1800 |
| MAX_INBOX_TTL_SECONDS | 604800 |
| OBSERVER_SESSION_TTL_SECONDS | 3600 |
| MAX_WAIT_TIMEOUT_MS | 120000 |
| MAX_CONNECTIONS | 200 |
| MAX_INBOX_COUNT | 2000 |
| MAX_OBSERVER_COUNT | 500 |
| MAX_ATTACHMENTS_PER_MESSAGE | 20 |

Values must be positive safe integers. A single attachment and the complete MIME message have different limits: base64 and MIME overhead mean a 20 MiB binary attachment may not fit a 20 MiB SMTP message. Quotas are global, including anomaly inbox messages. The stored-byte quota is an application accounting limit, not an exact bound on process RSS. `413` means an item is too large; `507` means capacity has been reached. Delete messages/inboxes or wait for expiry before retrying.

## Identity generation

`IDENTITY_DEFAULT_LOCALE=pt-PT`, `IDENTITY_DEFAULT_EMAIL_STRATEGY=FIRST_LAST`, `IDENTITY_DEFAULT_PHONE_STRATEGY=NATIONAL_FORMAT`, `IDENTITY_DEFAULT_PHONE_INCLUDE_COUNTRY_CODE=true`, `IDENTITY_DEFAULT_SAFE_TEST_DATA=false`, `IDENTITY_DEFAULT_GENERATION_MAX_ATTEMPTS=100`, `IDENTITY_DEFAULT_EMAIL_DOMAIN=sandbox.test`.

Supported locales: `pt-PT`, `en-US`, `fr-FR`. Email strategies: `FIRST_LAST`, `LAST_FIRST`, `FIRST_MIDDLE_LAST`, `FIRST_LAST_SUFFIX`, `RANDOM`. Telephone generation uses national profiles, optional country code and the configured test suffix. Realistic numbers are not guaranteed unallocated: never send them to a real carrier as test data. Query `/api/identity-generation/options` for effective defaults.
