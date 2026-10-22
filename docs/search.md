# Local documentation search

## Boundary

The search feature is intentionally isolated from application domain logic and from the Node REST/SMTP server.

| Module | Responsibility |
| --- | --- |
| `scripts/build-doc-search.mjs` | Generates JSON index of Markdown headings and section text during frontend dev/build |
| `web/src/search/engine.ts` | Pure normalization, aliases, scoring, ranking and snippets |
| `web/src/search/DocumentSearch.tsx` | Independent accessible search input, scope filters, keyboard handling and results |
| `web/src/search/search.css` | Search-only presentation |
| `web/src/App.tsx` | Supplies `onNavigate`; opens chosen document and scrolls to heading |

The `sync-docs.mjs` pipeline synchronizes Markdown and generates `web/public/wiki/search-index.json`. The index is regenerated on frontend `predev` and `prebuild`, not at runtime. No remote search service, database, extra npm dependency or API route is needed.

## UX

Search appears in **Documentação** and **API**, with `Ctrl+K` / `Cmd+K`, arrow navigation, Enter to open and Escape to close. Four scopes: Tudo, Guias, API, Configuração. Clicking a result opens the relevant document and scrolls to its heading with a short visual outline. Results show section, source guide and excerpt.

The index uses the curated API content visible in the console, **not** the larger engineering API guide containing demo-route explanations. Alias matching is deterministic (SSL/TLS, anexos/attachments, SMTP, SMS, etc.); it is not AI or fuzzy typo correction.

## Limits and follow-up

This implementation is **source-only and unvalidated**, in keeping with the owner's plan to run validation at home. Index generation, TypeScript compilation, browser keyboard/focus behavior, long-document scrolling and small-screen placement still need acceptance checks. New documentation headings are indexed at the next frontend build.

To extend synonyms, edit only `web/src/search/engine.ts`; to add documents, edit only `scripts/build-doc-search.mjs` and `scripts/sync-docs.mjs`.

## Multilingual indexes

For every frontend build, `scripts/sync-docs.mjs` copies independently editable Markdown from `docs/i18n/pt-PT`, `docs/i18n/en`, and `docs/i18n/fr`. The indexer writes `/wiki/<locale>/search-index.json` for each language. The React search component loads only the selected language's index; the engine uses per-language search aliases. Logical document IDs remain invariant when users change the console language. The original root `/wiki/search-index.json` path is obsolete.
