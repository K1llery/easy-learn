import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextContent, StructTreeNode } from 'pdfjs-dist/types/src/display/api';
import { readPdfOutline, type PdfOutlineEntry } from '../core/pdf-navigation';
import { sectionsFromText, type ReadingDocument, type ReadingSection } from './document';

export type PdfLine = {
  text: string;
  page: number;
  x: number;
  top: number;
  width: number;
  size: number;
  bold: boolean;
  level?: number;
};
export type PdfTextPage = { page: number; width: number; height: number; lines: PdfLine[] };
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function headingTags(tree: StructTreeNode | null): Map<string, number> {
  const tags = new Map<string, number>();
  function visit(
    node: { role?: string; type?: string; id?: string; children?: StructTreeNode['children'] },
    level?: number,
  ) {
    const match = /^H([1-6])$/.exec(node.role ?? '');
    const next = match ? Number(match[1]) : level;
    if (node.type === 'content' && next) tags.set(node.id!, next);
    for (const child of node.children ?? []) visit(child, next);
  }
  if (tree) visit(tree);
  return tags;
}

export function pdfLines(
  content: TextContent,
  tree: StructTreeNode | null,
  page: number,
  width: number,
  height: number,
): PdfLine[] {
  const tags = headingTags(tree),
    stack: (string | undefined)[] = [];
  const pieces: PdfLine[] = [];
  for (const item of content.items) {
    if (!('str' in item)) {
      if (item.type.startsWith('begin')) stack.push('id' in item ? item.id : undefined);
      else if (item.type === 'endMarkedContent') stack.pop();
      continue;
    }
    if (!item.str.trim()) continue;
    const size = Math.hypot(item.transform[2], item.transform[3]) || item.height;
    const font = content.styles[item.fontName]?.fontFamily ?? item.fontName;
    const level = stack.map((id) => (id ? tags.get(id) : undefined)).find((x) => x !== undefined);
    pieces.push({
      text: item.str,
      page,
      x: item.transform[4],
      top: height - item.transform[5],
      width: item.width,
      size,
      bold: /bold|black|heavy/i.test(font),
      level,
    });
  }
  pieces.sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: PdfLine[] = [];
  for (const p of pieces) {
    const last = lines.at(-1);
    if (
      last &&
      Math.abs(last.top - p.top) < Math.max(2, p.size * 0.2) &&
      p.x - (last.x + last.width) < Math.max(14, p.size * 1.5) &&
      p.x >= last.x
    ) {
      const gap = p.x - (last.x + last.width);
      last.text += (gap > p.size * 0.15 && !last.text.endsWith(' ') ? ' ' : '') + p.text;
      last.width = Math.max(last.width, p.x + p.width - last.x);
      last.size = Math.max(last.size, p.size);
      last.bold = last.bold || p.bold;
      last.level ??= p.level;
    } else lines.push({ ...p });
  }
  return orderPdfLines(lines, width);
}

// Geometry determines columns; content-stream order is not necessarily reading order.
export function orderPdfLines(lines: PdfLine[], width: number): PdfLine[] {
  const mid = width / 2;
  const left = lines.filter((l) => l.x < mid && l.width > width * 0.2 && l.x + l.width <= mid + 12);
  const right = lines.filter((l) => l.x >= mid - 12 && l.width > width * 0.2);
  if (left.length < 4 || right.length < 4)
    return lines.slice().sort((a, b) => a.top - b.top || a.x - b.x);
  const spans = lines
    .filter((l) => l.x < mid - 30 && l.x + l.width > mid + 30)
    .sort((a, b) => a.top - b.top);
  const result: PdfLine[] = [];
  let top = -Infinity;
  for (const span of [...spans, { top: Infinity } as PdfLine]) {
    const band = lines.filter((l) => !spans.includes(l) && l.top >= top && l.top < span.top);
    result.push(
      ...band.filter((l) => l.x < mid - 12).sort((a, b) => a.top - b.top),
      ...band.filter((l) => l.x >= mid - 12).sort((a, b) => a.top - b.top),
    );
    if (Number.isFinite(span.top)) result.push(span);
    top = span.top;
  }
  return result;
}

export function structuredPdf(
  pages: PdfTextPage[],
  outline: PdfOutlineEntry[],
  title: string,
): ReadingDocument {
  const repeated = new Map<string, Set<number>>();
  for (const p of pages)
    for (const l of p.lines)
      if (l.top < p.height * 0.08 || l.top > p.height * 0.93) {
        const key = normalize(l.text.replace(/\d+/g, ''));
        if (key) {
          const seen = repeated.get(key) ?? new Set();
          seen.add(p.page);
          repeated.set(key, seen);
        }
      }
  const lines = pages.flatMap((p) =>
    p.lines.filter(
      (l) =>
        !(/^\d+$/.test(l.text.trim()) && (l.top < p.height * 0.08 || l.top > p.height * 0.9)) &&
        !(
          pages.length >= 3 &&
          (l.top < p.height * 0.08 || l.top > p.height * 0.93) &&
          (repeated.get(normalize(l.text.replace(/\d+/g, '')))?.size ?? 0) >=
            Math.max(3, Math.ceil(pages.length * 0.6))
        ),
    ),
  );
  const weighted = new Map<number, number>();
  for (const l of lines) {
    const size = Math.round(l.size * 2) / 2;
    weighted.set(size, (weighted.get(size) ?? 0) + l.text.length);
  }
  const bodySize = [...weighted].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const levels = new Map<
    number,
    { title: string; depth: number; source: 'outline' | 'headings' }
  >();
  for (const entry of outline) {
    const pageLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.page === entry.page);
    const match = pageLines.find(({ l }) => normalize(l.text) === normalize(entry.title));
    const target =
      match ??
      (entry.top !== undefined
        ? pageLines
            .slice()
            .sort((a, b) => Math.abs(a.l.top - entry.top!) - Math.abs(b.l.top - entry.top!))[0]
        : pageLines[0]);
    if (target && !levels.has(target.i))
      levels.set(target.i, { title: entry.title, depth: entry.depth, source: 'outline' });
  }
  const fontSizes = [
    ...new Set(
      lines
        .filter((l) => l.size > bodySize * 1.08 && l.text.length < 140)
        .map((l) => Math.round(l.size)),
    ),
  ].sort((a, b) => b - a);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i],
      text = l.text.trim();
    if (
      levels.has(i) ||
      text.length > 140 ||
      /^\s*(?:figure|fig\.?|table|eq\.?|equation)\s*\d/i.test(text) ||
      /[.;,]$/.test(text) ||
      /[{};=]|\b(?:for|while)\s*\(/.test(text)
    )
      continue;
    const numbered = /^(\d+(?:\.\d+)*)(?:\.?\s+)\p{L}/u.exec(text);
    const semantic =
      /^(?:abstract|introduction|background|related work|methods?|methodology|results?|discussion|conclusions?|references|acknowledg(?:e)?ments|appendix(?:\s+[A-Z])?)$/i.test(
        text,
      );
    const styled = l.size > bodySize * 1.08 || l.bold;
    const isolated =
      i === 0 ||
      l.page !== lines[i - 1].page ||
      Math.abs(l.top - lines[i - 1].top) > bodySize * 1.3;
    if (
      l.level ||
      semantic ||
      (numbered && (styled || isolated)) ||
      (styled && l.size > bodySize * 1.15 && isolated && text.split(/\s+/).length <= 14)
    ) {
      const depth = l.level
        ? l.level - 1
        : numbered
          ? numbered[1].split('.').length - 1
          : semantic
            ? 0
            : Math.max(0, fontSizes.indexOf(Math.round(l.size)));
      // A large document title before Abstract is front matter, not a section.
      if (!l.level && !numbered && !semantic && l.page === 1 && i < 4) continue;
      levels.set(i, { title: text, depth: Math.min(depth, 5), source: 'headings' });
    }
  }
  const starts = [...levels.keys()].sort((a, b) => a - b);
  if (starts.length && starts[0] > 0) starts.unshift(0);
  if (!starts.length) starts.push(0);
  const sections: ReadingSection[] = [];
  for (let j = 0; j < starts.length; j++) {
    const start = starts[j],
      end = starts[j + 1] ?? lines.length,
      part = lines.slice(start, end),
      heading = levels.get(start);
    let text = '';
    const runs: { page: number; start: number; end: number }[] = [];
    for (const page of [...new Set(part.map((l) => l.page))]) {
      const body = part
        .filter((l) => l.page === page)
        .map((l) => l.text)
        .join('\n')
        .replace(/([\p{L}]{2,})-\n([\p{Ll}]{2,})/gu, '$1$2');
      if (text) text += '\n';
      const start = text.length;
      text += body;
      runs.push({ page, start, end: text.length });
    }
    const name = heading?.title ?? (levels.size ? '标题与摘要' : '正文（未检测到可靠标题）');
    const chunks = sectionsFromText(text, name);
    // A section can continue across page boundaries. Page ranges are navigation metadata.
    let offset = 0;
    for (const chunk of chunks) {
      const start = text.indexOf(chunk.text, offset),
        end = start + chunk.text.length;
      offset = end;
      const pageSpans = runs
        .filter((r) => r.end > start && r.start < end)
        .map((r) => ({
          page: r.page,
          start: Math.max(0, r.start - start),
          end: Math.min(chunk.text.length, r.end - start),
        }));
      sections.push({
        ...chunk,
        depth: heading?.depth ?? 0,
        pageStart: pageSpans[0]?.page ?? 1,
        pageEnd: pageSpans.at(-1)?.page ?? pages.length,
        top: part.find((l) => l.page === pageSpans[0]?.page)?.top ?? 0,
        pageSpans,
      });
    }
  }
  if (!sections.length)
    sections.push({
      id: '',
      title: '文档原版',
      text: '',
      depth: 0,
      pageStart: 1,
      pageEnd: pages.length,
      top: 0,
    });
  if (sections.reduce((n, s) => n + s.text.length, 0) > 3_000_000 || sections.length > 2000)
    throw new Error('文档文字过多，请按章节拆分后导入。');
  return {
    title: title.slice(0, 500),
    language: 'en',
    format: 'PDF',
    pageCount: pages.length,
    structure:
      outline.length && [...levels.values()].some((h) => h.source === 'outline')
        ? 'outline'
        : levels.size
          ? 'headings'
          : 'fragments',
    sections: sections.map((s, i) => ({ ...s, id: `s${i}`, title: s.title.slice(0, 500) })),
  };
}

export async function extractStructuredPdf(
  doc: PDFDocumentProxy,
  title: string,
  progress: (page: number, total: number) => void,
) {
  const pages: PdfTextPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    progress(n, doc.numPages);
    const page = await doc.getPage(n);
    try {
      const [content, tree] = await Promise.all([
        page.getTextContent({ includeMarkedContent: true }),
        page.getStructTree().catch(() => null),
      ]);
      const v = page.getViewport({ scale: 1 });
      pages.push({
        page: n,
        width: v.width,
        height: v.height,
        lines: pdfLines(content, tree, n, v.width, v.height),
      });
    } finally {
      page.cleanup();
    }
  }
  return structuredPdf(pages, await readPdfOutline(doc), title);
}
