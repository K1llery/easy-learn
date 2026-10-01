# Vocabulary list attribution

`english-frequency.txt` and `common-words-10k.txt` are filtered frequency-ranked derivatives of two corpora:

- Source: https://github.com/imjxyang/English-words
- Data source described by the project: Wortschatz Leipzig 2016 English Wikipedia 1M sentence corpus, via Wiktionary Frequency Lists.
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/
- Additional source: [Hermit Dave / FrequencyWords](https://github.com/hermitdave/FrequencyWords), `content/2018/en/en_50k.txt`, based on OpenSubtitles 2018. **Content** is CC BY-SA 4.0; the repository's MIT license applies to code, not these word lists.
- Pinned revisions: imjxyang `e48500006181d8d5040e5dbdd1b14e9fa1f7e39a`; FrequencyWords `525f9b560de45753a5ea01069454e72e9aa541c6`.
- Changes for Easy Learn: lowercase unique ASCII words; preserve original rank (including offsets of the ten Wikipedia source files); merge by the better corpus rank, with an alphabetical tie break only for equal ranks. `common-words-10k.txt` contains the first 10000 entries of the combined list. Both derivatives are distributed under **CC BY-SA 4.0**.
- Reproduction: input URLs and SHA-256 hashes are in `scripts/vocabulary-sources.json`; download those exact files and run `node scripts/build-vocabulary.mjs <source-directory>`. All source hashes must match. No network download occurs at runtime or during the ordinary application build.

The Google 10000 English dataset was also evaluated, but was not integrated because its upstream license warns about commercial corpus licensing. No data from it is included here.

This list is a frequency-based approximation. It is not the official CET-4 vocabulary list and cannot determine what an individual learner knows.
