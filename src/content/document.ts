import type { TextContext } from '../core/types';
const EXCLUDE =
  'nav,header,footer,aside,script,style,noscript,textarea,input,select,button,[contenteditable]:not([contenteditable="false"]),[role="navigation"],[role="banner"],[role="complementary"],[aria-hidden="true"],[hidden],[data-ad],[data-ad-slot],.advertisement,.ads,[data-easy-learn]';
const TRANSLATION_EXCLUDE =
  'script,style,noscript,textarea,input,select,option,pre,svg,math,[data-ty="input"],[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],[hidden],[data-ad],[data-ad-slot],.advertisement,.ads,[data-easy-learn]';
export type Block = {
  element: HTMLElement;
  text: string;
  heading: string;
  sectionId: number;
  kind?: 'prose' | 'command' | 'code';
  offset?: number;
  sourceText?: string;
  /** 混合容器中的连续行内片段，译文插在最后一个直接子节点之后。 */
  textNodes?: Text[];
  startNode?: ChildNode;
  afterNode?: ChildNode;
};
export function isReadableElement(
  element: Element,
  visibility = new Map<Element, boolean>(),
  translation = false,
) {
  if (element.closest(translation ? TRANSLATION_EXCLUDE : EXCLUDE)) return false;
  for (let el: Element | null = element; el; el = el.parentElement) {
    let hidden = visibility.get(el);
    if (hidden === undefined) {
      const style = getComputedStyle(el);
      hidden = style.display === 'none' || style.visibility === 'hidden';
      visibility.set(el, hidden);
    }
    if (hidden) return false;
  }
  return true;
}
export function readableTextNodes(element: Element, translation = false) {
  const visibility = new Map<Element, boolean>();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && isReadableElement(parent, visibility, translation)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}
export function blockTextNodes(block: Block) {
  if (!block.textNodes) return readableTextNodes(block.element);
  if (!block.afterNode) return readableTextNodes(block.element, true);
  const nodes: Text[] = [];
  for (let node = block.startNode; node; node = node.nextSibling ?? undefined) {
    if (node instanceof Text) {
      if (isReadableElement(block.element, undefined, true)) nodes.push(node);
    } else if (node instanceof Element) nodes.push(...readableTextNodes(node, true));
    if (node === block.afterNode) break;
  }
  return nodes;
}
export function blockSourceBreaks(block: Block): Element[] {
  const breaks: Element[] = [];
  if (!block.afterNode)
    return [...block.element.querySelectorAll('br')].filter(
      (node) => !node.closest('[data-easy-learn]'),
    );
  for (let node = block.startNode; node; node = node.nextSibling ?? undefined) {
    if (node instanceof Element && !node.closest('[data-easy-learn]')) {
      if (node.tagName === 'BR') breaks.push(node);
      breaks.push(
        ...[...node.querySelectorAll('br')].filter((br) => !br.closest('[data-easy-learn]')),
      );
    }
    if (node === block.afterNode) break;
  }
  return breaks;
}

/** 按真实块边界分组，保留容器在嵌套块前后的文字，并覆盖 CSS 布局的 span/a。 */
function translationBlocks(root: ParentNode): Block[] {
  const blocks: Block[] = [];
  const visibility = new Map<Element, boolean>();
  let heading = '',
    sectionId = 0;
  const boundary = (element: HTMLElement) =>
    element.matches(
      'h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,div,section,article,main,header,footer,aside,nav,button,summary,ul,ol,dl,dt,dd,table,thead,tbody,tr,figure,figcaption,hr,[role="heading"],[role="listitem"]',
    ) || /^(block|flow-root|flex|grid|table.*|list-item)$/.test(getComputedStyle(element).display);
  const boundaries = new Map<Element, boolean>();
  const hasBoundary = (node: Element): boolean => {
    const cached = boundaries.get(node);
    if (cached !== undefined) return cached;
    const result =
      node instanceof HTMLElement &&
      isReadableElement(node, visibility, true) &&
      (boundary(node) || [...node.children].some(hasBoundary));
    boundaries.set(node, result);
    return result;
  };
  const visit = (element: HTMLElement) => {
    if (!isReadableElement(element, visibility, true)) return;
    if (element.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
      heading = readableTextNodes(element, true)
        .map((node) => node.data)
        .join('')
        .trim()
        .slice(0, 500);
      sectionId++;
    }
    let nodes: Text[] = [],
      first: ChildNode | undefined,
      last: ChildNode | undefined;
    const flush = (partial: boolean) => {
      const text = nodes
        .map((node) => node.data)
        .join('')
        .trim();
      if (/\p{L}/u.test(text))
        blocks.push({
          element,
          text,
          heading,
          sectionId,
          kind: 'prose',
          textNodes: nodes,
          ...(partial ? { startNode: first, afterNode: last } : {}),
        });
      nodes = [];
      first = last = undefined;
    };
    const mixed = [...element.children].some(hasBoundary);
    for (const child of element.childNodes) {
      if (child instanceof HTMLElement && hasBoundary(child)) {
        flush(true);
        visit(child);
      } else {
        const text =
          child instanceof Text
            ? [child]
            : child instanceof Element
              ? readableTextNodes(child, true)
              : [];
        if (text.length || (child instanceof HTMLElement && child.tagName === 'BR')) {
          first ??= child;
          last = child;
          nodes.push(...text);
        }
      }
    }
    flush(mixed);
  };
  const container = root instanceof Document ? root.body : root;
  if (container instanceof HTMLElement) visit(container);
  else for (const child of container.children) if (child instanceof HTMLElement) visit(child);
  return blocks;
}
export function readableText(element: Element): string {
  return readableTextNodes(element)
    .map((n) => n.data)
    .join('')
    .trim();
}
const SHELL_COMMANDS =
  'apt|apt-get|awk|basename|bash|brew|cargo|cat|cd|conda|go|pipx|poetry|chmod|chown|clear|cmp|comm|cp|curl|cut|date|diff|dirname|docker|echo|env|export|fastapi|file|find|git|grep|gunzip|head|hostname|jq|kill|less|ln|ls|make|man|mkdir|mktemp|more|mv|nc|node|npm|npx|openssl|pgrep|pip3?|pkill|pnpm|printf|ps|pwd|python3?|rm|rmdir|rsync|ruff|sed|seq|sh|sort|source|ssh|stat|sudo|tail|tar|tee|time|touch|tr|true|uname|uniq|uvx?|vim|wc|wget|which|whoami|xargs|yarn';
const COMMAND = new RegExp(
  '^(?:\\$\\s+)?(?:(?:sudo|time|command)\\s+(?:-[^\\s]+\\s+)*)?(?:' + SHELL_COMMANDS + ')(?=\\s|$)',
  'i',
);
const SHELL_PROMPT =
  /^(?:\([^)]+\)\s+)?(?:(?:[\w.-]+@[\w.-]+)\s*:?[ \t]*(?:~|\/[^$#>\n]*|[^$#>\n]*)[#$][ \t]*|[\w.-]+[ \t]*:[ \t]*(?:~|\/[^$#>\n]*|[^$#>\n]*)[#$][ \t]*|PS\s+[^>\n]*>\s*)/i;
function commandLine(line: string): { text: string; offset: number; prompted: boolean } | null {
  const prompt = SHELL_PROMPT.exec(line) ?? /^\s*\$\s+/.exec(line);
  const tail = line.slice(prompt?.[0].length ?? 0);
  const leading = tail.length - tail.trimStart().length;
  const text = tail.trim();
  return text && isCommand(text)
    ? { text, offset: (prompt?.[0].length ?? 0) + leading, prompted: !!prompt }
    : null;
}
function hasShellPrompt(line: string) {
  return SHELL_PROMPT.test(line) || /^\s*\$\s+/.test(line);
}
export function isCommand(text: string) {
  return COMMAND.test(text.trim());
}
export function extractBlocks(
  root: ParentNode = document,
  includeHeadings: boolean | 'translation' = false,
): Block[] {
  if (includeHeadings === 'translation') return translationBlocks(root);
  const main =
    root.querySelector('article') ??
    root.querySelector('main') ??
    root.querySelector('[role="main"]') ??
    root;
  const selectors = 'h1,h2,h3,h4,h5,h6,p,li,td,blockquote,pre,[data-ty="input"]';
  const nodes = [...main.querySelectorAll<HTMLElement>(selectors)];
  let heading = '',
    sectionId = 0;
  const blocks: Block[] = [];
  for (const element of nodes) {
    if (element.closest(EXCLUDE)) continue;
    if (/^H[1-6]$/.test(element.tagName)) {
      const text = readableText(element);
      heading = text.slice(0, 500);
      sectionId++;
      if (includeHeadings && element.tagName !== 'H1' && text.length >= 2 && text.length <= 160) {
        blocks.push({ element, text, heading, sectionId, kind: 'prose' });
      }
      continue;
    }
    if (element.matches('[data-ty="input"]')) {
      const text = readableText(element);
      if (text && text.length <= 4000)
        blocks.push({ element, text, heading, sectionId, kind: 'command' });
      continue;
    }
    if (element.tagName === 'PRE') {
      // FastAPI renders terminal input separately from a hidden duplicate code node.
      // Never analyze terminal logs, progress bars or copy controls.
      if (element.querySelector('[data-termynal],[data-ty]')) continue;
      const target = element.querySelector<HTMLElement>('code') ?? element;
      const sourceText = readableText(target);
      if (!sourceText) continue;
      const lines = sourceText.split('\n');
      let offset = 0,
        terminalOutput = false;
      for (let i = 0; i < lines.length;) {
        const command = commandLine(lines[i]);
        if (command) {
          if (command.text.length <= 8000)
            blocks.push({
              element: target,
              text: command.text,
              heading,
              sectionId,
              kind: 'command',
              offset: offset + command.offset,
              sourceText,
            });
          if (command.prompted) terminalOutput = true;
          offset += lines[i].length + 1;
          i++;
          continue;
        }
        // A prompt without an input is terminal output; never treat it as code or a command.
        if (hasShellPrompt(lines[i])) {
          terminalOutput = true;
          offset += lines[i].length + 1;
          i++;
          continue;
        }
        if (terminalOutput) {
          offset += lines[i].length + 1;
          i++;
          continue;
        }
        let count = 1;
        // A shell input after comments/code is still a command, independent of the code switch.
        if (!command)
          while (
            count < 8 &&
            i + count < lines.length &&
            !commandLine(lines[i + count]) &&
            !hasShellPrompt(lines[i + count])
          )
            count++;
        const chunk = lines.slice(i, i + count).join('\n');
        const text = chunk.trim(),
          leading = chunk.length - chunk.trimStart().length;
        if (text && text.length <= 8000)
          blocks.push({
            element: target,
            text,
            heading,
            sectionId,
            kind: 'code',
            offset: offset + leading,
            sourceText,
          });
        offset += chunk.length + 1;
        i += count;
      }
      continue;
    }
    if (element.closest('pre') || element.querySelector('p,li,td,blockquote')) continue;
    const text = readableText(element);
    if (text.length >= 2 && text.length <= 16000)
      blocks.push({ element, text, heading, sectionId, kind: 'prose' });
  }
  return blocks;
}
export function contextFor(block: Block, blocks: Block[], expanded = false): TextContext {
  const index = blocks.indexOf(block),
    prev = blocks[index - 1],
    next = blocks[index + 1];
  return {
    title: document.title.slice(0, 500),
    heading: block.heading,
    text: block.text,
    kind: block.kind ?? 'prose',
    before: prev?.sectionId === block.sectionId ? prev.text.slice(-4000) : '',
    after: next?.sectionId === block.sectionId ? next.text.slice(0, 4000) : '',
    ...(expanded
      ? {
          section: blocks
            .filter((b) => b.sectionId === block.sectionId)
            .map((b) => b.text)
            .join('\n')
            .slice(0, 24000),
        }
      : {}),
  };
}
export function locateText(element: HTMLElement, anchor: string, offset = 0): Range | null {
  const nodes = readableTextNodes(element),
    raw = nodes.map((n) => n.data).join('');
  const leading = raw.length - raw.trimStart().length;
  const start = raw.indexOf(anchor, leading + offset);
  if (start < 0 || !anchor) return null;
  const end = start + anchor.length;
  let position = 0;
  const range = document.createRange();
  let started = false;
  for (const node of nodes) {
    if (!started && start < position + node.length) {
      range.setStart(node, start - position);
      started = true;
    }
    if (started && end <= position + node.length) {
      range.setEnd(node, end - position);
      return range;
    }
    position += node.length;
  }
  return null;
}
export function matchesSnapshot(block: Block) {
  return (
    block.element.isConnected &&
    (!block.afterNode ||
      (block.startNode?.parentNode === block.element &&
        block.afterNode.parentNode === block.element)) &&
    blockTextNodes(block)
      .map((node) => node.data)
      .join('')
      .trim() === (block.sourceText ?? block.text)
  );
}
export function isExtensionMutation(record: MutationRecord) {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest('[data-easy-learn]')) return true;
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return (
    record.type === 'childList' &&
    nodes.length > 0 &&
    nodes.every((node) => node instanceof Element && node.matches('[data-easy-learn]'))
  );
}
// Whole-page quiz corpus: prose and headings only; long pages are evenly sampled.
export function quizText(blocks: Block[], cap = 15000): string {
  const parts = blocks
    .filter((block) => !block.kind || block.kind === 'prose')
    .map((block) => block.text);
  const joined = parts.join('\n\n');
  if (joined.length <= cap) return joined;
  const step = Math.max(1, Math.ceil(parts.length / Math.max(1, Math.floor(cap / 600))));
  let used = 0;
  const kept: string[] = [];
  for (let i = 0; i < parts.length && used < cap; i++) {
    if (step > 1 && i % step !== 0) continue;
    const piece = parts[i].slice(0, Math.min(2400, cap - used));
    if (piece.length < 2) continue;
    kept.push(piece);
    used += piece.length + 2;
  }
  return kept.join('\n\n');
}
