import { unzipSync, strFromU8 } from 'fflate';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Packaging from 'epubjs/src/packaging.js';
import Container from 'epubjs/src/container.js';

export type ReadingSection = {id: string; title: string; text: string; depth?:number; pageStart?:number; pageEnd?:number; top?:number; pageSpans?:{page:number;start:number;end:number}[]};
export type ReadingDocument = {title: string; language: string; format: string; sections: ReadingSection[]; structure?:'outline'|'headings'|'fragments'; pageCount?:number};
const MAX_TEXT = 3_000_000;
export function sectionsFromText(text: string, title: string): ReadingSection[] {
  const parts: string[] = [];
  let rest = text.replace(/\r\n?/g, '\n').trim();
  while (rest.length) {
    let end = Math.min(10000, rest.length);
    if (end < rest.length) { const boundary = rest.lastIndexOf('\n', end); if (boundary > end / 2) end = boundary + 1; }
    parts.push(rest.slice(0, end).trim()); rest = rest.slice(end);
  }
  return parts.map((text, i) => ({id: '', title: parts.length > 1 ? `${title} · ${i + 1}` : title, text}));
}
function validateDocument(doc: ReadingDocument): ReadingDocument {
  if (!doc.sections.some(s => s.text.trim())) throw new Error('没有找到可阅读的文字。扫描 PDF 需要先用 OCR 提取文字。');
  if (doc.sections.reduce((n,s) => n + s.text.length, 0) > MAX_TEXT || doc.sections.length > 2000) throw new Error('文档文字过多，请按章节拆分后导入（最多 300 万字符 / 2000 节）。');
  return {...doc, title:doc.title.slice(0,500), sections: doc.sections.filter(s => s.text.trim()).map((s,i) => ({...s,title:s.title.slice(0,500),id:`s${i}`}))};
}
export function htmlText(html: string): {title: string; text: string} {
  // Detached parsing; no markup, scripts, links, images or event handlers are mounted.
  const clean = DOMPurify.sanitize(html, {ALLOWED_TAGS:['p','div','section','article','li','ul','ol','h1','h2','h3','h4','h5','h6','pre','code','tr','td','th','table','blockquote','br','em','strong','span','a'], ALLOWED_ATTR:[]});
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('script,style,noscript,iframe,object,embed,svg').forEach(el => el.remove());
  const title = doc.querySelector('h1,h2,title')?.textContent?.trim() ?? '';
  doc.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  doc.querySelectorAll('p,div,section,article,li,h1,h2,h3,h4,h5,h6,pre,tr,blockquote').forEach(el => el.append('\n\n'));
  return {title, text: (doc.body.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()};
}
export function textDocument(text: string, name: string, markdown = false): ReadingDocument {
  if (text.length > MAX_TEXT) throw new Error('文字超过 300 万字符，请按章节拆分。');
  if (text.includes('\u0000')) throw new Error('无法读取该文本编码，请将文件另存为 UTF-8。');
  let title = name, sections: ReadingSection[];
  if (markdown) {
    const tokens = marked.lexer(text), chunks: {title:string; raw:string}[] = [];
    let current = {title:name, raw:''};
    for (const token of tokens) {
      if (token.type === 'heading' && token.depth <= 2) {
        if (current.raw.trim()) chunks.push(current);
        current = {title:token.text,raw:token.raw};
        if (title === name && token.depth === 1) title = token.text;
      } else current.raw += token.raw;
    }
    if (current.raw.trim()) chunks.push(current);
    sections = chunks.flatMap(chunk => sectionsFromText(htmlText(marked.parse(chunk.raw, {async:false})).text, chunk.title));
  } else sections = sectionsFromText(text, name);
  return validateDocument({title,language:'en',format:markdown?'Markdown':'TXT',sections});
}
function xml(text: string) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('EPUB 的目录或元数据损坏，无法读取。');
  return doc;
}
export function epubPath(base: string, href: string): string {
  const url = new URL(href, 'https://epub.invalid/' + base);
  if (url.origin !== 'https://epub.invalid') throw new Error('EPUB 章节必须包含在文件中。');
  return decodeURIComponent(url.pathname.slice(1));
}
export function epubDocument(data: Uint8Array, name: string): ReadingDocument {
  let expanded = 0, count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {filter(entry) {
      if (++count > 10000) throw new Error('EPUB 内部文件过多。');
      if (!/\.(?:xml|opf|xhtml|html|htm)$/i.test(entry.name)) return false;
      expanded += entry.originalSize;
      if (entry.originalSize > 8 * 1024 * 1024 || expanded > 32 * 1024 * 1024) throw new Error('EPUB 解压后的文字文件过大，请按章节拆分。');
      return true;
    }});
  } catch (e) { throw new Error(`无法打开 EPUB：${(e as Error).message}`); }
  const read = (path: string) => {
    const file = files[path] ?? files[encodeURI(path)]; if (!file) throw new Error(`EPUB 缺少章节或目录：${path}`);
    return strFromU8(file);
  };
  if (files['META-INF/encryption.xml']) {
    const encryption = xml(read('META-INF/encryption.xml'));
    const fontObfuscation = new Set(['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC']);
    if (Array.from(encryption.getElementsByTagNameNS('*','EncryptionMethod')).some(el=>!fontObfuscation.has(el.getAttribute('Algorithm')??''))) throw new Error('暂不支持 DRM EPUB，请使用无保护的文件。');
  }
  // Reuse EPUB.js container and OPF parsers rather than implementing the EPUB specification.
  const container = new Container(xml(read('META-INF/container.xml')));
  const packagePath = container.packagePath;
  if (!packagePath) throw new Error('EPUB 缺少有效的书籍目录。');
  const opf = new Packaging(xml(read(packagePath)));
  const title = opf.metadata.title || name;
  const language = opf.metadata.language || 'en';
  const sections: ReadingSection[] = [];
  for (const item of opf.spine) {
    if (item.linear === 'no') continue;
    const target = opf.manifest[item.idref];
    if (!target || !['application/xhtml+xml', 'text/html'].includes(target.type)) continue;
    const chapter = htmlText(read(epubPath(packagePath, target.href)));
    sections.push(...sectionsFromText(chapter.text, chapter.title || `第 ${sections.length + 1} 章`));
  }
  return validateDocument({title,language,format:'EPUB',sections});
}
export function pdfReadingDocument(pages: {page:number;text:string}[], title:string) {
  return validateDocument({title,language:'en',format:'PDF',sections:pages.flatMap(p => sectionsFromText(p.text,`第 ${p.page} 页`))});
}
