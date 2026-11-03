# Virtual Inbox — 1.0 Release Candidate consolidation

Status: implementation in progress. This document is a work plan, not evidence of completed fixes.

## Scope and implementation order

1. `refactor(server)`: split `src/server.ts` by responsibility (bootstrap/lifecycle, HTTP API, SMTP/SMTPS/POP3 adapters, TLS, simulation engine, logging and diagnostics). Preserve observable contracts; keep bootstrap small. Avoid new infrastructure.
2. `test(network)` + `fix(network)`: reproduce client reset on SMTP, SMTPS and POP3; fix unhandled socket errors and verify each listener remains operational after repeated resets. Investigate SMTPS premature TLS close on Node 24 separately from the reported Node 26 Windows native crash.
3. `fix(tls)`: make automatically generated CA subject/identity distinct per instance while preserving certificates across restarts where configured. Test a client trusting two CAs at once.
4. `feat(simulation)`: add explicit TCP RST `reset` distinct from FIN `drop`; optional per-rule TTL with bounded lifetime and deterministic expiry, without a database.
5. `fix(attempts)`: distinguish explicit SMTP rejection from connection abandonment without changing outcomes of historic attempts silently; document semantics.
6. `feat(sdk)`: add a scoped `withSmtpRule()` helper with cleanup in `finally`, and await completed SMTP attempt with bounded timeout; add examples and tests.
7. `fix(deps)`: pin `smtp-server` precisely (including lockfile), especially because the EHLO adapter touches private internals.
8. `fix(contract)` + `docs`: resolve DV1–DV9 (environment precedence, phase documentation, multi-instance CA, reset warning, CONNECT/EHLO isolation, POP3_PORT, SDK release claim and capabilities version semantics); synchronize PT/EN/FR docs and contracts.
9. `test(regression)`: run unit, protocol, E2E and multi-instance suites; cover concurrent instances, error injection, cleanup and process survival.
10. `chore(release)`: decide release version based on public API maturity; target `1.0.0-rc.1`, tag as npm `next` after merge; Communication validates published RC; only then publish `1.0.0` under `latest`.

## Release gates

- No new critical known regression; legacy tests still pass.
- Socket resets never terminate the process; new clients can reconnect.
- Refactoring has behavior equivalence evidence.
- Six-instance isolation and CA coexistence covered.
- REST, SDK, SMTP/POP3 and documentation contracts consistent.
- No PostgreSQL/Kafka, production-grade RBAC, or persistent data introduced.
- Consumer Communication validation is **after** RC publication, not a gate for initial PR merge.
- npm release is **not** part of implementation PR CI; requires explicit release step after merge.

## References

Communication × Virtual Inbox retest dated 2026-11-03 (VI commit `4860ada`): LVI-1, LVI-1b, LVI-2, LVI-4, LVI-6, LVI-7, DV1–DV9; internal Conversation decisions on RC → GA.
