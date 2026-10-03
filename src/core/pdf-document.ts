import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { readPdfOutline, type PdfOutlineEntry } from './pdf-navigation';

export type PdfPageText = { page: number; text: string };
export type ExtractedPdf = { pages: PdfPageText[]; outline: PdfOutlineEntry[] };
export type PdfProgress = (page: number, total: number) => void;

export async function extractPdfDocument(
  task: PDFDocumentLoadingTask,
  onPage: PdfProgress,
): Promise<ExtractedPdf> {
  try {
    const doc = await task.promise;
    const pages: PdfPageText[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      onPage(number, doc.numPages);
      const page = await doc.getPage(number);
      try {
        const content = await page.getTextContent();
        let text = '';
        for (const item of content.items) {
          if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
        }
        pages.push({
          page: number,
          text: text
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
        });
      } finally {
        page.cleanup();
      }
    }
    if (!pages.some((page) => page.text))
      throw new Error('没有提取到文字。这个 PDF 可能是扫描图片，请改用粘贴文本面板或 OCR 工具。');
    return { pages, outline: await readPdfOutline(doc) };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
