# Vocabulary ranking and candidate selection

## Diagnose the data before replacing the dictionary

Check the shipped artifact, generation script, source order, normalisation, duplicates, and thresholds. A filename containing “frequency” does not prove frequency order. An alphabetically sorted list cannot be sliced into “top 2000 / 5000” frequency levels.

Inspect both input rank and the final ranking. When source files contain successive rank ranges, preserve those offsets; filtering an entry should not silently change its original source rank. If combining corpora, document the scoring rule and its tradeoff. Everyday speech and encyclopedic prose cover different familiar vocabulary; merging them does not establish a learner's level.

Check fixture newline handling before treating Windows-only frequency failures as corrupt data. Splitting CRLF text only at `\n` leaves `\r` in membership keys. Use the reading loader's whitespace normalization and exercise both LF and CRLF against the actual ranked artifact; keep order, uniqueness and late-rare-word assertions. For Easy Learn, `.gitattributes` keeps generated `public/vocabulary/*.txt` LF without changing unrelated files.

Pin upstream revisions and verify hashes for reproducible generation. Separate licensing of data from licensing of generator code. Preserve attribution and the derivative license. Do not silently adopt a popular corpus whose terms do not fit the application.

## Select useful candidates

Reuse appropriate word segmentation and existing inflection handling. Preserve surface spelling and offsets even when a normalised form is used to compare common or known words. Avoid using capitalisation alone to discard a difficult word: headings and sentence starts capitalise ordinary vocabulary. Conversely, unknown rank does not prove a token is a word rather than a name or extraction error.

Apply candidate caps after inspecting the relevant reading unit. If the purpose is finding difficult words, do not stop at the first N tokens outside a common-word set. Rank qualifying candidates by the available rarity evidence, with a deterministic tie break. Keep the original document order for display even if request priority differs.

Treat the corpus threshold as a common-word approximation. It is neither an official exam list nor an individual knowledge estimate. Keep explicit known-word feedback authoritative within its intended language and morphology rules. Do not introduce aggressive stemming that conflates unrelated meanings merely to suppress marks.

## Handle abbreviations as a distinct candidate kind

Do not run contextual initialisms through ordinary minimum-length or all-capitals rejection rules. Reuse existing abbreviation detection and its exclusions for labels such as NOTE/TODO; avoid a second hard-coded dictionary of expansions. Preserve the abbreviation kind and source offsets through the model request.

Trace the full-name field from the existing output contract through parsing, tooltips, inspector, vocabulary storage, and export. A Chinese meaning alone is insufficient. Request the English expansion when the context supports it; retain ambiguity or an explicit missing-full-name notice when it does not. Save and export uncertainty alongside the expansion and meaning, so collection does not turn an unresolved interpretation into an apparently certain one. Do not confidently assign a familiar expansion to a conflicting context.

When a model-output contract materially changes, inspect persisted caches. Version only affected entries where possible so old incomplete results do not bypass the new contract, without discarding unrelated word records. Resolve missing output during preparation, not by starting a request on hover.

## Useful regression scenarios

- Familiar words from across the alphabet remain common at the chosen baseline.
- Plural and inflected forms of familiar words do not become false positives.
- A rare word at the end survives a small candidate cap despite earlier moderate-frequency words.
- Capitalised rare heading words are retained; identifiers and numeric artifacts follow existing filtering rules.
- Repeated occurrences map to unchanged source text; known status is language-specific.
- PDF line-end hyphenation is matched in both extracted prose and original text runs.
- Short initialisms reach analysis with their kind intact; English expansions survive display, saving and export, and incomplete results remain explicitly uncertain.

Use the actual generated artifact for data-order and threshold checks, alongside small fixtures for segmentation. Do not build a new NLP stack when the demonstrated failure is ordering or early truncation.
