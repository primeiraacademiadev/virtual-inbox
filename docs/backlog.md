# Delivery status and user validation checklist

## Implemented in source (not yet user-validated)

- Ephemeral email and SMS resources, TTL, orphan capture and observer GUID snapshots
- SMTP input, demo SMTP output, MIME parsing and attachment metadata/binary download
- Message and attachment quotas and configuration environment variables
- Native Node.js HTTPS, STARTTLS and SMTPS, generated local CA or external PEM
- Administrative PEM upload requiring HTTPS and a bearer credential
- React console, live logs, documentation, endpoints, inbox search/create, attachment sending and downloads
- TypeScript client SDK and documentation for automation

## User acceptance (to run at home)

- Install/resolve pinned dependencies, check package version availability, run builds and `npm audit`
- Validate plain SMTP, STARTTLS and implicit SMTPS, including certificate chain/SAN verification
- Validate 20 MiB SMTP limits with multipart MIME and base64 overhead
- Validate attachments with binary content, non-UTF8 bytes and long filenames
- Validate browser console on narrow desktop and touch/mobile viewports
- Validate SSE reconnect/resume, message deduplication and simultaneous observers
- Validate security boundaries: unauthenticated admin upload blocked, HTTP upload blocked, key never returned
- Validate quota enforcement, expired recipient tombstones, aborting waits and process restart

**Not implemented:** IMAP, POP3, Redis, Kafka, multi-node deployment, production authentication for ordinary API access. These are not MVP requirements. No deployment has been performed.

## Current handoff for validation

Source implementing the first five work blocks has been committed to GitHub without running the acceptance checklist, as explicitly requested. Two npm lockfiles and `npm ci` remain dependent on dependency resolution in an environment with registry access. The user will validate builds, TLS/SMTP, browser flows and security at home. Future protocols and public multi-tenant authentication remain out of scope.
