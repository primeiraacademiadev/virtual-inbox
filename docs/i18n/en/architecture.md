# Architecture

Single-process modular Node.js and React with ephemeral in-memory state.

## Message flow

SMTP and HTTP SMS adapters receive messages, resolve destinations, store them in memory and emit events. GUID observer sessions and SSE connect the console to observed resources.

## Limits

No database, Redis or Kafka. Restarting clears inboxes, messages and sessions. Certificates and network settings may persist in a volume.

---

[Management API](api.md) · [TLS](tls.md) · [SDK](sdk.md)
