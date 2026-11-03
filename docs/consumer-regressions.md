# Consumer-driven regression coverage — #69 / VI-08

The Virtual Inbox is an **ephemeral test sandbox**, not the Communication application's retry or delivery service. These tests protect Virtual Inbox contracts reported by its consumers, without importing or permanently coupling the Communication test suite. Use **synthetic data only**, bounded resources, no Kafka/DB/RBAC and no production-oriented guarantees.

## Coverage and ownership

| Consumer observation / failure mode | Virtual Inbox guarantee | Regression coverage | Owner and gate |
| --- | --- | --- | --- |
| One recipient fails RCPT, another remains eligible | RCPT-specific rule matches **only** its selected sender/recipient and decrements `remaining` once; unrelated recipients/clients are unaffected | **VI-R01** in `test/consumer-contract-regressions.test.ts`; existing `test/smtp-reply-rules.test.ts` for conjunctive selectors | VI — fast `npm test`; wire-level SMTP checks in existing managed protocol suite |
| DATA stored but SMTP acknowledgement lost | `AFTER_DATA` drop leaves `persisted:true` and attempt outcome `stored_without_ack`. The client may retry, yielding a different attempt/message ID. VI **does not** deduplicate | **VI-R02** and `test/smtp-attempts.test.ts`; existing SMTP protocol E2E | VI — fast; Communication decides retry/DLQ and handles at-least-once business effects |
| Simultaneous test runners interfere through rules | Context selectors are AND; specific eligible rule wins over global; `remaining` counts only actual applications; independent credentials do not alias | **VI-R03** plus existing precedence/priority/connection tests | VI — fast; tests use fixed synthetic inputs and deterministic interleavings, no clocks |
| SSE/log replay misses older entries after eviction | Monotonic `log_id` per run, stable `id=runId:log_id`, explicit gap or reset and filtration that does not fabricate missing events | **VI-R04**; core replay and REST log-contract tests | VI — fast; managed E2E already checks HTTP log filters |
| Multiple runtime instances accidentally share state | Distinct run IDs and no shared inboxes, sessions, logs, credentials or rule stores | **VI-R05** for independent in-memory sandbox objects; `docs/multiple-instances.md` for real independent processes | VI — fast object-level; real two-process smoke optional/manual, not replicated on every push |
| Reconnect SSE and re-subscribe observer | Live events carry the same IDs as replay; an observer's watched inboxes remain scoped to that observer, though **not** an access-control boundary | **VI-R06** (event emitter and replay, no timers), existing SSE/protocol tests | VI — fast event contract; SSE transport/regression in managed E2E |
| Invalid SMTP phase for selection | A rule may only select attributes available at its SMTP phase | Existing `test/smtp-reply-rules.test.ts` and `test/server-admin-coverage.test.ts` | VI — existing unit and real TCP E2E |
| Session/attempt diagnostics and privileged configuration | Read-only correlated attempts/sessions remain open; admin writes and credential verification require TLS + token | Existing `test/server-admin-coverage.test.ts` and `test/api-contract.test.ts` | VI — existing CI |
| Start/restart readiness or expiry | `/ready` differs from health; TTL and retention are bounded; restart resets `runId` | Existing listener, readiness, SDK and expiration tests | VI — existing CI |
| The Communication consumer reports D1/D2, DLQ/replay policy or job retry | Application-specific behavior is **not** a Virtual Inbox protocol contract | **Not copied into this repository** | Communication — its own unit/N1/N2 gates |

The **VI-R01** store-level regression tests that one RCPT rule does not match other recipients. It does not claim to exercise a full multi-recipient wire transaction; that behavior is covered through SMTP protocol tests and can be strengthened with a focused end-to-end example in #75. **VI-R02** records the invariant for a lost post-DATA ACK and a subsequent retry without claiming transport EOF semantics across operating systems.

## CI vs periodic execution

- **Fast, deterministic:** `npm test` (including `test/consumer-contract-regressions.test.ts`). No external services, third-party repository, fixed ports or `setTimeout`. Run on both supported Node versions in the CI matrix.
- **Existing managed, slower gates:** `npm run test:integration`, `npm run test:e2e` (as configured in CI). These start a disposable Virtual Inbox process, exercise real protocol connections/administrative API, and clean up automatically.
- **Optional/manual real multi-process demonstration:** use `docs/multiple-instances.md` or the #75 demonstrator when implemented. Avoid duplicated slow process orchestration in ordinary unit tests.

**Timeouts:** the new contract tests use synchronous in-memory operations. Existing managed network tests enforce their own deadlines; avoid sleep-based timing assertions except bounded transport delay simulations, which have existing tolerances.

## How to extend this suite

Add a regression only when it has a concrete VI contract, a failing example from a consumer, and a deterministic assertion that would detect a future break. Use a `VI-Rnn` name; add a row to the matrix, classify **fast** vs **managed**, and explicitly state what the case does **not** prove (for example, a DB commit in Communication or a client's TLS library retry policy). The transport-level demonstrator is tracked separately in #75, inbox-targeted rules in #76.
