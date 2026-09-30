import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { type Explanation, type TextContext } from '../core/types';
import { samplePdfQuizText } from '../core/pdf-quiz';
import { readPdfOutline, sourcePdfPageUrl, type PdfOutlineEntry } from '../core/pdf-navigation';
import { rpc } from './rpc';
import { useAction } from './use-action';
import { QuizRunner } from './quiz-runner';
import { QuickQuiz } from './quick-quiz';
import { MeaningCheck } from './meaning-check';
import './style.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PageText = { page: number; text: string };
type ExtractedPdf = { pages: PageText[]; outline: PdfOutlineEntry[] };
type Status = 'input' | 'loading' | 'ready';
function normalize(text: string) { return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
async function pdfHostPermission(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('PDF 地址无效，请填写完整网址，或直接选择本机文件。'); }
  if (parsed.protocol === 'file:') throw new Error('本机 PDF 请使用下方的文件选择入口。');
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 HTTPS / HTTP 的 PDF 网址；本机文件请使用文件选择入口。');
  const origin = parsed.origin + '/*';
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}
async function downloadPdf(url: string): Promise<Uint8Array> {
  if (!(await pdfHostPermission(url))) throw new Error('未授权访问该 PDF 所在网站，无法读取文件。');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法下载 PDF（HTTP ${response.status}）。`);
  return new Uint8Array(await response.arrayBuffer());
}
async function extractPdf(data: Uint8Array, onPage: (page: number, total: number) => void): Promise<ExtractedPdf> {
  const task = pdfjs.getDocument({ data, cMapUrl: chrome.runtime.getURL('pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: chrome.runtime.getURL('pdfjs/standard-fonts/') });
  try {
    const doc = await task.promise;
    const collected: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      onPage(i, doc.numPages);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      collected.push({ page: i, text: normalize(text) });
      page.cleanup();
    }
    if (!collected.some(page => page.text)) throw new Error('没有提取到文字。这个 PDF 可能是扫描图片，请改用粘贴文本面板或 OCR 工具。');
    return { pages: collected, outline: await readPdfOutline(doc) };
  } finally { await task.destroy().catch(() => undefined); }
}
function PageCard({ page, title, sourceUrl }: { page: PageText; title: string; sourceUrl: string }) {
  const [mode, setMode] = useState<null | 'explain' | 'translate' | 'quiz' | 'check'>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null), [translation, setTranslation] = useState('');
  const [selectedText, setSelectedText] = useState(''), [selectionTruncated, setSelectionTruncated] = useState(false);
  const [usedText, setUsedText] = useState('');
  const [sourceExpanded, setSourceExpanded] = useState(false), [sourceOverflow, setSourceOverflow] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const { busy, error, run } = useAction();
  useEffect(() => {
    const source = sourceRef.current;
    if (!source || sourceExpanded) return;
    const measure = () => setSourceOverflow(source.scrollHeight > source.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(source);
    return () => observer.disconnect();
  }, [page.text, mode, sourceExpanded]);
  const context: TextContext = { title, heading: `第 ${page.page} 页`, text: page.text.slice(0, 16000), before: '', after: '' };
  function captureSelection() {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !sourceRef.current?.contains(range.commonAncestorContainer)) return;
    const text = selection!.toString().trim();
    if (!text) return;
    setSelectedText(text.slice(0, 4000));
    setSelectionTruncated(text.length > 4000);
  }
  function act(next: 'explain' | 'translate', excerpt?: string) {
    setMode(next);
    const focus = excerpt || context.text;
    setUsedText(excerpt || '');
    void run(next === 'translate' ? '正在翻译文字…' : '正在结合上下文解释…', () => rpc<Explanation>('AI', { request: { operation: 'explain', mode: next, context: { ...context, text: focus } } }), data => {
      if (next === 'translate') { setTranslation(data.translation || data.explanation); setExplanation(null); }
      else setExplanation(data);
    });
  }
  const textPages = page.text.length > 16000;
  const originalPageUrl = sourcePdfPageUrl(sourceUrl, page.page);
  return <section className="card" id={`pdf-page-${page.page}`} aria-label={`第 ${page.page} 页`}><span className="tag">第 {page.page} 页{page.text ? '' : ' · 无文字'}</span>
    {page.text && mode !== 'quiz' ? <><div className="source" id={`pdf-source-${page.page}`} ref={sourceRef} style={{maxHeight: sourceExpanded ? 'none' : 220}} onMouseUp={captureSelection} onKeyUp={captureSelection}>{page.text}</div>{sourceOverflow && <button className="quiet" aria-expanded={sourceExpanded} aria-controls={`pdf-source-${page.page}`} onClick={() => setSourceExpanded(!sourceExpanded)}>{sourceExpanded ? '收起本页文字' : '展开本页文字'}</button>}</> : !page.text ? <p className="muted">这一页没有可提取的文字（可能是图片）。</p> : null}
    {selectedText && mode !== 'quiz' && <div className="notice" aria-label="PDF 选段操作"><p>已选中 {selectedText.length} 字符{selectionTruncated ? '（超过 4,000 字符，仅处理前 4,000 字符）' : ''}。正文只发送选中内容，另附文档标题和页码。</p><div className="actions"><button disabled={!!busy || selectionTruncated || selectedText.length > 1200} onClick={() => setMode('check')}>先试着理解</button><button disabled={!!busy} onClick={() => act('explain', selectedText)}>解释选中内容</button><button disabled={!!busy} onClick={() => act('translate', selectedText)}>翻译选中内容</button><button className="quiet" onClick={() => { setSelectedText(''); setMode(null); }}>清除选段</button></div>{selectedText.length > 1200 && <p>理解核对适合一两句话，请缩短选段至 1,200 字符以内。</p>}</div>}
    {page.text && <div className="actions">
      <button disabled={!!busy} onClick={() => act('explain')}>解释这一页</button>
      <button disabled={!!busy} onClick={() => act('translate')}>翻译这一页</button>
      <button disabled={!!busy} className={mode === 'quiz' ? 'primary' : ''} onClick={() => { setSelectedText(''); setMode(mode === 'quiz' ? null : 'quiz'); }}>考考这一页</button>
      {originalPageUrl && <button className="quiet" onClick={() => void chrome.tabs.create({ url: originalPageUrl })}>查看原 PDF 本页</button>}
    </div>}
    {textPages && <p className="muted">整页解释、翻译和快测仅使用本页前 16,000 字符；仍可选中后面的难句单独处理。</p>}
    {busy && <div className="busy" role="status"><span className="dot"/>{busy}</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {mode === 'check' && selectedText && <MeaningCheck key={selectedText} context={{ ...context, text: selectedText }}/>}
    {mode === 'quiz' && page.text && <QuickQuiz context={context} active/>}
    {explanation && mode === 'explain' && <section className="card" aria-label={usedText ? '选段解释' : '本页解释'}><span className="tag">{usedText ? '选段解释' : '本页解释'}</span>{usedText && <p className="source">{usedText}</p>}<h2 style={{marginTop: 12}}>{explanation.meaning}</h2><p style={{marginTop: 12}}>{explanation.explanation}</p>{explanation.example && <p className="muted">例如：{explanation.example}</p>}</section>}
    {translation && mode === 'translate' && <section className="card" aria-label={usedText ? '选段翻译' : '本页翻译'}><span className="tag">中文翻译</span>{usedText && <p className="source">{usedText}</p>}<p style={{marginTop: 12, whiteSpace: 'pre-wrap'}}>{translation}</p></section>}
  </section>;
}
function PdfApp() {
  const params = new URLSearchParams(window.location.search);
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [title, setTitle] = useState((params.get('title') ?? 'PDF 文档').slice(0, 500));
  const extracting = useRef(false);
  const [status, setStatus] = useState<Status>('input');
  const [pages, setPages] = useState<PageText[]>([]), [progressLabel, setProgressLabel] = useState('');
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]), [loadedUrl, setLoadedUrl] = useState(''), [jumpPage, setJumpPage] = useState('1');
  const [error, setError] = useState(''), [quizOpen, setQuizOpen] = useState(false), [quizCount, setQuizCount] = useState(5);
  useEffect(() => {
    void rpc<{quizCount?: number}>('PUBLIC_SETTINGS').then(s => { if (typeof s.quizCount === 'number' && s.quizCount >= 2 && s.quizCount <= 8) setQuizCount(s.quizCount); }).catch(() => undefined);
    // Auto-extract when the host is already authorized (opened from the popup again);
    // otherwise the explicit button performs the permission request inside a user gesture.
    if (url) void (async () => {
      try {
        const parsed = new URL(url);
        if (['http:', 'https:'].includes(parsed.protocol) && await chrome.permissions.contains({origins: [parsed.origin + '/*']})) await extractFromUrl();
      } catch { /* stay on the manual step. */ }
    })();
  }, []);
  async function loadPdf(read: () => Promise<Uint8Array>, sourceUrl: string, sourceTitle: string) {
    if (extracting.current) return;
    extracting.current = true;
    setStatus('loading'); setError(''); setPages([]); setOutline([]); setLoadedUrl(''); setQuizOpen(false); setProgressLabel('');
    try {
      const result = await extractPdf(await read(), (page, total) => setProgressLabel(`第 ${page} / ${total} 页`));
      setPages(result.pages); setOutline(result.outline); setLoadedUrl(sourceUrl); setTitle(sourceTitle); setJumpPage('1'); setStatus('ready');
    } catch (e) { setError((e as Error).message); setStatus('input'); }
    finally { extracting.current = false; }
  }
  async function extractFromUrl() {
    const currentUrl = url;
    let sourceTitle = 'PDF 文档';
    if (currentUrl === params.get('url') && params.get('title')) sourceTitle = params.get('title')!;
    else try { sourceTitle = decodeURIComponent(new URL(currentUrl).pathname.split('/').at(-1) || 'PDF 文档'); } catch { /* validated during download */ }
    await loadPdf(() => downloadPdf(currentUrl), currentUrl, sourceTitle.slice(0, 500));
  }
  async function extractFromFile(file: File) {
    await loadPdf(async () => {
      if (file.size > 100 * 1024 * 1024) throw new Error('这个 PDF 超过 100 MB，请使用较小的文件或提取需要阅读的章节。');
      return new Uint8Array(await file.arrayBuffer());
    }, '', file.name);
  }
  const fullText = samplePdfQuizText(pages);
  const extractedCharacters = pages.reduce((total, page) => total + page.text.length, 0);
  const requestedPage = Number(jumpPage);
  const validPage = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= pages.length;
  function navigateToPage(page: number) {
    setJumpPage(String(page));
    document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return <div className="settings-page"><div className="brand"><span className="brandmark">E</span>Easy Learn <span className="muted">/ PDF 伴读</span></div>
    <header className="settings-heading"><div className="eyebrow">文本型 PDF</div><h1>把 PDF 也读起来。</h1><p>提取文字后，可按目录或页码定位，再解释、翻译和检验理解。</p></header>
    <section className="card"><span className="tag">01 · 打开 PDF</span><h2 style={{marginTop: 12}}>PDF 地址</h2>
      <label htmlFor="pdf-url">URL</label><input id="pdf-url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/paper.pdf"/>
      <p className="form-help">扫描版 PDF 没有文字层，无法提取。</p>
      <div className="actions"><button className="primary" disabled={!url.trim() || status === 'loading'} onClick={() => void extractFromUrl()}>{status === 'loading' ? '正在提取…' : '提取网址中的 PDF'}</button></div>
      <label htmlFor="pdf-local-file">或选择本机 PDF</label><input id="pdf-local-file" type="file" accept=".pdf,application/pdf" disabled={status === 'loading'} onChange={event => { const file = event.target.files?.[0]; if (file) void extractFromFile(file); event.target.value = ''; }}/>
      <p className="form-help">本机文件只在此浏览器中提取文字，不会整份发送给模型；解释、测验或提交回答时才发送相应内容。</p>
      {status === 'loading' && <div className="busy" role="status"><span className="dot"/>正在提取文字… {progressLabel}</div>}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
    {pages.length > 0 && <section className="card" aria-label="PDF 导航"><span className="tag">02 · 定位原文</span><h2 style={{marginTop: 12}}>快速找到要读的页面</h2>
      <p className="muted">当前文档 · {title}</p>
      <form onSubmit={event => { event.preventDefault(); if (validPage) navigateToPage(requestedPage); }}>
        <label htmlFor="pdf-jump-page">跳到页码（共 {pages.length} 页）</label>
        <input id="pdf-jump-page" type="number" min={1} max={pages.length} step={1} value={jumpPage} onChange={event => setJumpPage(event.target.value)}/>
        <div className="actions"><button type="submit" disabled={!validPage}>跳到提取文字</button>{loadedUrl && <button type="button" disabled={!validPage} onClick={() => { const target = sourcePdfPageUrl(loadedUrl, requestedPage); if (target) void chrome.tabs.create({ url: target }); }}>在原 PDF 查看这一页</button>}</div>
      </form>
      {outline.length > 0 ? <details><summary>文档自带目录 · {outline.length} 项</summary><div style={{maxHeight: 270, overflow: 'auto', marginTop: 10}}>{outline.map((item, index) => <div key={`${index}-${item.page}`} style={{marginLeft: item.depth * 14}}><button className="quiet" onClick={() => navigateToPage(item.page)}>{item.title} · 第 {item.page} 页</button></div>)}</div></details> : <p className="muted">这份 PDF 没有可用的内置目录，可用页码跳转。</p>}
      <p className="muted">目录来自 PDF 自带书签，最多读取前 120 项；图表、公式和排版请在原 PDF 中核对。</p>
    </section>}
    {pages.length > 0 && <section className="card"><span className="tag">03 · 学习工具</span><h2 style={{marginTop: 12}}>整份 PDF 抽样测验</h2>
      <p className="muted">基于提取的文字出 {quizCount} 道选择题。长文档会抽取开头、中间和结尾的页面；未抽到的页面不会被考到。也可以在下方逐页解释、翻译或出题。</p>
      <div className="actions"><button className="primary" disabled={!fullText} onClick={() => setQuizOpen(true)}>开始抽样测验</button><button onClick={() => void chrome.tabs.create({url: chrome.runtime.getURL('panel.html')})}>粘贴文本面板</button></div>
      <p className="muted">共 {pages.length} 页 · 提取 {extractedCharacters} 字符 · 本次测验发送 {fullText.length} 字符给你配置的模型服务。</p>
    </section>}
    {pages.map(page => <PageCard key={page.page} page={page} title={title} sourceUrl={loadedUrl}/>)}
    {quizOpen && <div role="dialog" aria-label="整份 PDF 抽样测验" style={{position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#00000080'}} onMouseDown={e => { if (e.target === e.currentTarget) setQuizOpen(false); }}>
      <div style={{width: 'min(560px, calc(100vw - 32px))', maxHeight: 'min(80vh, 660px)', overflow: 'auto', borderRadius: 18}}>
        <QuizRunner source={{title, text: fullText, count: quizCount}} onClose={() => setQuizOpen(false)} onNavigatePage={page => { setQuizOpen(false); navigateToPage(page); }} label="整份 PDF 抽样测验"/>
      </div>
    </div>}
    <div className="footer">EASY LEARN · PDF 伴读 · AI 的解释可能有误</div></div>;
}
createRoot(document.getElementById('root')!).render(<PdfApp/>);
