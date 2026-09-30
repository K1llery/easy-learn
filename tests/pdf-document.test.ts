// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { extractPdfDocument } from '../src/core/pdf-document';

function fixtureTask(texts: string[]) {
  const pages = texts.map(text => ({
    getTextContent: vi.fn().mockResolvedValue({ items: text.split('\n').map(str => ({ str, hasEOL: true })) }),
    cleanup: vi.fn(),
  }));
  const doc = {
    numPages: pages.length,
    getPage: vi.fn(async (number: number) => pages[number - 1]),
    getOutline: vi.fn().mockResolvedValue([]),
  };
  const task = { promise: Promise.resolve(doc), destroy: vi.fn().mockResolvedValue(undefined) };
  return { pages, task: task as unknown as PDFDocumentLoadingTask, destroy: task.destroy };
}

it('preserves physical page numbers including empty pages and releases each page after extraction', async () => {
  const { task, pages, destroy } = fixtureTask(['Introduction  \nMore detail.', '', 'Conclusion.']);
  const progress = vi.fn();
  expect(await extractPdfDocument(task, progress)).toEqual({
    pages: [{ page: 1, text: 'Introduction\nMore detail.' }, { page: 2, text: '' }, { page: 3, text: 'Conclusion.' }],
    outline: [],
  });
  expect(progress.mock.calls).toEqual([[1,3], [2,3], [3,3]]);
  for (const page of pages) expect(page.cleanup).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});

it('releases the loading task after a corrupt PDF fails to open without masking the parsing error', async () => {
  const destroy = vi.fn().mockRejectedValue(new Error('cleanup failed'));
  const task = { promise: Promise.reject(new Error('corrupt PDF')), destroy } as unknown as PDFDocumentLoadingTask;
  await expect(extractPdfDocument(task, () => undefined)).rejects.toThrow('corrupt PDF');
  expect(destroy).toHaveBeenCalledOnce();
});

it('releases both the current page and task when a page fails to extract', async () => {
  const { task, pages, destroy } = fixtureTask(['First page.', 'Unreadable page.']);
  pages[1].getTextContent.mockRejectedValue(new Error('page text failed'));
  await expect(extractPdfDocument(task, () => undefined)).rejects.toThrow('page text failed');
  for (const page of pages) expect(page.cleanup).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});

it('reports missing text rather than treating an image-only document as readable', async () => {
  const { task, pages, destroy } = fixtureTask(['', '']);
  await expect(extractPdfDocument(task, () => undefined)).rejects.toThrow('没有提取到文字');
  for (const page of pages) expect(page.cleanup).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});
