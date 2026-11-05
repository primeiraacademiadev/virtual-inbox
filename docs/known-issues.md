# Known issues — upstream SMTP/TLS dependencies

This page distinguishes **Virtual Inbox defects**, which belong to this repository, from **defects in dependencies**. Virtual Inbox remains responsible for making its published test-sandbox release robust; an upstream root cause is not permission to ship a known process crash without a validated mitigation.

## LVI-1b: implicit SMTPS premature close (upstream)

**Tracking:** [Virtual Inbox issue #83](https://github.com/primeiraacademiadev/virtual-inbox/issues/83). **Status:** root cause reproduced in isolation; proposed library patch validated in a separate laboratory copy; **not yet included or validated in the released Virtual Inbox package**.

**Affected integration:** `smtp-server` 3.21.1, implicit SMTPS. A connection may close before the deferred TLS upgrade completes. This is reproducible without Virtual Inbox code on Windows and Linux with Node 24/26.

- **RST:** a peer reset can arrive before `smtp-server` installs an error handler on its raw accepted socket, resulting in an uncaught `ECONNRESET` and process exit.
- **FIN:** `_handleProxy` delays the upgrade; if the socket is already destroyed, `_upgrade` may wrap it with TLS anyway. In `normalizeTLSError`, `tlsSocket.getProtocol()` on that invalid/destroyed TLS socket can trigger a native Node crash (`0xC0000005` on Windows or SIGSEGV on Linux).
- **Node.js independent defect:** a minimal Node-only reproduction of `getProtocol()` on a TLS wrapper around an already destroyed socket crashes. This does not remove the independent `smtp-server` lifecycle error.

**Laboratory evidence supplied by independent investigation (not CI evidence for this branch):** patched library loaded by the actual VI server survived six pre-handshake FIN and six RST cases (12/12); SMTP/TLS subset passed 20/20. The broader suite had 137/141 passing with the same four web-console failures both with and without the patch. These results demonstrate a candidate mitigation, **not** that the PR or release is already fixed.

**Candidate upstream mitigation (to implement and validate in VI):**
1. `_acceptSocket`: register a temporary raw-socket error listener immediately; remove it when responsibility is transferred/released.
2. `_upgrade`: if `socket.destroyed`, abort before constructing a TLS wrapper.
3. `normalizeTLSError`: do not invoke `getProtocol()` on a destroyed TLS socket.

If a patched package is vendored, pin the exact dependency and retain reproducible provenance of the changes. Do not rely on `patch-package` `postinstall`: the CI/Docker installation uses `npm ci --ignore-scripts`. Verify both Docker stages include the patched dependency, and add mandatory FIN/RST plus reconnection tests for supported Node versions.

**Temporary operational guidance while the dependency is unpatched:** do not use a bare TCP connect-and-close as an SMTPS readiness check; use `/api/ready` or a complete TLS handshake. This reduces accidental triggers but does not make the listener safe against other clients.

## Separate Virtual Inbox work

- **POP3** errors on writes/disconnects: handle the socket's `error` events in VI and test that the process stays alive.
- **Plain SMTP** RST: investigate independently, preserve a process-survival regression; do not attribute it to the SMTPS TLS path without evidence.
- **CI and SonarCloud:** failing gates remain Virtual Inbox delivery blockers independent of where the dependency defect originates.

## Future upstream contribution

We may contribute the demonstrated `smtp-server` fix as an upstream PR and submit the minimal Node `getProtocol()` reproducer as a separate issue. **Neither has been submitted by this change.** Keep [#83](https://github.com/primeiraacademiadev/virtual-inbox/issues/83) open to track the VI mitigation and replacement of any vendored patch with an official corrected release. Review upstream contribution later, after stabilizing the VI release.
