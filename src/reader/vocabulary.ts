import type { Candidate, Concept } from '../core/types';
import type { ReadingSection } from './document';
import { z } from 'zod';
import { REVIEW_DAYS } from '../core/learning';
import {
  findAbbreviations,
  isOutsideCommonVocabulary,
  vocabularyForms,
} from '../content/candidates';
export type WordStatus = 'learning' | 'known';
export type WordRecord = {
  word: string;
  language: string;
  status: WordStatus;
  meaning?: string;
  summary?: string;
  expansion?: string;
  ambiguity?: string;
  context?: string;
  review?: { dueAt: number; step: number; count: number; lastReviewedAt: number };
};
export const WORD_STORE = 'easy-learn-reader-words-v1';
const reviewTimestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const wordRecordSchema = z.object({
  word: z.string().min(1).max(60),
  language: z.string().min(1).max(100),
  status: z.enum(['learning', 'known']),
  meaning: z.string().max(300).optional(),
  summary: z.string().max(1200).optional(),
  expansion: z.string().max(300).optional(),
  ambiguity: z.string().max(1500).optional(),
  context: z.string().max(420).optional(),
});
const wordReviewSchema = z.object({
  dueAt: reviewTimestamp,
  step: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_DAYS.length - 1),
  count: z.number().int().nonnegative(),
  lastReviewedAt: reviewTimestamp,
});
export function readVocabularyRecords(value: unknown): Record<string, WordRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .flatMap(([key, input]) => {
        const parsed = wordRecordSchema.safeParse(input);
        if (key.length >= 100 || !parsed.success) return [];
        const review = wordReviewSchema.safeParse((input as WordRecord).review);
        return [[key, { ...parsed.data, ...(review.success ? { review: review.data } : {}) }]];
      })
      .slice(0, 5000),
  );
}
export function hasWordReference(word: WordRecord) {
  return !![word.meaning, word.summary, word.expansion].some((value) => value?.trim());
}
export function vocabularyDueAt(word: WordRecord) {
  return word.review?.dueAt ?? 0;
}
export function sameVocabularyRecord(left: WordRecord | undefined, right: WordRecord | undefined) {
  if (!left || !right) return left === right;
  const fields = [
    'word',
    'language',
    'status',
    'meaning',
    'summary',
    'expansion',
    'ambiguity',
    'context',
  ] as const;
  const reviewFields = ['dueAt', 'step', 'count', 'lastReviewedAt'] as const;
  return (
    fields.every((field) => left[field] === right[field]) &&
    !!left.review === !!right.review &&
    reviewFields.every((field) => left.review?.[field] === right.review?.[field])
  );
}
export function reviewVocabularyWord(
  word: WordRecord,
  rating: 'again' | 'remembered',
  now = Date.now(),
): WordRecord {
  if (word.status !== 'learning' || !hasWordReference(word))
    throw new Error('请先补充释义，并将词汇设为学习中。');
  const step =
    rating === 'again' ? 0 : Math.min((word.review?.step ?? -1) + 1, REVIEW_DAYS.length - 1);
  return {
    ...word,
    review: {
      dueAt: now + REVIEW_DAYS[step] * 86400000,
      step,
      count: (word.review?.count ?? 0) + 1,
      lastReviewedAt: now,
    },
  };
}
export type ReadingWord = Candidate & {
  start: number;
  end: number;
  sectionId: string;
  key: string;
  page?: number;
};
export function wordKey(word: string, language: string) {
  return `${language.toLowerCase()}:${word.normalize('NFKC').toLocaleLowerCase(language)}`;
}
export function scanVocabulary(
  section: ReadingSection,
  language: string,
  common: Set<string>,
  known: Set<string>,
  max = 6,
  frequency?: ReadonlyMap<string, number>,
): ReadingWord[] {
  const words: ReadingWord[] = [],
    seen = new Set<string>();
  const knownWords = new Set(
    [...known]
      .filter((k) => k.startsWith(language.toLowerCase() + ':'))
      .map((k) => k.slice(k.indexOf(':') + 1)),
  );
  const abbreviations = new Map(
    findAbbreviations(section.title + '\n' + section.text)
      .filter((c) => c.start > section.title.length)
      .map((c) => [c.start - section.title.length - 1, c.anchor]),
  );
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
  for (const token of segmenter.segment(section.text)) {
    if (!token.isWordLike || !/\p{L}/u.test(token.segment) || token.segment.length > 60) continue;
    const word = token.segment,
      key = wordKey(word, language);
    if (known.has(key) || seen.has(key)) continue;
    const abbreviation = abbreviations.get(token.index) === word;
    if (
      language.startsWith('en') &&
      !abbreviation &&
      (word.length < 4 ||
        !/^[a-z]+$/i.test(word) ||
        /^[A-Z]+$/.test(word) ||
        !isOutsideCommonVocabulary(word, common) ||
        !isOutsideCommonVocabulary(word, knownWords))
    )
      continue;
    // Keep title-case vocabulary; capitalisation alone does not establish a proper name.
    seen.add(key);
    words.push({
      id: `c${words.length}`,
      anchor: word,
      kind: abbreviation ? 'abbreviation' : 'vocabulary',
      heading: section.title.slice(0, 120),
      context: section.text
        .slice(Math.max(0, token.index - 120), token.index + word.length + 200)
        .slice(0, 420),
      start: token.index,
      end: token.index + word.length,
      sectionId: section.id,
      key,
      page: section.pageSpans?.find((p) => token.index >= p.start && token.index < p.end)?.page,
    });
  }
  if (language.startsWith('en') && frequency) {
    const rank = (w: ReadingWord) =>
      Math.min(
        ...[...vocabularyForms(w.anchor)].map((f) => frequency.get(f) ?? frequency.size + 1),
      );
    words.sort(
      (a, b) => rank(b) - rank(a) || b.anchor.length - a.anchor.length || a.start - b.start,
    );
  }
  return words.slice(0, Math.max(0, max));
}
export function wordOccurrences(text: string, words: ReadingWord[], language: string) {
  const byKey = new Map(words.map((w) => [w.key, w]));
  return Array.from(new Intl.Segmenter(language, { granularity: 'word' }).segment(text)).flatMap(
    (token) => {
      const word = token.isWordLike ? byKey.get(wordKey(token.segment, language)) : undefined;
      return word ? [{ word, start: token.index, end: token.index + token.segment.length }] : [];
    },
  );
}
export function exportVocabulary(records: WordRecord[]): string {
  // Anki can import tab-separated UTF-8 text; no plugin or account required.
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').replace(/[<>]/g, '');
  return records
    .filter((r) => r.status === 'learning')
    .map((r) =>
      [
        r.word,
        r.meaning ?? '',
        [r.expansion, r.summary, r.ambiguity].filter(Boolean).join(' · '),
        r.language,
      ]
        .map(clean)
        .join('\t'),
    )
    .join('\n');
}
export function recordWord(
  word: ReadingWord,
  language: string,
  status: WordStatus,
  concept?: Concept,
  previous?: WordRecord,
): WordRecord {
  return {
    ...previous,
    word: word.anchor,
    language,
    status,
    meaning: concept?.meaning ?? previous?.meaning,
    summary: concept?.summary ?? previous?.summary,
    expansion: concept?.expansion ?? previous?.expansion,
    ambiguity: concept?.ambiguity ?? previous?.ambiguity,
    context: word.context,
  };
}
