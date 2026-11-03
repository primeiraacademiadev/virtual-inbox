# Contract and documentation consistency audit — VI-07 / #68

Audit date: 2026-11-03. Baseline: `main` after #79. This is a **test-only, memory-resident** application. The audit compares ADR-0001, real server routes, OpenAPI, SDK source, and PT/EN/FR guides. It does not introduce a new authorization policy or a production-grade access-control system.

## Findings and decisions

| Documentary claim | Location | Actual behavior / evidence | Decision / correction |
| --- | --- | --- | --- |
| All test inbox/message/global log/SSE reads are observable | ADR-0001 §Decision 1–5; `src/http/api-contract.ts` | Public inbox GET, GET `/logs`, SSE observers and filtered GET SMTP attempts/sessions have no admin security. Other administrative diagnostics (`/admin/smtp/clients`, `/admin/pop3/connections`, `/admin/footprint`, `/admin/test/metrics`) currently **require** admin HTTPS+token even for reads | Preserve present guards pending separate policy decision. Explicitly document current exceptions; do not generalize the word *admin* into blanket permissions on test data |
| Mutating simulations and credential verification require protected transport | ADR-0001 §Decision 5; `adminAllowed`, OpenAPI `admin:true` | Requires **TLS encrypted socket** + bearer `ADMIN_TOKEN`; setting a token alone on HTTP is insufficient | No server change. Maintain per-operation security checks and synthetic input credentials |
| CONNECT, EHLO/HELO and AUTH can be selected | `src/smtp-reply-rules.ts`, docs `smtp-rule-scopes.md` | Rules support `CONNECT`, `EHLO`, `AUTH`, `MAIL`, `RCPT`, `DATA`, `AFTER_DATA` | **Fixed** stale `GET /capabilities` phase list and `SmtpReplyRule` OpenAPI response enum; added contract tests |
| No wildcard: absent selectors match any eligible context | `smtp-rule-scopes.md`, API parser | `{selectors:{}}` or missing selectors = GLOBAL; one or more = SPECIFIC; AND among present fields; SPECIFIC takes precedence regardless of global priority | Keep policy. Input/response OpenAPI enums and tests now aligned. Do **not** add `"*"` support |
| Rule scope is not the client identity | ADR-0001, SMTP rule guide, `SmtpRuleIdentities` | Origin IP, local port, declared EHLO name, presented credentials, and SMTP session are independent contextual dimensions | Keep distinction. `connection.port` is listener port; `remotePort` is ephemeral diagnostic metadata; inbox email/SMS selection still pending #76 |
| Readiness and health are different | `GET /health`, `GET /ready`, SDK `ready()` | Liveness `/health` returns 200; `/ready` returns 503 with a **Readiness JSON body** before configured listeners are bound | **Fixed** OpenAPI 503 response schema, added test; SDK correctly models 503 as `ready:false` |
| API log history is bounded | `src/config.ts`, `src/core.ts` | `MAX_LOG_BUFFER_BYTES` defaults to **10 MiB**; `MAX_LOG_ENTRIES=2000` remains a legacy entry-count fallback for certain programmatic Sandbox consumers; log_id sequential per run | **Fixed** configuration reference, which omitted the byte-bound setting. Use `log_id` for numeric display/ranges, not the `after` replay cursor |
| GET /logs returns one generic object | `src/server.ts` log operation, OpenAPI `Replay`, SDK `logs()` | **Three mutually exclusive modes**: replay (optional `after=runId:sequence`), numeric range (`from` and `to`), and descending pagination (`limit`/`before`). Pagination returns `hasMore`/`nextBefore`, **not** `gap`/`reset` | **Fixed** OpenAPI `LogResponse` union (Replay or LogPage), individual query parameter declarations and SDK type/validation. Corrected PT/EN/FR examples, previously combining `after` and `limit` (HTTP 400) |
| GET /capabilities provides feature detection | `src/server.ts` | Version/shape are advertised separately from SDK npm package version. SMTP feature list was behind server implementation | **Fixed** phases only, preserving existing API schema version; do not tie service `version` to npm SDK SemVer |
| npm SDK versions described as always-current | PT/EN/FR SDK guides | Historical prose repeatedly claimed 0.2.1/0.3.0 was current, though repository source moved to 0.5.0 and npm releases are independent | **Fixed** stale claims. State the source version; refer readers to npm for actual published version, rather than claiming releases were performed |
| SMTP AUTH always accepts arbitrary passwords | `docs/smtp-session-diagnostics.md` old introductory section | Default `SMTP_AUTH_POLICY=INBOX` only authenticates test credentials for existing inboxes; `OPEN` permits arbitrary synthetic credentials | **Fixed** introductory explanation. Retain policy and existing tests |
| Multiple instances are prohibited | Legacy discussions; `docs/multiple-instances.md` | Multiple independent processes supported with unique fixed port assignments, TLS/config paths and isolated in-memory state; common default is one shared instance | No change. Multi-instance behavior is **not** tenant isolation |
| TTL and configuration priorities | `docs/configuration.md`; `src/config.ts`, `src/network-settings.ts` | Explicit env overrides legacy persisted settings, which override defaults; inboxes have default TTL 1800s and maximum 604800s | No change. `PUT /admin/network` requires restart and cannot override an env-owned key |
| Mailbox vs log sequence | `messages(...,after)`, `wait(...,after)`, `logs(...,after)` | Mailbox cursor is a **numeric exclusive per-inbox sequence**. Log replay cursor is **runId:log_id** and may indicate a reset/gap after restart/eviction | **Fixed** SDK log filter shape and examples. Do not convert numeric message cursors into log replay cursors |

## Reference requests (management listener)

These are examples for a local test instance bound to `127.0.0.1:3000`; the management routes are available beneath `/api`. Never send real credentials or production messages.

```bash
# Open, read-only management diagnostics:
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
curl -fsS http://127.0.0.1:3000/api/capabilities

# Log replay: after takes an existing run-scoped event ID from the server.
curl -GfsS http://127.0.0.1:3000/api/logs --data-urlencode 'type=smtp.simulation.applied'

# Pagination is a separate mode; do NOT mix with after/from/to.
curl -GfsS http://127.0.0.1:3000/api/logs --data-urlencode 'limit=50'

# Specific origin rule: all credentials from this origin (no '*' wildcard).
# Admin API needs trusted HTTPS and a valid admin token (example uses a local CA).
curl --cacert ./data/certificates/ca.pem -fsS \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" -H 'Content-Type: application/json' \
  -d '{"phase":"AUTH","action":"reply","code":454,"remaining":3,"selectors":{"origin":{"ip":"127.0.0.1"}}}' \
  https://localhost:3443/api/admin/smtp/reply-rules
```

The `--cacert` file path is the default local TLS directory only; point it to your instance-specific CA if overridden, or use the certificate trust store.

## Deferred / explicit limitations

- **Do not loosen or strengthen admin-read guards** as a silent documentation fix. ADR-0001 guarantees open test-data observability; the protected administrative diagnostic summaries are identified as existing exceptions and require a separate decision if their accessibility is to change.
- **Do not implement new inbox email/SMS fault selectors** here; #76 owns them.
- The SDK does not currently implement all SSE management operations. That is a conscious, documented consumer-driven deferral in `docs/sdk-consumer-coverage.md`.
- The test sandbox has no Kafka/DB/RBAC/tenant system, no permanent log storage, and no guarantee of exact JVM/node process memory footprint.

## Regression gates

- Schema test: input and output phases are identical, readiness exposes JSON body on 503, /logs has both response schemas and individually named parameters.
- SDK tests: replay cursor format `runId:log_id` is preserved; mixing replay and pagination is rejected locally; pagination returns its distinct shape.
- Existing unit tests, TLS/admin guards, SMTP real-client E2E, and MkDocs builds remain authoritative.
