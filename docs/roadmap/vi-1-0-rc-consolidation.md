# Virtual Inbox 1.0 RC — consolidation

Single draft PR with thematic commits. Scope: split server.ts by responsibility; survive SMTP/SMTPS/POP3 socket resets; investigate Node 26 Windows SMTPS native crash on Node 24; distinct local CA identities per instance; simulation TCP RST and optional rule TTL; explicit aborted attempts; SDK scoped rule helper and completed attempt polling; pin smtp-server; resolve DV1–DV9, document capabilities; regression tests and six-instance isolation.

## Release process

1. Merge only after internal CI and regression checks.
2. Publish npm 1.0.0-rc.1 using dist-tag next after merge.
3. Communication validates the published RC (not a PR merge gate).
4. Fix release blockers with subsequent RCs if necessary, then publish 1.0.0 with latest tag.

Virtual Inbox stays an ephemeral test sandbox without Kafka, DB or production RBAC. No release publication from this implementation PR.


## Confirmed cross-platform upstream SMTPS issue

An independent investigation traced both premature SMTPS FIN and RST to `smtp-server` 3.21.1 socket lifecycle handling, with an additional Node.js native `getProtocol()` defect reproducible on Windows and Linux (Node 24 and 26). The candidate three-guard `smtp-server` patch survived 12/12 FIN/RST trials against a real Virtual Inbox process in an **external laboratory copy**, but has not yet been incorporated into or validated by this PR. See [known issues](../known-issues.md) and [#83](https://github.com/primeiraacademiadev/virtual-inbox/issues/83).

Before RC publication, deliver and verify the mitigation within the actual packaged VI, including `npm ci --ignore-scripts` in CI and Docker, and enforce FIN/RST survival tests. Fix POP3 and plain SMTP resets separately. Maintain #83 open to track later replacement by an official upstream release; upstream PR/Node issue contribution is deferred until after stabilizing VI.
