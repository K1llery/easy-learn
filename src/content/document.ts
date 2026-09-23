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
const SHELL_COMMANDS = 'apt|apt-get|awk|basename|bash|brew|cargo|cat|conda|go|pipx|poetry|chmod|chown|clear|cmp|comm|cp|curl|cut|date|diff|dirname|docker|echo|env|export|fastapi|file|find|git|grep|gunzip|head|hostname|jq|kill|less|ln|ls|make|man|mkdir|mktemp|more|mv|nc|node|npm|npx|openssl|pgrep|pip3?|pkill|pnpm|printf|ps|pwd|python3?|rm|rmdir|rsync|ruff|sed|seq|sh|sort|source|ssh|stat|sudo|tail|tar|tee|time|touch|tr|true|uname|uniq|uvx?|vim|wc|wget|which|whoami|xargs|yarn';
const COMMAND = new RegExp('^(?:\\$\\s+)?(?:(?:sudo|time|command)\\s+(?:-[^\\s]+\\s+)*)?(?:' + SHELL_COMMANDS + ')(?=\\s|$)', 'i');
const SHELL_PROMPT = /^(?:\([^)]+\)\s+)?(?:(?:[\w.-]+@[\w.-]+)\s*:?[ \t]*(?:~|\/[^$#>\n]*|[^$#>\n]*)[#$][ \t]*|[\w.-]+[ \t]*:[ \t]*(?:~|\/[^$#>\n]*|[^$#>\n]*)[#$][ \t]*|PS\s+[^>\n]*>\s*)/i;
function commandLine(line: string): { text: string; offset: number; prompted: boolean } | null {
  const prompt = SHELL_PROMPT.exec(line) ?? /^\s*\$\s+/.exec(line);
  const tail = line.slice(prompt?.[0].length ?? 0);
  const leading = tail.length - tail.trimStart().length;
  const text = tail.trim();
  return text && isCommand(text) ? { text, offset: (prompt?.[0].length ?? 0) + leading, prompted: !!prompt } : null;
}
function hasShellPrompt(line: string) { return SHELL_PROMPT.test(line) || /^\s*\$\s+/.test(line); }
export function isCommand(text: string) { return COMMAND.test(text.trim()); }
export function extractBlocks(root: ParentNode = document, includeHeadings = false): Block[] {
  const main = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('[role="main"]') ?? root;
  const nodes = [...main.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,td,blockquote,pre,[data-ty="input"]')];
  let heading = '', sectionId = 0;
  const blocks: Block[] = [];
  for (const element of nodes) {
    if (element.closest(EXCLUDE)) continue;
    if (/^H[1-6]$/.test(element.tagName)) { heading = readableText(element).slice(0, 500); sectionId++; if(includeHeadings&&element.tagName!=='H1'&&heading.length>=2&&heading.length<=160)blocks.push({element,text:heading,heading,sectionId,kind:'prose'}); continue; }
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
      const lines = sourceText.split('\n'); let offset = 0, terminalOutput = false;
      for (let i = 0; i < lines.length; ) {
        const command = commandLine(lines[i]);
        if (command) {
          if (command.text.length <= 8000) blocks.push({element:target,text:command.text,heading,sectionId,kind:'command',offset:offset+command.offset,sourceText});
          if(command.prompted)terminalOutput=true;
          offset += lines[i].length + 1; i++; continue;
        }
        // A prompt without an input is terminal output; never treat it as code or a command.
        if (hasShellPrompt(lines[i])) { terminalOutput=true; offset += lines[i].length + 1; i++; continue; }
        if(terminalOutput){offset += lines[i].length + 1;i++;continue;}
        let count = 1;
        // A shell input after comments/code is still a command, independent of the code switch.
        if (!command) while (count < 8 && i + count < lines.length && !commandLine(lines[i + count]) && !hasShellPrompt(lines[i + count])) count++;
        const chunk = lines.slice(i, i + count).join('\n');
        const text = chunk.trim(), leading = chunk.length - chunk.trimStart().length;
        if (text && text.length <= 8000) blocks.push({element:target,text,heading,sectionId,kind:'code',offset:offset+leading,sourceText});
        offset += chunk.length + 1; i += count;
      }
      continue;
    }
    if (element.closest('pre') || element.querySelector('p,li,td,blockquote')) continue;
    const text = readableText(element);
    if (text.length >= 2 && text.length <= 16000) blocks.push({ element, text, heading, sectionId, kind:'prose' });
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
