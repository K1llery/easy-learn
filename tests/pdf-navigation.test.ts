import { expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { readPdfOutline, sourcePdfPageUrl } from '../src/core/pdf-navigation';

it('resolves PDF-authored bookmarks without following external links or guessing missing pages', async () => {
  const doc = {
    numPages: 4,
    getOutline: async () => [
      { title: '  Introduction  ', dest: [{ num: 7, gen: 0 }, { name: 'Fit' }], items: [
        { title: 'Methods', dest: 'methods', items: [] },
        { title: 'External reference', dest: null, url: 'https://example.org', items: [] },
      ] },
      { title: 'Bad target', dest: [99, { name: 'Fit' }], items: [] },
    ],
    getDestination: async (id: string) => id === 'methods' ? [2, { name: 'Fit' }] : null,
    getPageIndex: async (ref: { num: number }) => ref.num === 7 ? 0 : -1,
  } as unknown as PDFDocumentProxy;
  expect(await readPdfOutline(doc)).toEqual([
    { title: 'Introduction', page: 1, depth: 0 },
    { title: 'Methods', page: 3, depth: 1 },
  ]);
});

it('opens only a supported original PDF URL at a valid page', () => {
  expect(sourcePdfPageUrl('https://example.org/paper.pdf?download=1#old', 5)).toBe('https://example.org/paper.pdf?download=1#page=5');
  expect(sourcePdfPageUrl('file:///papers/example.pdf', 2)).toBeNull();
  expect(sourcePdfPageUrl('javascript:alert(1)', 1)).toBeNull();
  expect(sourcePdfPageUrl('https://user:pass@example.org/paper.pdf', 1)).toBeNull();
  expect(sourcePdfPageUrl('https://example.org/paper.pdf', 0)).toBeNull();
});
