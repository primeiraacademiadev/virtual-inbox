# ADR-0001 — Virtual Inbox is an openly observable test sandbox

- **Status:** Accepted
- **Date:** 2026-11-01
- **Scope:** Virtual Inbox, its REST APIs, SSE streams, console and diagnostic logs
- **Related:** #44, #43, #54

## Context

Virtual Inbox is a disposable email/SMS testing tool. A shared test instance helps test writers understand message delivery, SMTP behavior and injected failures. Previous designs began to treat logs and inbox observation as though they were multi-tenant production data and proposed authorization, protected per-suite streams and security isolation. That complexity does not serve the project's purpose.

## Decision

1. **All test data is observable.** An operator or test client may inspect any test inbox, message, anomaly, event or diagnostic log. In particular, REST and SSE observability have no per-user, per-inbox or per-suite authorization model.
2. **Only synthetic test data may enter Virtual Inbox.** Test authors and integrations are responsible for avoiding real personal, customer, confidential or production data. The system is not a storage or processing environment for real messages.
3. **Filtering is functional, not a security boundary.** Filters and observer subscriptions help select relevant messages/events; they do not grant rights, imply confidentiality or prohibit other clients from accessing other test data. Global streams are permitted.
4. **No production-grade access-control project.** Do not implement RBAC, tenant isolation, per-suite permission systems, privacy-based log redaction, or observer-based authorization in the name of diagnostic security. Do not create a new security model for logs.
5. **Keep existing operational guards distinct.** Existing controls on administrative **writes** (such as the HTTPS admin token for injection/configuration) and TLS/network settings are retained where already required. They are not an authorization model for reading or observing test data.
6. **Keep observability lean.** Log useful event metadata and identifiers; use inbox/message APIs for full message content. Retention, resource limits and configuration exist to keep tests deterministic and manageable, not to provide production compliance guarantees.
7. **Run in a test environment.** Do not advertise Virtual Inbox as a production email/SMS service. A trusted test network remains the intended operating environment.

## Consequences

- Any test can diagnose another test's events in the same instance. This is expected and acceptable.
- Observer-specific filtering is a convenience; do not treat the lack of cross-inbox filtering as a security incident.
- Error and log endpoints must be designed for ease of inspection and correlation, not for confidentiality between suites.
- The event schema, field selection and generic property-driven REST/SSE filters will be settled under #44 separately; this ADR fixes the **trust/visibility policy**, not that schema.
- The observer-isolation premise of PR #54 is superseded by this decision.

## Non-goals

- Authorization for reading inboxes, events, global logs or SSE.
- Multi-tenant security or processing real customer data.
- Security-focused filtering beyond ordinary input validity and operational stability.
