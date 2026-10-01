# Easy Learn integration map

Use this map when the workspace contains `src/reader` and the Easy Learn workbench. It reflects 0.14.3, not a guarantee that future file names or dependencies are unchanged.

| Concern | Existing integration |
| --- | --- |
| Document imports and text limits | `src/ui/reader-source.ts`, `src/reader/document.ts` |
| PDF hierarchy and page/text mappings | `src/reader/pdf-structure.ts`, `src/core/pdf-navigation.ts` |
| PDF loading, compatibility worker, fonts and decoder paths | `src/ui/pdf-source.ts` |
| Original viewer, continuous pages, zoom, navigation and word overlays | `src/ui/reader-pdf.tsx`, `src/ui/reader-pdf.css`, `src/ui/pdf-viewer.d.ts` |
| Ranked scanning, abbreviations and word state | `src/reader/vocabulary.ts`; shared `vocabularyForms` and `findAbbreviations` in `src/content/candidates.ts` |
| Word-list provenance and generation | `public/vocabulary/ATTRIBUTION.md`, `scripts/vocabulary-sources.json`, `scripts/build-vocabulary.mjs` |
| Selected explanation / translation / quiz | `src/ui/reader-study.tsx`, shared `rpc.ts`, `use-action.ts`, `quick-quiz.tsx` |
| Scheduler, navigation, source lifecycle | `src/ui/reader.tsx`, `src/ui/reader-rpc.ts` |
| Extension and standalone asset packaging | `scripts/build.mjs`, `scripts/build-workbench.mjs` |
| Standalone static MIME / CSP and mockable server | `src/workbench/server.ts` |

Do not duplicate parsers or existing model/cache modules. Keep code annotations default off and CLI explanations independent, as required by project guidance. Importing a reading file and revealing a prepared explanation must not start model requests. Existing model settings and word records should survive a preview update.

Check `tests/reader.test.ts`, `tests/pdf-structure.test.ts`, `tests/pdf-navigation.test.ts` for relevant fixtures. Browser coverage is in `tests/e2e/workbench.spec.ts` and `tests/e2e/extension.spec.ts`; `tests/e2e/pdf-fixture.ts` generates a synthetic paper with a real image XObject. Preserve existing PDF companion behavior rather than replacing its public interfaces unnecessarily.

The 0.14.3 original reader uses the installed legacy `PDFViewer`, loaded after `pdf-source`, and retains the parent-owned document proxy. It stays mounted behind the text view so native editor state survives; new documents own new editor lifecycles. Native export is the persistence mechanism, with unsaved replacement/close guards. `PdfDestination` represents explicit navigation while `onPageChange` reports observed pages; do not collapse them into one scroll-triggering state. Abbreviation `expansion` is an existing model field, with display/storage/export integration and an affected-contract namespace in `src/core/annotation-cache.ts`.

For application changes, run `pnpm test` and `pnpm build`; workbench changes also require `pnpm build:workbench`. On this WSL workspace, the installed Linux Chromium cache is selected with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" pnpm test:e2e`. Confirm the cache exists; do not hard-code the historical macOS Chromium path on WSL. Use monotonic timing for elapsed-time measurements. Documentation-only or skill-only changes can use direct inspection and skill validation instead of repeating application checks.

Historical evidence and integration decisions are in `docs/pdf-reading-0.14.1.md`, `docs/pdf-controls-0.14.2.md`, `docs/pdf-interaction-0.14.3.md`, and `docs/reading-workbench-0.14.md`. Read them when relevant, and keep future run-specific results in project docs rather than turning old counts, star numbers, or model names into permanent rules.
