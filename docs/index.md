# Virtual Inbox

**An ephemeral email and SMS sandbox for demonstrations, application integration, and automated testing.**

The documentation here is built from the same Markdown sources used by the Virtual Inbox console. No separate documentation content is maintained for the website.

## Select a language

- [English — getting started](i18n/en/overview.md)
- [Português — começar](i18n/pt-PT/overview.md)
- [Français — démarrer](i18n/fr/overview.md)

Each language includes introductory, integration, API, SDK, TLS, architecture, demo and development guides. The detailed engineering reference remains in English where translations are not yet available.

## Essentials

- [Docker setup](docker.md)
- [HTTP API](api.md) and [generated OpenAPI guidance](openapi.md)
- [SMTP and POP3 test identities](test-identities-and-pop3.md), including shared test sessions, fault injection and diagnostics
- [Configuration](configuration.md) and [TLS](tls.md)

## Important security note

Virtual Inbox is a **disposable test tool**, not a production mailbox or authentication service. Message APIs are intentionally unauthenticated. Run it on a trusted test network; protect administrative interfaces and do not expose sandbox data or credentials to untrusted clients.

[View repository](https://github.com/primeiraacademiadev/virtual-inbox)

The hosted website contains documentation only; it does not host a running Virtual Inbox instance.
