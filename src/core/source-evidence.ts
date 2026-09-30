// A model's citation is useful only when the cited words occur in the exact
// material sent to it. Whitespace varies in extracted PDF text.
export function findSourceEvidence(source: string, quote?: string): { text: string; page?: number } | null {
  if (!quote?.trim()) return null;
  const normalizedSource = source.replace(/\s+/g, ' ');
  const normalizedQuote = quote.trim().replace(/\s+/g, ' ');
  if (normalizedQuote.length < 12) return null;
  const index = normalizedSource.indexOf(normalizedQuote);
  if (index < 0) return null;
  const preceding = normalizedSource.slice(0, index);
  const page = [...preceding.matchAll(/\[第 (\d+) 页\]/g)].at(-1);
  return { text: normalizedQuote, ...(page ? { page: Number(page[1]) } : {}) };
}
