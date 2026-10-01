import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfOutlineEntry = { title: string; page: number; depth: number; top?:number };

// PDF bookmarks are an optional, document-authored index. Ignore external links
// and unresolved destinations rather than guessing a page from a title.
export async function readPdfOutline(doc: PDFDocumentProxy): Promise<PdfOutlineEntry[]> {
  const roots = await doc.getOutline().catch(() => []);
  if (!roots?.length) return [];
  const pending = roots.map(node => ({ node, depth: 0 })).reverse();
  const entries: PdfOutlineEntry[] = [];
  let seen = 0;
  while (pending.length && seen < 120) {
    const { node, depth } = pending.pop()!;
    seen++;
    for (const child of [...(node.items ?? [])].reverse()) pending.push({ node: child, depth: Math.min(depth + 1, 4) });
    const title = node.title?.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title || !node.dest) continue;
    const destination = typeof node.dest === 'string' ? await doc.getDestination(node.dest).catch(() => null) : node.dest;
    const target = destination?.[0];
    let index: number;
    if (typeof target === 'number') index = target;
    else if (target && typeof target === 'object' && Number.isInteger(target.num) && Number.isInteger(target.gen)) {
      try { index = await doc.getPageIndex(target); } catch { continue; }
    } else continue;
    const page = index + 1;
    if (Number.isInteger(page) && page >= 1 && page <= doc.numPages) {
      const y=destination?.[1]?.name==='XYZ'?destination?.[3]:['FitH','FitBH'].includes(destination?.[1]?.name)?destination?.[2]:undefined;
      let top:number|undefined;
      if(typeof y==='number'&&Number.isFinite(y)){try{const proxy=await doc.getPage(page);top=proxy.getViewport({scale:1}).convertToViewportPoint(0,y)[1];}catch{/* page-only bookmark */}}
      entries.push({ title, page, depth,...(top===undefined?{}:{top}) });
    }
  }
  return entries;
}

export function sourcePdfPageUrl(raw: string, page: number): string | null {
  if (!Number.isInteger(page) || page < 1) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = `page=${page}`;
    return url.href;
  } catch { return null; }
}
