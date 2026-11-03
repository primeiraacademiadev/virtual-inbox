# Architecture and operational limits

The application is one Node.js process. HTTP/HTTPS serve the same console and management API. SMTP/STARTTLS/SMTPS capture email. Auxiliary HTTP listeners capture simulated SMS or submit demo email. All listeners use one in-memory Sandbox.

The Sandbox owns inboxes, messages, attachment bytes, observers, sequence numbers, an event ring and TTL cleanup. The certificate manager owns active TLS identity and listener updates. The HTTP operation catalogue supplies routing and OpenAPI generation. The documentation build uses the same localized Markdown sources as the repository.

Restart clears all message/session state and changes `runId`; do not interpret a new process as a persistent mail store. The filesystem only preserves network settings, certificates and generated documentation. Unknown and expired recipients are redirected to system inboxes, but size/capacity limits can still reject delivery. There is no guarantee that arbitrary incoming traffic is retained under saturation.

Global limits include messages (10000), inboxes (2000 plus system inboxes), observers (500), stored-byte accounting (256 MiB), log entries (2000), complete SMTP MIME (20 MiB), individual attachments (20 MiB), HTTP body (32 MiB), SMS body (64 KiB) and attachment count (20). All are configurable through environment variables; see `.env.example` and the repository configuration reference. Encoded MIME overhead matters.

The HTTP API is intentionally open on a trusted test network. CORS/Host checks reduce browser-origin risks but do not authenticate a direct network client. Keep admin tokens and CA private keys secret. Current observer streams expose global logs; subscriptions do not provide tenant isolation.

The managed test harness exercises real network protocols, while unit tests cover internal logic. A Docker smoke test is separate from the process-based E2E suite. Passing one layer does not certify all deployment environments.
