# Easy Learn integration map

Use this map when the workspace contains `src/reader` and the Easy Learn workbench. It reflects 0.14.1, not a guarantee that future file names or dependencies are unchanged.

| Concern | Existing integration |
| --- | --- |
| Document imports and text limits | `src/ui/reader-source.ts`, `src/reader/document.ts` |
| PDF hierarchy and page/text mappings | `src/reader/pdf-structure.ts`, `src/core/pdf-navigation.ts` |
| PDF loading, compatibility worker, fonts and decoder paths | `src/ui/pdf-source.ts` |
| Original Canvas / TextLayer and word overlays | `src/ui/reader-pdf.tsx`, `src/ui/reader-pdf.css` |
| Ranked scanning and word state | `src/reader/vocabulary.ts`; existing `vocabularyForms` in `src/content/candidates.ts` |
| Word-list provenance and generation | `public/vocabulary/ATTRIBUTION.md`, `scripts/vocabulary-sources.json`, `scripts/build-vocabulary.mjs` |
| Scheduler, navigation, source lifecycle | `src/ui/reader.tsx`, `src/ui/reader-rpc.ts` |
| Extension and standalone asset packaging | `scripts/build.mjs`, `scripts/build-workbench.mjs` |
| Standalone static MIME / CSP and mockable server | `src/workbench/server.ts` |

Do not duplicate parsers or existing model/cache modules. Keep code annotations default off and CLI explanations independent, as required by project guidance. Importing a reading file and revealing a prepared explanation must not start model requests. Existing model settings and word records should survive a preview update.

Check `tests/reader.test.ts`, `tests/pdf-structure.test.ts`, `tests/pdf-navigation.test.ts` for relevant fixtures. Browser coverage is in `tests/e2e/workbench.spec.ts` and `tests/e2e/extension.spec.ts`; `tests/e2e/pdf-fixture.ts` generates a synthetic paper with a real image XObject. Preserve existing PDF companion behavior rather than replacing its public interfaces unnecessarily.

For application changes, run `pnpm test` and `pnpm build`; workbench changes also require `pnpm build:workbench`. On this WSL workspace, the installed Linux Chromium cache is selected with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" pnpm test:e2e`. Confirm the cache exists; do not hard-code the historical macOS Chromium path on WSL. Use monotonic timing for elapsed-time measurements. Documentation-only or skill-only changes can use direct inspection and skill validation instead of repeating application checks.

Historical evidence and integration decisions are in `docs/pdf-reading-0.14.1.md` and `docs/reading-workbench-0.14.md`. Read them when relevant, and keep future run-specific results in project docs rather than turning old counts, star numbers, or model names into permanent rules.
