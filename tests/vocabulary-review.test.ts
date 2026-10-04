import { describe, expect, it } from 'vitest';
import { REVIEW_DAYS } from '../src/core/learning';
import {
  hasWordReference,
  readVocabularyRecords,
  recordWord,
  sameVocabularyRecord,
  reviewVocabularyWord,
  vocabularyDueAt,
  type ReadingWord,
  type WordRecord,
} from '../src/reader/vocabulary';

const word: WordRecord = {
  word: 'ephemeral',
  language: 'en',
  status: 'learning',
  meaning: '短暂的',
};
const now = 1_800_000_000_000;

describe('local vocabulary review', () => {
  it('makes legacy cards immediately available, while excluding missing references and known words', () => {
    const records = readVocabularyRecords({
      'en:ephemeral': word,
      'en:missing': { word: 'missing', language: 'en', status: 'learning' },
      'en:broken': { ...word, meaning: 42 },
    });
    expect(records['en:ephemeral']).toEqual(word);
    expect(vocabularyDueAt(word)).toBe(0);
    expect(hasWordReference(records['en:missing'])).toBe(false);
    expect(records['en:broken']).toBeUndefined();
    expect(() => reviewVocabularyWord({ ...word, status: 'known' }, 'remembered', now)).toThrow();
    expect(() => reviewVocabularyWord(records['en:missing'], 'again', now)).toThrow();
    expect(readVocabularyRecords(null)).toEqual({});
    expect(readVocabularyRecords([])).toEqual({});
  });
  it('schedules from the review time, caps successful intervals, and resets forgotten words', () => {
    let current = word;
    for (const days of [...REVIEW_DAYS, 30]) {
      current = reviewVocabularyWord(current, 'remembered', now);
      expect(current.review!.dueAt).toBe(now + days * 86400000);
      expect(current.status).toBe('learning');
    }
    expect(current.review!.count).toBe(6);
    const forgotten = reviewVocabularyWord(current, 'again', now + 10000);
    expect(forgotten.review).toEqual({
      dueAt: now + 10000 + 86400000,
      step: 0,
      count: 7,
      lastReviewedAt: now + 10000,
    });
    expect(current.review!.step).toBe(4);
  });
  it('keeps valid words when review metadata is corrupt and retains valid context and progress after reload', () => {
    const saved = {
      ...reviewVocabularyWord(word, 'remembered', now),
      context: 'The ephemeral glow fades.',
    };
    expect(
      readVocabularyRecords(JSON.parse(JSON.stringify({ 'en:ephemeral': saved })))['en:ephemeral'],
    ).toEqual(saved);
    for (const review of [
      null,
      { ...saved.review, step: 8 },
      { ...saved.review, dueAt: Infinity },
      { ...saved.review, count: -1 },
    ]) {
      expect(readVocabularyRecords({ key: { ...saved, review } }).key).toEqual({
        ...word,
        context: saved.context,
      });
    }
  });
  it('preserves progress and explanations when the same word is collected again without a loaded concept', () => {
    const saved = reviewVocabularyWord(word, 'remembered', now);
    const readingWord: ReadingWord = {
      id: 'c0',
      anchor: 'ephemeral',
      kind: 'vocabulary',
      heading: '',
      context: 'The ephemeral glow fades.',
      start: 4,
      end: 13,
      sectionId: 's0',
      key: 'en:ephemeral',
    };
    const collected = recordWord(readingWord, 'en', 'known', undefined, saved);
    expect(collected.review).toEqual(saved.review);
    expect(collected.meaning).toBe(word.meaning);
    expect(collected.context).toBe(readingWord.context);
    expect(collected.status).toBe('known');
    const reloaded = readVocabularyRecords({ key: collected }).key;
    expect(sameVocabularyRecord(collected, reloaded)).toBe(true);
    expect(sameVocabularyRecord(collected, { ...reloaded, meaning: '已改释义' })).toBe(false);
    expect(
      sameVocabularyRecord(collected, { ...reloaded, review: { ...reloaded.review!, count: 8 } }),
    ).toBe(false);
    expect(sameVocabularyRecord(collected, undefined)).toBe(false);
  });
});
