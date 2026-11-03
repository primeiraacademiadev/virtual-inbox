# Virtual Inbox 1.0 RC — consolidation

Single draft PR with thematic commits. Scope: split server.ts by responsibility; survive SMTP/SMTPS/POP3 socket resets; investigate Node 26 Windows SMTPS native crash on Node 24; distinct local CA identities per instance; simulation TCP RST and optional rule TTL; explicit aborted attempts; SDK scoped rule helper and completed attempt polling; pin smtp-server; resolve DV1–DV9, document capabilities; regression tests and six-instance isolation.

## Release process

1. Merge only after internal CI and regression checks.
2. Publish npm 1.0.0-rc.1 using dist-tag next after merge.
3. Communication validates the published RC (not a PR merge gate).
4. Fix release blockers with subsequent RCs if necessary, then publish 1.0.0 with latest tag.

Virtual Inbox stays an ephemeral test sandbox without Kafka, DB or production RBAC. No release publication from this implementation PR.
