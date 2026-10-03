export type PdfQuizPage = { page: number; text: string };

// Sample across the document rather than silently testing only its beginning.
// The label lets a learner return to the relevant page after answering.
export function samplePdfQuizText(pages: PdfQuizPage[], cap = 15000): string {
  const readable = pages.filter((page) => page.text.trim());
  if (!readable.length || cap < 100) return '';
  const maxPages = Math.min(readable.length, 12);
  const chosen = Array.from(
    { length: maxPages },
    (_, index) =>
      readable[maxPages === 1 ? 0 : Math.round((index * (readable.length - 1)) / (maxPages - 1))],
  );
  const budget = Math.floor((cap - maxPages * 20) / maxPages);
  return chosen
    .map((page) => `[第 ${page.page} 页]\n${page.text.trim().slice(0, budget)}`)
    .join('\n\n')
    .slice(0, cap);
}
