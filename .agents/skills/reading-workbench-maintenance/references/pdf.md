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
