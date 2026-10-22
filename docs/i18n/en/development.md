# Development

Project layout and maintenance workflow.

## Structure

`src/core.ts`: domain. `src/server.ts`: HTTP, SMTP and TLS. `src/config.ts`: limits. `web/src`: console. `web/src/i18n`: localization. `web/src/search`: search. `sdk/client.ts`: testing.

## Validation

Run `npm test`, `npm run build`, `npm run build:console` and npm audits in the acceptance environment. Lockfiles and TLS interoperability still need verification.

---

[Management API](api.md) · [TLS](tls.md) · [SDK](sdk.md)
