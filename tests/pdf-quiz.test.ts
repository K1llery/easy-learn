import { expect, it } from 'vitest';
import { samplePdfQuizText } from '../src/core/pdf-quiz';
import { findSourceEvidence } from '../src/core/source-evidence';

it('samples the beginning, middle and end of a long PDF within the request limit', () => {
  const pages = Array.from({ length: 30 }, (_, index) => ({ page: index + 1, text: `Unique page ${index + 1} content. ` + 'A'.repeat(3500) }));
  const sampled = samplePdfQuizText(pages);
  expect(sampled.length).toBeLessThanOrEqual(15000);
  expect(sampled).toContain('[第 1 页]');
  expect(sampled).toContain('[第 30 页]');
  expect(sampled).toMatch(/\[第 1[456] 页\]/);
  expect(sampled).not.toContain('[第 2 页]');
});

it('verifies a literal quote and returns its PDF page without accepting invented evidence', () => {
  const source = '[第 1 页]\nIntroduction.\n\n[第 8 页]\nThe backup remains available\nwhen a region fails.';
  expect(findSourceEvidence(source, 'The backup remains available when a region fails.')).toEqual({ text: 'The backup remains available when a region fails.', page: 8 });
  expect(findSourceEvidence(source, 'The backup always remains available when a region fails.')).toBeNull();
  expect(findSourceEvidence(source, 'The backup')).toBeNull();
});
