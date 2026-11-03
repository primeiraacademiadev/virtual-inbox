# Documentation maintenance

The operational documentation source is `docs/i18n/{pt-PT,en,fr}`. Repository entry pages link to it; the console build copies it and generates the API page from `src/http/api-contract.ts`. This avoids separate route lists and disconnected console instructions.

Review each change from three perspectives: a first-time user performing the manual demo, an application integrator configuring SMTP/SMS/TLS, and a test author asserting messages and cleaning up. All three must find prerequisites, executable commands, expected output and recovery guidance.

API generation checks route identifiers and schema references during the build. Validate human examples through `examples/`, HTTP contract tests and the browser documentation tests. Keep language variants aligned. Never publish private keys, real OTPs or admin tokens in examples/artifacts.

Claims of successful build, audit, Docker or browser validation must refer to an actual run and commit. Do not retain stale fixed test counts in user guides.
