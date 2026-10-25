# SonarCloud Quality Gate — main branch baseline and frontend coverage

## 2026-10-25 diagnosis

GitHub Actions analysed commit `3de08cc6` successfully and imported backend LCOV, but the main-branch quality gate failed. The SonarCloud API returned:

| Main-branch metric | Observed | Required |
| --- | ---: | ---: |
| Coverage on new code | 65.0% | >=80% |
| Duplicated lines on new code | 10.0% | <=3% |
| New lines | 4,757 | n/a |
| Lines to cover | 1,979 | n/a |
| Uncovered lines | 758 | n/a |
| Duplicated lines | 475 | n/a |

A PR may pass while main fails because PR new code is measured against the target branch, whereas main uses the project's new-code definition.

### Duplications

All 475 duplicated lines were attributed to `web/src/i18n/catalog.ts`, which consists of large declarative Portuguese, English and French dictionaries with intentionally repeated keys and structure. `sonar.cpd.exclusions=web/src/i18n/catalog.ts` disables *only duplicate-block detection* for this file. It remains in source scanning, issue inspection and coverage calculations. Do not use `sonar.exclusions` for this purpose.

### Coverage

`npm run test:coverage` generates `coverage/lcov.info` from the Node tests. The React frontend in `web/src` has no LCOV data; running Playwright E2E does not automatically generate line coverage. On main:

- `web/src/App.tsx`: 255 uncovered lines.
- `web/src/search/DocumentSearch.tsx`: 36 uncovered lines.
- `web/src/api.ts`: 32 uncovered lines.
- `src/smtp-sessions.ts`: 5 uncovered lines, with approximately 97% line coverage.

Frontend test coverage must be instrumented and combined with backend LCOV before scanning. Recommended delivery: add component tests for the React workspace and UI state, add integration coverage for the API/search, and use an LCOV-producing tool on the actual frontend code. Preserve the 80% quality gate. Do not exclude React source files merely to turn the gate green.

### Baseline review (explicit decision required)

The current main analysis classifies 4,757 lines as new although the merged PR #16's scope was much smaller. Verify the project's `New Code` definition in SonarCloud Administration before modifying it. If these lines belong to an initial project import, record and explicitly approve a stable adoption baseline rather than relying on a rolling period. Baseline changes affect which code is measured and must never silently conceal technical debt. Overall coverage and duplication should remain visible and addressed over time.

## Verification gates

1. CI Node 24/26 and managed E2E green.
2. SonarCloud scan and Quality Gate actually execute (no skipped job).
3. Inspect main-branch `new_coverage` and `new_duplicated_lines_density` after the next analysis.
4. Main Quality Gate green on the agreed baseline, without relaxing thresholds or excluding executable UI code.
5. Container publication succeeds only after CI success.

Do not deploy from this document.
