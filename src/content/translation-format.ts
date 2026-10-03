import { isReadableElement, readableTextNodes, type Block } from './document';

export type FormatRun = { id: number; element: HTMLElement; breaksBefore: Element[] };
export type TranslationPart = {
  source: string;
  marker?: string;
  runs: FormatRun[];
  translation?: string;
  state: 'pending' | 'loading' | 'ready' | 'failed';
};
const TEXT_STYLE = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'color', 'background-color',
  'text-align', 'text-indent', 'text-transform', 'text-decoration-line',
  'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness',
  'text-shadow', 'vertical-align', 'direction',
  'opacity',
] as const;

/** 只取文字样式，不复制网页节点、事件、定位或模型提供的 HTML。 */
export function textStyle(element: HTMLElement, root = element): Record<string, string> {
  const computed = getComputedStyle(element);
  const style = Object.fromEntries(TEXT_STYLE.map(name => [name, computed.getPropertyValue(name)]));
  const decorations = new Set<string>();
  let opacity = 1;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const inherited = getComputedStyle(parent);
    if (parent === root && element !== root) break;
    opacity *= Number(inherited.opacity || 1);
    const background = inherited.backgroundColor;
    if (!style['background-color'] || /^(transparent|rgba\(0, 0, 0, 0\))$/.test(style['background-color'])) {
      style['background-color'] = background;
    }
    for (const line of inherited.textDecorationLine.split(' ')) if (line && line !== 'none') decorations.add(line);
    if (parent === root) break;
  }
  style.opacity = String(opacity);
  if (decorations.size) style['text-decoration-line'] = [...decorations].join(' ');
  return style;
}

export function applyTextStyle(node: HTMLElement, style: Record<string, string>) {
  for (const [name, value] of Object.entries(style)) {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value, 'important');
  }
}

export function translationParts(block: Block): TranslationPart[] {
  const nodes = readableTextNodes(block.element);
  const raw = nodes.map(node => node.data).join('');
  const leading = raw.length - raw.trimStart().length;
  const breaks = [...block.element.querySelectorAll('br')].filter(el => !el.closest('[data-easy-learn]'));
  let position = -leading;
  const runs = nodes.map((node, index) => {
    const start = position;
    position += node.length;
    const previous = nodes[index - 1];
    const breaksBefore = previous ? breaks.filter(br =>
      !!(previous.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      !!(br.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) : [];
    return {start, end: position, element: node.parentElement!, breaksBefore};
  });
  let marker = 'EL', suffix = 0;
  while (block.text.includes(`⟦${marker}:`) || block.text.includes(`⟦/${marker}:`)) marker = `EL${++suffix}`;
  const rich = runs.some(run => run.element !== block.element || run.breaksBefore.length);
  const parts: TranslationPart[] = [];
  for (let start = 0; start < block.text.length;) {
    let end = Math.min(block.text.length, start + 2000);
    if (end < block.text.length) {
      const boundary = block.text.lastIndexOf(' ', end);
      if (boundary > start + 1000) end = boundary;
      if (/[\uD800-\uDBFF]/.test(block.text[end - 1])) end--;
    }
    const part: TranslationPart = {source: '', runs: [], state: 'pending'};
    if (rich) {
      part.marker = marker;
      const encode = () => {
        part.source = '';
        part.runs = [];
        for (const run of runs) {
          const from = Math.max(start, run.start), to = Math.min(end, run.end);
          if (from >= to) continue;
          const id = part.runs.length;
          part.runs.push({id, element: run.element, breaksBefore: from === run.start ? run.breaksBefore : []});
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
/** 标记仅用于索引本地格式；校验失败时展示去除标记的完整纯文本。 */
export function translatedRuns(part: TranslationPart): { pieces: FormattedText[]; valid: boolean } {
  const text = part.translation ?? '';
  if (!part.marker) return {pieces: [{text}], valid: true};
  const pattern = new RegExp(`⟦(/?)${part.marker}:(\\d+)⟧`, 'g');
  const pieces: FormattedText[] = [], seen = new Set<number>();
  let active: FormatRun | undefined, cursor = 0, valid = true;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) pieces.push({text: text.slice(cursor, match.index), run: active});
    const id = Number(match[2]);
    if (match[2] !== String(id)) valid = false;
    if (match[1]) {
      if (active?.id !== id) valid = false;
      active = undefined;
    } else {
      if (active || seen.has(id) || !part.runs[id]) valid = false;
      seen.add(id);
      active = part.runs[id];
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) pieces.push({text: text.slice(cursor), run: active});
  valid &&= !active && seen.size === part.runs.length && pieces.every(piece =>
    !piece.text.includes(`⟦${part.marker}:`) && !piece.text.includes(`⟦/${part.marker}:`));
  const reserved = new RegExp(`⟦/?${part.marker}:[^⟧]*⟧`, 'g');
  return valid ? {pieces, valid} : {pieces: [{text: text.replace(reserved, '')}], valid};
}

export function formattedTranslation(part: TranslationPart, root: HTMLElement) {
  const parsed = translatedRuns(part);
  return {...parsed, pieces: parsed.pieces.map(piece => {
    const style = piece.run ? textStyle(piece.run.element, root) : undefined;
    // 根段的背景/透明度已由容器提供；普通文字片段不重复叠加。
    if (style && piece.run?.element === root) { style.opacity = '1'; style['background-color'] = 'transparent'; }
    const run = piece.run ? {...piece.run, breakBefore: piece.run.breaksBefore.filter(el => isReadableElement(el)).length} : undefined;
    return {...piece, run, style};
  })};
}
