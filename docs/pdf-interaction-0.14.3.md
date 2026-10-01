# PDF interactions and selected learning — 0.14.3

Implemented 2026-10-01. This follows the existing PDF.js 6.3.289 integration; no new dependencies or lockfile changes.

## Reader behavior

- The default hand tool uses grab/grabbing cursors and pans the internal viewport in both axes after zooming. Selection, highlighting, notes and drawing have separate tools. Ordinary clicks, scrollbars and touch scrolling retain their own behavior.
- An explicit directory click carries the bookmark title and physical destination. Once the target text layer exists, the actual heading is brought into view and flashes twice (650 ms per cycle). Text runs can be split; repeated matches prefer the bookmark's vertical position. A missing title match keeps positional navigation without inventing a heading highlight.
- Selected document text enables explanation, translation and “考考我”. Only explicit learning actions call the existing model interface; notes, highlights, export and hovering do not. Selection is limited to 16,000 characters, excludes editor text, and is reset on replacement/navigation. Explanations and translation use existing AI contracts; quizzes reuse `QuickQuiz` and keep the answer hidden until responding.
- Native PDF.js tools provide text/free highlights, FreeText at arbitrary positions, Ink, undo/redo, and PDF export. These annotations are separate from preloaded vocabulary meanings. The active editor commits before export; the original file is not overwritten. The viewer remains mounted through a text-view switch, preserving current annotations.
- Export is the persistence mechanism. Closing or replacing unsaved work is guarded. A failed export retains the unsaved indicator and in-session work. There is no automatic whole-paper upload, cloud annotation store, OCR, source-text rewrite or comprehensive desktop PDF editor.

## Reuse and upstream feedback

The installed viewer, editors, CSS, image assets and worker are Mozilla PDF.js (Apache-2.0); existing package attribution remains in place. Application pointer gesture glue is small because `GrabToPan` is not exported by the packaged viewer. No new page scheduler, PDF writer, quiz engine or model protocol was introduced.

- [Official viewer component](https://github.com/mozilla/pdf.js/blob/master/web/pdf_viewer.js): runtime editor-mode transitions and shared page lifecycle.
- [Upstream hand-tool behavior](https://github.com/mozilla/pdf.js/blob/master/web/grab_to_pan.js): hand cursors, panning, gesture cancellation and interactive target exclusions.
- [Native highlighting integration tests](https://github.com/mozilla/pdf.js/blob/master/test/integration/highlight_editor_spec.mjs): creation, editing, undo and saved annotations.
- [Editor mode/page snapping issue #18911](https://github.com/mozilla/pdf.js/issues/18911): retain reading position during mode changes and validate annotations across pages.
- [Chinese FreeText appearance issue #20117](https://github.com/mozilla/pdf.js/issues/20117): cross-reader compatibility must be checked separately from a successful PDF save.

## Confirmed integration pitfalls

1. The legacy selection shim moves `endOfContent` relative to the current text run. Unknown nested vocabulary elements caused a real mouse drag across several words to stop early. Use recognised `highlight appended` wrappers, preserve source positions and keyboard-accessible word interactions, and verify actual selected text.
2. Meaning-only updates must update existing wrapper attributes rather than replacing text nodes; streamed explanations otherwise invalidate selected ranges. Source/match signatures determine when rebuilding is needed. A streamed `skip` removes a wrapper even though source text is unchanged: preserve anchor/focus source offsets across that rebuild, including selection direction.
3. The editor option `annotationEditorHighlightColors` is nominally optional, but this installed version calls `highlightColorNames.get` during highlighting, redo and reopening. Supply a valid explicit color map. The undo/redo event is `editingstateschanged`, not an invented annotation-prefixed event name.
4. Native mode changes can be asynchronous when existing annotations need a canvas refresh. Wait for `annotationeditormodechanged`, update visible rendering, and cancel waits when their document is destroyed. Disable editing during export serialization.
5. `saveDocument` resets upstream modified state in `finally`, including failures. Clear application unsaved state only after successful serialization and download initiation.
6. CJK note text is retained as Unicode `/Contents`, and our Chinese/English note fixture reopens in the workbench. However, the installed FreeText worker uses Helvetica/WinAnsi for appearance generation and returns no new `/AP` when a line is not encodable. Some external viewers therefore omit Chinese notes. The note tool and README disclose this limitation; font embedding and universal cross-reader note appearance are deferred.
7. `onSetModified` does not cover existing-editor mutation or undo/removal. Compare the installed SDK's serialized annotation hash against the last successful export at completed edit boundaries; do not clear active-input dirty state just because serialization has not caught up. The accessor is internal to this pinned SDK and must be rechecked on upgrades.
8. An unsaved check before an awaited import cannot protect edits made while the old document remains editable. Make the old reading layout inert during replacement, guard concurrent imports, and reset document state only after extraction/fingerprinting succeeds. PDF.js global editor shortcuts and clipboard handlers bypass `inert`; temporary capture listeners suspend their keyboard/cut/paste event delivery during import and export, while preserving browser default actions. The Ctrl+Z variant failed with the initial inert-only fix and passed with the completed lock.

## Validation

- `pnpm test`: 170 unit tests passed.
- `pnpm build` and `pnpm build:workbench`: passed.
- Targeted workbench browser checks: 5 passed, covering real mouse panning and two-cycle heading feedback; all three learning actions and selected-text request boundaries; highlight/FreeText/Ink export and reopen; streamed meaning updates preserving selection; and canceling unsaved replacement/exporting active text.
- Full browser suite: 55 passed, covering both extension and standalone workbenches. Tests use synthetic public PDF fixtures and isolated local mock models, never personal API keys.
- Independent staged-change review identified three defects: post-export undo bypassed unsaved protection; delayed imports permitted discarded edits to the old PDF; streamed skips destroyed selection. Each regression failed before its fix and passed after it. Focused independent review found the global-keyboard variant of the import race, also reproduced failing and then passing. Final read-only review of application candidate `8cad911748904aa2a753e064fa9455c0e209e7d9b08a15971fb5c9c1374c0a85` against `771bb42` completed with no remaining actionable material findings. The final documentation update records those results; application code matches the reviewed index.
- Canonical and installed reading skill copies match, both pass `quick_validate.py`, and their local project-document references exist.

The user's exact PDF and real provider response quality were not verified. Arbitrary layout/bookmark wording and external CJK annotation appearance remain bounded compatibility limits.
