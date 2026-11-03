# Code style

Prettier and EditorConfig define the formatting convention: two spaces, semicolons, double quotes, LF and a preferred width of 100. Generated output, reports, dependencies and lockfiles are excluded from bulk formatting.

Prefer descriptive names, early returns and small functions that represent real responsibilities. Keep validation, business decisions and I/O distinguishable. Use stable error codes and never log tokens or private keys. Test behavior and contracts, including negative cases.

Keep formatting-only commits separate from behavior changes. A formatter does not prove behavior preservation: build, unit tests, protocols and browser tests remain required. React effects must clean up resources; extracting components/hooks must preserve UX.

ESLint is deliberately deferred for the selected TypeScript 7 toolchain. Do not bypass peer-dependency validation with force/legacy-peer-deps merely to install a linter. No lint gate is introduced by this PR.
