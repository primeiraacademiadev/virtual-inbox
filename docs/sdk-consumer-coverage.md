# SDK consumer coverage matrix — VI-06 / #67

Scope: minimal Node.js SDK for disposable Virtual Inbox integration tests, not an exhaustive admin dashboard or general-purpose OpenAPI client. Source comparison performed against current server route catalogue and `sdk/client.ts`, after the #65 and #66 merges.

| Consumer operation | Server endpoint | SDK | Decision |
| --- | --- | --- | --- |
| Create email/SMS inbox | POST /mailboxes or /phone-numbers | `create` | Already covered |
| Idempotent create | POST /mailboxes with `ifExists` | `create(..., ifExists)` | Already covered |
| Lookup inbox | GET collection?address | `findInbox` | Already covered |
| Delete inbox / clear all messages | DELETE /{inboxId} or /messages | `delete`, `clearMessages`, `withInbox` | Already covered |
| Fetch messages after per-inbox sequence | GET /messages?after | `messages` | Already covered |
| Fetch exact message by ID | GET /messages/{messageId} | `getMessage` | **Added** |
| Delete one message | DELETE /messages/{messageId} | `deleteMessage` | **Added** |
| Wait for matching message / non-observation | POST /wait-for-message | `wait`, `waitOrThrow`, `expectNoMessage` | Already covered |
| Check readiness including 503 | GET /ready | `ready` | **Added**; 503 returns response body, not network error |
| Capabilities and connection info | GET /capabilities, /connection-info | `capabilities`, `connectionInfo` | Already covered |
| SMTP attempts/sessions and client info | GET /admin/smtp/... | `smtpAttempts`, `smtpSessions`, `smtpClients` | Already covered (clients require admin) |
| Synthetic credentials/origin resolve | POST /admin/smtp/resolve | `resolveSmtp` | Already covered |
| SMTP fault rules | POST/GET/DELETE /admin/smtp/reply-rules | `createSmtpRule`, `smtpRules`, `deleteSmtpRule` | Already covered |
| Logs with cursor, filters, missing ranges | GET /logs | `logs` | **Added**; returns `gap`, `reset`, `runId`, missing range |
| SSE observer and streaming log subscriptions | GET /events, /observers | — | **Deferred**; requires a demonstrated continuous-stream consumer, reconnection/cursor design |
| Legacy admin test-session/connection fault listing/deletion | GET/DELETE /admin/test/sessions/.../simulations and /admin/smtp/sessions/.../simulations | Create wrappers exist | **Deferred**; no evidence that consumer needs CRUD beyond current SMTP rule API |
| Full TLS, network, metrics administration | Administrative endpoints | — | **Out of scope** for test runners |
| Send SMTP/SMS | SMTP transport / demo sender API | Consumer SMTP client or demo API | **Out of scope**; do not hide protocol behavior inside SDK |

## Contract considerations

- `LogFilters.after` is a **log cursor**, separate from `messages(inbox, after)`'s per-inbox sequence. This distinction matters for replay gaps.
- SDK uses the existing public read API for `ready`, `logs`, and individual messages. No token is attached. Mutating admin rule operations continue to require HTTPS + `ADMIN_TOKEN`.
- `ready()` maps HTTP 503 to its actual `{ready:false,...}` response; other non-2xx responses still throw `VirtualInboxError`.
- No new server endpoints, storage subsystems, policies or speculative SDK convenience wrappers.
- Tests include HTTP mocking for client request path, encoded IDs, admin/public separation, cursor validation, gap metadata and readiness 503.
- The SDK source version is 0.5.0; publishing to npm remains a separate explicit release step, with OIDC workflow and matching tag.
