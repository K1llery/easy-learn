# PDF structure and original-page reading

## Choose the representation that serves the report

Separate extracting text, identifying structure, rendering graphics, and understanding images. Text extraction cannot display a figure. A bitmap-only preview cannot provide selectable word annotations. OCR and image interpretation are separate capabilities and should not be added merely because a user asks to see PDF images.

Prefer the installed PDF viewer's Canvas renderer and TextLayer for original pages; it preserves raster images, vector figures, formulae, and positioning without reconstructing the entire document format. Reflowed text may remain useful as another view, with a clear statement that it is not the original layout. Keep the original document available when extraction is uncertain.

## Build an honest directory

Use document-authored bookmarks and destinations, and accessible heading roles such as H1–H6 where available. Preserve depth and same-page positions. In PDF.js, marked content identifiers from `getTextContent({includeMarkedContent: true})` can connect structure-tree content to text runs; confirm behavior against the installed version.

For untagged/unbookmarked PDFs, use bounded inference from section numbering, font sizes, available font-weight evidence, spacing, and heading patterns. Exclude figure/table captions, page numbers, repeated running headers, and numbered code lines. Avoid presenting confidence-free guesses as document-authored structure. Label a page/chunk fallback as a reading fragment, not a logical chapter.

Content-stream order is not necessarily reading order. Check columns, spanning headings, footnotes, and page transitions with geometry and the original rendering. Sections can cross pages; multiple section headings can share a page. Keep physical page navigation and logical directory navigation separate.

## Preserve mappings and rendering lifecycle

Maintain page/offset mappings when joining text or dehyphenating. Map a word split across original text runs to one explanation while keeping visible source fragments unchanged. Avoid stale hover references, duplicate requests, or attaching a result to a newly imported document.

Render visible pages on demand instead of rasterising a whole large paper. Cancel superseded rendering and release the loading task when a document is replaced. Verify resized views and page changes against the library's canvas ownership rules.

Before adding custom polyfills or changing application semantics, inspect the actual embedded browser and the installed library's supported compatibility build. Check worker paths, standard fonts, CMaps, image decoders, ICC resources, MIME types, and CSP. Use upstream bundled compatibility code where suitable; preserve dependency versions and licenses. Enable only the capability required by the renderer, rather than broadly weakening script execution policy.

## Extend viewer controls through upstream components

For continuous reading, zoom, or page navigation, inspect the installed viewer component before writing a page stack or rendering queue. PDF.js `PDFViewer` owns page placeholders, visible-page scheduling, canvas caching, zoom and scroll modes. Reuse its matching viewer stylesheet so canvas and selectable text retain the same geometry; do not constrain a zoomed canvas with `max-width:100%` while leaving its text layer unscaled.

Check actual initialization contracts. In the verified legacy PDF.js integration, load the matching API before the viewer, which reads `globalThis.pdfjsLib`; its scroll container must be absolutely positioned within a bounded frame. Installed declaration files can lag runtime lifecycle options: inspect source rather than changing working runtime behavior to satisfy an inaccurate type.

Separate an explicit directory/jump destination from observed current-page updates. A scroll notification must update page indicators and analysis scope without replaying a navigation command or snapping to an old heading. A new directory command must also work when it targets the same physical page. Reject stale asynchronous destinations after another jump or document replacement.

Use upstream actual-size, fit-page and fit-width scales. Viewer 100% converts PDF points to CSS pixels; it is not the same as `getViewport({scale:1})`. Convert source heading coordinates through the page viewport. Recompute fit modes when the bounded viewport changes size; preserve a custom scale independently. Include page margins in full-page visibility checks and keep horizontal overflow inside the viewer at high zoom.

Keep page-number editing separate from confirmation. Accept integer physical pages within bounds, support Enter and a visible confirmation action, and update the input during ordinary scrolling. Invalid input must explain the allowed range without moving the document.

Cancel rendering and viewer observers/listeners on replacement or unmount using the installed lifecycle API. Keep document ownership with its loader so switching views does not destroy a still-used PDF. Do not render every page just to implement continuous scrolling.

## Add interactions and editable annotations without duplicating the PDF engine

Reuse the installed native annotation editor for FreeText, Highlight and Ink, with its compatible CSS/assets and `AnnotationStorage` / `saveDocument`. Keep scripting disabled unless explicitly needed. Inspect the installed event names and mandatory options: verified PDF.js 6 uses `editingstateschanged` for undo/redo, `annotationeditormodechanged` for completed transitions, and needs an explicit highlight color map even though its viewer option is nominally optional. Missing colors can break initial highlights, undo/redo, and reopening existing highlights.

Hand panning and text selection must be separate tools. When the packaged viewer does not export its hand tool, keep application gesture glue small: scroll the bounded viewport with Pointer Events, start capture after a drag threshold, preserve ordinary clicks, ignore editor/input/link and scrollbar targets, suppress a completed drag's click, and clean up on pointer cancellation, blur, mode changes and document replacement. Use grab/grabbing cursors and preserve ordinary touch scrolling.

Directory feedback belongs on the original heading, after its text layer is ready and the final destination has been applied. Match across split text runs, prefer the occurrence near the bookmark coordinate, and center it within the PDF viewport. Scope and cancel pending feedback by navigation/document generation. Do not treat a bookmark whose text cannot be found as a confirmed heading match.

Do not rebuild selectable text nodes for a meaning-only update. Preserve wrapper nodes and selection ranges; update annotation classes, labels and prepared titles in place when source matches are unchanged. The PDF.js legacy selection shim recognises its `highlight` wrappers; an unrecognised nested vocabulary element can cause `endOfContent` to be inserted inside a text run, truncating drag selection in older Chromium. Verify real mouse selection through several decorated words, not only programmatic ranges or tooltip coordinates.

Candidate removal, including streamed model skips, can change wrappers while the source text stays unchanged. If rebuilding is required, snapshot selection anchor/focus as offsets in their original source runs and restore them to the new text nodes, preserving direction and unaffected endpoints. Cover a delayed skip of a selected candidate, not only streamed meanings.

Keep the viewer/editor mounted while an alternative text view is shown. Hidden containers have zero dimensions; avoid applying fit calculations until visible. Wait for native mode completion and commit the active editor before export, protect edits during serialization, cancel export waits on replacement, and retain unsaved state after export failure. `saveDocument` resets upstream modified state even on failure, so the application's unsaved indicator must not assume that reset means a successful download. Confirm replacement and warn on close only when real unsaved work would be lost; make the export-based persistence contract visible.

Do not rely exclusively on `AnnotationStorage.onSetModified`: existing editor objects mutate in place, and undo/removal may bypass it. In this installed version, compare its serialized hash with the last successful export at completed edit/undo/redo boundaries; isolate this internal-version dependency and recheck it on upgrades. Input may precede native serialization, so keep that dirty indication until a successful export rather than clearing it on an unchanged hash. Lock the old document during asynchronous replacement and clear its state only when the replacement is ready; test editing attempts during delayed imports and post-export undo.

An inert layout alone does not suspend PDF.js global editor shortcuts and clipboard handlers. During import/export locks, stop delivery of keyboard/cut/paste events to those native handlers using temporary capture listeners or suspend their native lifecycle. Clean up that protection when the operation finishes. Verify Ctrl+Z during a delayed clean-document replacement, not just clicks and typing.

Do not infer cross-reader font compatibility from successful save or editor reopen. The verified worker's FreeText appearance generation uses Helvetica/WinAnsi and can omit `/AP` for CJK text while retaining Unicode `/Contents`. Chinese notes reopen in this workbench, but other PDF readers may not display them. Report that concrete limit instead of claiming universal PDF editing compatibility or adding a new font/PDF engine without assessing integration cost.

Selection learning should reuse existing model request and exercise components. Scope selection to the original/reflow document, exclude editable notes, snapshot selected text with request size limits, and clear snapshots on replacement or explicit navigation. Hover, highlighting, notes, drawing and file export must not trigger model calls. Keep quiz answers hidden until the reader responds; ignore late study results after closing/replacing the study panel.

## Verify what readers see

A nonempty extraction result or nonzero canvas size is insufficient. For image problems, include a genuine image XObject and verify rendered pixels or inspect the visible figure. For structure problems, include nested same-page headings and a section continuing across pages. Test untagged documents and image-only PDFs with explicit behavior for absent text.

Confirm annotations work on selectable original text, preserve the source, and generate no new model requests on hover/focus. Check an applicable public real-world paper after deterministic fixtures; do not claim validation of a user's unavailable file.

For controls, verify page geometry for all presets and custom zoom, fit after resize, direct last-page jumps, scrolling indicators, same-page bookmarks, narrow-screen overflow, and annotation survival after zoom. Use a document longer than the rendering cache to verify lazy canvases. Scope assertions by physical page: a continuous viewer legitimately has multiple canvases. After re-import, wait for the new document identity before asserting its pages. Allow justified pixel-rounding tolerance rather than requiring exact fractional CSS dimensions.

Relevant primary sources, to recheck when APIs change:

- [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [Marked content and structure-tree association, discussion #18508](https://github.com/mozilla/pdf.js/discussions/18508)
- [Text item order and reading order, issue #14493](https://github.com/mozilla/pdf.js/issues/14493)
- [Official viewer component integration](https://github.com/mozilla/pdf.js/blob/master/examples/components/simpleviewer.mjs)
- [Viewer scale and page options](https://github.com/mozilla/pdf.js/wiki/Viewer-options)
- [Fit-width sizing feedback, issue #12118](https://github.com/mozilla/pdf.js/issues/12118)
- [Upstream grab-to-pan behavior](https://github.com/mozilla/pdf.js/blob/master/web/grab_to_pan.js)
- [Native highlight integration tests](https://github.com/mozilla/pdf.js/blob/master/test/integration/highlight_editor_spec.mjs)
- [Editor mode/page snapping feedback, issue #18911](https://github.com/mozilla/pdf.js/issues/18911)
- [CJK FreeText appearance compatibility, issue #20117](https://github.com/mozilla/pdf.js/issues/20117)
