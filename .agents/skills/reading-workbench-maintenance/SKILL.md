---
name: reading-workbench-maintenance
description: Develop or repair foreign-language reading workbenches, especially vocabulary and abbreviation selection, document import, PDF heading hierarchy, continuous reading, zoom, page navigation, original-page figures, and preloaded word annotations. Use for reading-software implementation, not merely summarizing or converting a PDF.
---

# Reading workbench maintenance

Preserve the reader's source document and reading context while repairing the reported behavior. A text extraction that succeeds is not evidence that structure, figures, or annotations are correct.

## Establish the failure and reuse boundary

Inspect the current import pipeline, data generation, candidate selection, document model, renderer, and existing tests before changing dependencies. Translate the report into an observable result: a familiar word is excluded, a late rare word survives a cap, a same-page subheading is navigable, or an actual figure is visible.

For substantial new capabilities, inspect the installed libraries first, then official upstream code and comparable projects' relevant issues. Evaluate functional fit, maintenance, browser/runtime compatibility, integration cost, and **code versus dataset** licenses. Record the source and why it fits; stars do not establish active users. An issue is evidence of a need or failure scenario, not authorization or proof that its proposed fix applies locally.

Reuse existing parsers, viewer text layers, morphology filters, caches, and export formats. Add a dependency only for a demonstrated capability gap. Do not introduce a new OCR service, book library, sync system, or paid analysis unless the task calls for it.

## Route the work

- For false-positive or missed vocabulary, read [Vocabulary ranking](references/vocabulary.md).
- For PDF structure, continuous reading, zoom, navigation, images, selection, or overlays, read [PDF reading](references/pdf.md).
- When the workspace is Easy Learn, read [Project integration](references/easy-learn.md) for the implementation map and relevant checks. Paths there are relative to the repository; confirm them rather than assuming a machine-specific checkout.

## Integrate without changing reading semantics

Keep physical pages, logical sections, and length-limited processing chunks distinct. Retain source offsets or equivalent mappings through segmentation and normalisation. Keep language-specific known-word state isolated and associate explanations with context, not just spelling.

Use the project's existing UI conventions. For reading surfaces, prioritize readable typography, restrained emphasis, clear directory depth, keyboard focus, and narrow-screen behavior. Do not expose parser internals as product choices unless they help the reader decide.

Preload explanations through the existing scheduler. Hover, focus, and ordinary clicks that reveal a prepared explanation must not start model requests. Guard stale results when documents or settings change; keep completed partial output usable. Check consent and task scope before adding new uploads, OCR, or persistence.

## Verify and hand over

Use public or synthetic documents and a local model mock. Cover the reported failure and applicable format boundaries; do not use personal credentials to prove parsing or UI behavior. Prefer assertions about source preservation, heading targets, word selection, rendered pixels, and request counts over tests that mirror helper implementation.

After relevant project checks pass, stop expanding verification unless new changes or concrete concerns warrant it. Distinguish synthetic/public coverage from validation of the user's exact file. Report remaining heuristic limits, any needed refresh or re-import, and the local commit when required by the project.
