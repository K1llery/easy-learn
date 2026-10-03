// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { quizText } from '../src/content/document';
import type { Block } from '../src/content/document';

function block(text: string, kind?: Block['kind']): Block {
  return { element: {} as HTMLElement, text, heading: '', kind, sectionId: 0 };
}

describe('whole-page quiz corpus', () => {
  it('joins prose and headings, dropping code blocks', () => {
    const text = quizText([
      block('First paragraph.'),
      block('Setup', 'prose'),
      block('npm install', 'command'),
      block('const x = 1;', 'code'),
      block('Second paragraph.'),
    ]);
    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second paragraph.');
    expect(text).not.toContain('npm install');
    expect(text).not.toContain('const x');
  });
  it('evenly samples very long pages instead of truncating to the top', () => {
    const filler = (n: number) =>
      block(`Paragraph number ${n} with unique marker P${n}.`.repeat(3));
    const blocks = Array.from({ length: 200 }, (_, i) => filler(i));
    const text = quizText(blocks, 4000);
    expect(text.length).toBeLessThanOrEqual(4000);
    const kept = [...text.matchAll(/P(\d+)\./g)].map((m) => Number(m[1]));
    expect(kept.length).toBeGreaterThan(10);
    expect(Math.max(...kept)).toBeGreaterThan(150);
    expect(Math.min(...kept)).toBeLessThan(20);
  });
  it('keeps everything when the page fits the cap', () => {
    const text = quizText([block('Short.'), block('Also short.')]);
    expect(text).toBe('Short.\n\nAlso short.');
  });
});
