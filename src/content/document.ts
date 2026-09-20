import type { TextContext } from '../core/types';
const EXCLUDE = 'nav,header,footer,aside,script,style,noscript,textarea,input,select,button,[contenteditable]:not([contenteditable="false"]),[role="navigation"],[role="banner"],[role="complementary"],[aria-hidden="true"],[hidden],[data-ad],[data-ad-slot],.advertisement,.ads,[data-easy-learn]';
export type Block = { element: HTMLElement; text: string; heading: string; sectionId: number; kind?: 'prose' | 'command' | 'code'; offset?: number; sourceText?: string };
function textNodes(element: Element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(EXCLUDE)) return NodeFilter.FILTER_REJECT;
    for (let el: Element | null = parent; el; el = el.parentElement) {
      if (el instanceof HTMLElement && (el.style.display === 'none' || el.style.visibility === 'hidden')) return NodeFilter.FILTER_REJECT;
      if (el === element) break;
    }
    return NodeFilter.FILTER_ACCEPT;
  } });
  const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}
export function readableText(element: Element): string { return textNodes(element).map(n => n.data).join('').trim(); }
export function isCommand(text: string) { return /^(?:\$\s+)?(?:uv|uvx|pip3?|python3?|fastapi|cd|npm|pnpm|git|docker|curl)\s+/.test(text.trim()); }
export function extractBlocks(root: ParentNode = document): Block[] {
  const main = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('[role="main"]') ?? root;
  const nodes = [...main.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,td,blockquote,pre,[data-ty="input"]')];
  let heading = '', sectionId = 0;
  const blocks: Block[] = [];
  for (const element of nodes) {
    if (element.closest(EXCLUDE)) continue;
    if (/^H[1-6]$/.test(element.tagName)) { heading = readableText(element).slice(0, 500); sectionId++; continue; }
    if (element.matches('[data-ty="input"]')) {
      const text = readableText(element);
      if (text && text.length <= 4000) blocks.push({element,text,heading,sectionId,kind:'command'});
      continue;
    }
    if (element.tagName === 'PRE') {
      // FastAPI renders terminal input separately from a hidden duplicate code node.
      // Never analyze terminal logs, progress bars or copy controls.
      if (element.querySelector('[data-termynal],[data-ty]')) continue;
      const target = element.querySelector<HTMLElement>('code') ?? element;
      const sourceText = readableText(target); if (!sourceText) continue;
      const lines = sourceText.split('\n'); let offset = 0;
      for (let i = 0; i < lines.length; ) {
        const command = isCommand(lines[i]);
        let count = 1;
        // A shell input after comments/code is still a command, independent of the code switch.
        if (!command) while (count < 8 && i + count < lines.length && !isCommand(lines[i + count])) count++;
        const chunk = lines.slice(i, i + count).join('\n');
        const text = chunk.trim(), leading = chunk.length - chunk.trimStart().length;
        if (text && text.length <= 8000) blocks.push({element:target,text,heading,sectionId,kind:command?'command':'code',offset:offset+leading,sourceText});
        offset += chunk.length + 1; i += count;
      }
      continue;
    }
    if (element.closest('pre') || element.querySelector('p,li,td,blockquote')) continue;
    const text = readableText(element);
    if (text.length >= 30 && text.length <= 16000) blocks.push({ element, text, heading, sectionId, kind:'prose' });
  }
  return blocks;
}
export function contextFor(block: Block, blocks: Block[], expanded = false): TextContext {
  const index = blocks.indexOf(block), prev = blocks[index - 1], next = blocks[index + 1];
  return { title: document.title.slice(0, 500), heading: block.heading, text: block.text, kind:block.kind ?? 'prose',
    before: prev?.sectionId === block.sectionId ? prev.text.slice(-4000) : '',
    after: next?.sectionId === block.sectionId ? next.text.slice(0, 4000) : '',
    ...(expanded ? { section: blocks.filter(b => b.sectionId === block.sectionId).map(b => b.text).join('\n').slice(0, 24000) } : {}) };
}
export function locateText(element: HTMLElement, anchor: string, offset = 0): Range | null {
  const nodes = textNodes(element), raw = nodes.map(n => n.data).join('');
  const leading = raw.length - raw.trimStart().length;
  const start = raw.indexOf(anchor, leading + offset); if (start < 0 || !anchor) return null;
  const end = start + anchor.length; let position = 0; const range = document.createRange(); let started = false;
  for (const node of nodes) {
    if (!started && start < position + node.length) { range.setStart(node, start - position); started = true; }
    if (started && end <= position + node.length) { range.setEnd(node, end - position); return range; }
    position += node.length;
  }
  return null;
}
export function matchesSnapshot(block: Block) { return block.element.isConnected && readableText(block.element) === (block.sourceText ?? block.text); }
