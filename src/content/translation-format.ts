import { isReadableElement, blockTextNodes, blockSourceBreaks, type Block } from './document';

export type FormatRun = { id: number; element: HTMLElement; breaksBefore: Element[] };
export type TranslationPart = {
  source: string;
  marker?: string;
  runs: FormatRun[];
  translation?: string;
  state: 'pending' | 'loading' | 'ready' | 'failed';
};
const TEXT_STYLE = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'color',
  'background-color',
  'text-align',
  'text-indent',
  'text-transform',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-shadow',
  'vertical-align',
  'direction',
  'opacity',
] as const;

/** 只取文字样式，不复制网页节点、事件、定位或模型提供的 HTML。 */
export function textStyle(element: HTMLElement, root = element): Record<string, string> {
  const computed = getComputedStyle(element);
  const style = Object.fromEntries(
    TEXT_STYLE.map((name) => [name, computed.getPropertyValue(name)]),
  );
  const decorations = new Set<string>();
  let opacity = 1;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const inherited = getComputedStyle(parent);
    if (parent === root && element !== root) break;
    opacity *= Number(inherited.opacity || 1);
    const background = inherited.backgroundColor;
    if (
      !style['background-color'] ||
      /^(transparent|rgba\(0, 0, 0, 0\))$/.test(style['background-color'])
    ) {
      style['background-color'] = background;
    }
    for (const line of inherited.textDecorationLine.split(' '))
      if (line && line !== 'none') decorations.add(line);
    if (parent === root) break;
  }
  style.opacity = String(opacity);
  if (decorations.size) style['text-decoration-line'] = [...decorations].join(' ');
  return style;
}

export function applyTextStyle(node: HTMLElement, style: Record<string, string>) {
  for (const [name, value] of Object.entries(style)) {
    if (node.style.getPropertyValue(name) !== value)
      node.style.setProperty(name, value, 'important');
  }
}

export function translationParts(block: Block): TranslationPart[] {
  const nodes = blockTextNodes(block);
  const raw = nodes.map((node) => node.data).join('');
  const leading = raw.length - raw.trimStart().length;
  const breaks = blockSourceBreaks(block);
  let position = -leading;
  const runs = nodes.map((node, index) => {
    const start = position;
    position += node.length;
    const previous = nodes[index - 1];
    const breaksBefore = previous
      ? breaks.filter(
          (br) =>
            !!(previous.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            !!(br.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
        )
      : [];
    return { start, end: position, element: node.parentElement!, breaksBefore };
  });
  let marker = 'EL',
    suffix = 0;
  while (block.text.includes(`⟦${marker}:`) || block.text.includes(`⟦/${marker}:`))
    marker = `EL${++suffix}`;
  const rich = runs.some((run) => run.element !== block.element || run.breaksBefore.length);
  const parts: TranslationPart[] = [];
  for (let start = 0; start < block.text.length;) {
    let end = Math.min(block.text.length, start + 2000);
    if (end < block.text.length) {
      const boundary = block.text.lastIndexOf(' ', end);
      if (boundary > start + 1000) end = boundary;
      if (/[\uD800-\uDBFF]/.test(block.text[end - 1])) end--;
    }
    const part: TranslationPart = { source: '', runs: [], state: 'pending' };
    if (rich) {
      part.marker = marker;
      const encode = () => {
        part.source = '';
        part.runs = [];
        for (const run of runs) {
          const from = Math.max(start, run.start),
            to = Math.min(end, run.end);
          if (from >= to) continue;
          const id = part.runs.length;
          part.runs.push({
            id,
            element: run.element,
            breaksBefore: from === run.start ? run.breaksBefore : [],
          });
          part.source += `⟦${marker}:${id}⟧${block.text.slice(from, to)}⟦/${marker}:${id}⟧`;
        }
      };
      encode();
      // 密集行内节点的标记也计入上下文预算；不丢弃长段尾部。
      while (part.source.length > 4000) {
        end = start + Math.max(1, Math.floor((end - start) / 2));
        if (/[\uD800-\uDBFF]/.test(block.text[end - 1])) end--;
        encode();
      }
    } else part.source = block.text.slice(start, end);
    parts.push(part);
    start = end;
  }
  return parts;
}

export type FormattedText = { text: string; run?: FormatRun };
/** 标记只索引本地样式；异常片段保留文字，独立有效的标记仍保留格式。 */
export function translatedRuns(part: TranslationPart): { pieces: FormattedText[]; valid: boolean } {
  const text = part.translation ?? '';
  if (!part.marker) return { pieces: [{ text }], valid: true };
  const pattern = new RegExp(`⟦(/?)${part.marker}:(\\d+)⟧`, 'g');
  const tokens = [...text.matchAll(pattern)];
  const groups = new Map<number, number[]>();
  tokens.forEach((token, index) => {
    const id = Number(token[2]);
    const group = groups.get(id) ?? [];
    group.push(index);
    groups.set(id, group);
  });
  const ranges = new Map<number, FormatRun>();
  for (const [id, indices] of groups) {
    if (indices.length !== 2) continue;
    const [open, close] = indices;
    if (close !== open + 1 || tokens[open][1] || !tokens[close][1] || !part.runs[id]) continue;
    if (tokens[open][2] !== String(id) || tokens[close][2] !== String(id)) continue;
    // 即使内层配对完整，也不能把嵌套的错误标记绑定到本地样式。
    const nested = tokens.slice(0, open).reduce((depth, token) => depth + (token[1] ? -1 : 1), 0);
    if (nested !== 0) continue;
    ranges.set(open, part.runs[id]);
  }
  const reserved = new RegExp(`⟦/?${part.marker}:[^⟧]*⟧`, 'g');
  const pieces: FormattedText[] = [];
  let cursor = 0;
  let active: FormatRun | undefined;
  for (const [index, token] of tokens.entries()) {
    if (token.index > cursor)
      pieces.push({ text: text.slice(cursor, token.index).replace(reserved, ''), run: active });
    active = ranges.get(index);
    cursor = token.index + token[0].length;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor).replace(reserved, '') });
  const valid =
    ranges.size === part.runs.length &&
    tokens.length === part.runs.length * 2 &&
    !text.replace(pattern, '').includes(`⟦${part.marker}:`) &&
    !text.replace(pattern, '').includes(`⟦/${part.marker}:`);
  return { pieces, valid };
}

export function formattedTranslation(part: TranslationPart, root: HTMLElement) {
  const parsed = translatedRuns(part);
  // 整段同一种格式时，即使模型省略标记，也能可靠地保留这套样式。
  const uniform =
    !parsed.valid && parsed.pieces.some((piece) => !piece.run) ? part.runs[0] : undefined;
  const uniformStyle = uniform ? textStyle(uniform.element, root) : undefined;
  const fallback =
    uniform &&
    part.runs.every(
      (run) => JSON.stringify(textStyle(run.element, root)) === JSON.stringify(uniformStyle),
    )
      ? uniform
      : undefined;
  return {
    ...parsed,
    pieces: parsed.pieces.map((piece) => {
      const sourceRun = piece.run ?? fallback;
      const style = sourceRun ? textStyle(sourceRun.element, root) : undefined;
      // 根段的背景/透明度已由容器提供；普通文字片段不重复叠加。
      if (style && sourceRun?.element === root) {
        style.opacity = '1';
        style['background-color'] = 'transparent';
      }
      const run = piece.run
        ? {
            ...piece.run,
            breakBefore: piece.run.breaksBefore.filter((el) =>
              isReadableElement(el, undefined, true),
            ).length,
          }
        : undefined;
      return { ...piece, run, style };
    }),
  };
}
