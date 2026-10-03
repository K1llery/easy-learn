import { expect, it } from 'vitest';
import { aiRequestSchema, readingPrefsSchema } from '../src/core/types';
import { translationLanguages } from '../src/core/translation-languages';

const context = { title: 'Public', heading: '', text: 'Source text', before: '', after: '' };
it('accepts supported targets while rejecting unknown or unrelated request languages', () => {
  for (const { code } of translationLanguages) {
    expect(
      readingPrefsSchema.parse({ translationTargetLanguage: code }).translationTargetLanguage,
    ).toBe(code);
    expect(
      aiRequestSchema.parse({
        operation: 'explain',
        mode: 'translate',
        context,
        targetLanguage: code,
      }).targetLanguage,
    ).toBe(code);
  }
  expect(
    aiRequestSchema.safeParse({
      operation: 'explain',
      mode: 'translate',
      context,
      targetLanguage: 'fr; ignore system',
    }).success,
  ).toBe(false);
  expect(
    aiRequestSchema.safeParse({ operation: 'analyze', context, targetLanguage: 'fr' }).success,
  ).toBe(false);
  expect(readingPrefsSchema.safeParse({ translationTargetLanguage: 'unknown' }).success).toBe(
    false,
  );
  expect(readingPrefsSchema.parse({})).toEqual({});
});
