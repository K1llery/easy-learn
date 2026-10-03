# Easy Learn integration

Paths are repository-relative, observed during the 0.14–0.14.1 work. Confirm current names and contracts before editing.

## Trace points

| Concern | Existing implementation |
| --- | --- |
| Configuration and provider defaults/capabilities | `src/core/types.ts`, `src/core/providers.ts` |
| Independent preset drafts | `src/core/provider-settings.ts` |
| Actual model request construction | `src/core/ai.ts` |
| Shared controls and reader settings | `src/ui/model-controls.tsx`, `src/ui/reader-settings.tsx`, options UI |
| Concurrency and dispatch priority | `src/core/session.ts` |
| Streaming validation | `src/core/stream.ts`, `src/core/model-output.ts` |
| Response cache isolation | `src/core/annotation-cache.ts` |
| Extension and standalone boundaries | `src/background.ts`, `src/ui/reader-rpc.ts`, standalone workbench server |

Reuse these shared modules rather than implementing a separate reader provider or queue. Keep CLI explanations independent from the default-off code annotation switch. File import and reveal of prepared tooltip content do not request model output; starting companion analysis is a separate user action.

The current scheduler keeps in-flight requests when concurrency decreases, prioritizes interactive work, and pauses after rate-limit or partial-output failures. Do not add automatic paid retries while tuning throughput.

## Validation

Start with the relevant existing tests: `tests/model-tuning.test.ts`, `tests/stream.test.ts`, `tests/annotation-cache.test.ts`, `tests/scheduling.test.ts`, and `tests/background.test.ts`. Inspect other AI/request tests before adding coverage. Browser regression uses the existing local mock, public fixtures, and assertions on actual requests.

For application changes run `pnpm test` and `pnpm build`; independent reader changes also require `pnpm build:workbench`. Follow the host-appropriate browser command in root `AGENTS.md`. Use monotonic timing in duration assertions. Documentation/skill changes require inspection and skill validation, without repeating previously successful application builds.

## Historical evidence

`docs/reading-workbench-0.14.md` records researched provider behavior, request preferences, limits, upstream issues, and mock validation. `docs/model-providers.md` and `docs/free-providers.md` provide existing provider context. Their dates matter: reverify current contracts when changing implementation.

Do not turn a past model list, token budget, account assumption, benchmark count, or upstream star count into a permanent rule. Keep new dated findings and actual measurements in docs, and record completed verified changes in a local commit without pushing.

## Full-page translation and defaults

Use `src/core/reading-defaults.ts` for unsaved defaults across extension and workbench; preserve explicitly stored values. Confirm the actual queue, schemas, both settings UIs, and caller batch limits accept the same range. Priority tests should set their intended slot count explicitly rather than assuming a historical default.

Browser bulk translation uses the existing explain/translate contract and shares the total queue. Its scoped cancellation must leave annotations and other documents active. Register cancellation controllers before asynchronous settings/permission preparation and recheck cancellation immediately before model dispatch. Serialize pause/resume cancellation before issuing replacement requests; reject old epochs and changed-source results. `tests/page-translation.test.ts` and background/browser regressions cover this boundary. Research, root causes and validation are in `docs/browser-translation-0.16.md`.
