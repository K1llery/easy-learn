import { TranslationLanguageSelect, useTranslationLanguage } from './translation-language';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PdfPageText } from '../core/pdf-document';
import { samplePdfQuizText } from '../core/pdf-quiz';
import { sourcePdfPageUrl, type PdfOutlineEntry } from '../core/pdf-navigation';
import { downloadPdf, extractPdf, hasPdfHostPermission, readLocalPdf } from './pdf-source';
import { PdfPage } from './pdf-page';
import { rpc } from './rpc';
import { QuizRunner } from './quiz-runner';
import './style.css';

type Status = 'input' | 'loading' | 'ready';

function PdfApp() {
  const { targetLanguage, setTargetLanguage, ready: languageReady } = useTranslationLanguage();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [title, setTitle] = useState((params.get('title') ?? 'PDF 文档').slice(0, 500));
  const extracting = useRef(false);
  const [status, setStatus] = useState<Status>('input');
  const [pages, setPages] = useState<PdfPageText[]>([]),
    [progressLabel, setProgressLabel] = useState('');
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]),
    [loadedUrl, setLoadedUrl] = useState(''),
    [jumpPage, setJumpPage] = useState('1');
  const [error, setError] = useState(''),
    [quizOpen, setQuizOpen] = useState(false),
    [quizCount, setQuizCount] = useState(5);
  const initialExtraction = useRef({ url, extractFromUrl });
  useEffect(() => {
    const { url, extractFromUrl } = initialExtraction.current;
    void rpc<{ quizCount?: number }>('PUBLIC_SETTINGS')
      .then((s) => {
        if (typeof s.quizCount === 'number' && s.quizCount >= 2 && s.quizCount <= 8)
          setQuizCount(s.quizCount);
      })
      .catch(() => undefined);
    // Auto-extract when the host is already authorized (opened from the popup again);
    // otherwise the explicit button performs the permission request inside a user gesture.
    if (url)
      void (async () => {
        try {
          if (await hasPdfHostPermission(url)) await extractFromUrl();
        } catch {
          /* stay on the manual step. */
        }
      })();
  }, []);
  async function loadPdf(read: () => Promise<Uint8Array>, sourceUrl: string, sourceTitle: string) {
    if (extracting.current) return;
    extracting.current = true;
    setStatus('loading');
    setError('');
    setPages([]);
    setOutline([]);
    setLoadedUrl('');
    setQuizOpen(false);
    setProgressLabel('');
    try {
      const result = await extractPdf(await read(), (page, total) =>
        setProgressLabel(`第 ${page} / ${total} 页`),
      );
      setPages(result.pages);
      setOutline(result.outline);
      setLoadedUrl(sourceUrl);
      setTitle(sourceTitle);
      setJumpPage('1');
      setStatus('ready');
    } catch (e) {
      setError((e as Error).message);
      setStatus('input');
    } finally {
      extracting.current = false;
    }
  }
  async function extractFromUrl() {
    const currentUrl = url;
    let sourceTitle = 'PDF 文档';
    if (currentUrl === params.get('url') && params.get('title')) sourceTitle = params.get('title')!;
    else
      try {
        sourceTitle = decodeURIComponent(
          new URL(currentUrl).pathname.split('/').at(-1) || 'PDF 文档',
        );
      } catch {
        /* validated during download */
      }
    await loadPdf(() => downloadPdf(currentUrl), currentUrl, sourceTitle.slice(0, 500));
  }
  async function extractFromFile(file: File) {
    await loadPdf(() => readLocalPdf(file), '', file.name);
  }
  const { fullText, extractedCharacters } = useMemo(
    () => ({
      fullText: samplePdfQuizText(pages),
      extractedCharacters: pages.reduce((total, page) => total + page.text.length, 0),
    }),
    [pages],
  );
  const requestedPage = Number(jumpPage);
  const validPage =
    Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= pages.length;
  function navigateToPage(page: number) {
    setJumpPage(String(page));
    document
      .getElementById(`pdf-page-${page}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return (
    <div className="settings-page">
      <div className="brand">
        <span className="brandmark">E</span>Easy Learn <span className="muted">/ PDF 伴读</span>
      </div>
      <header className="settings-heading">
        <div className="eyebrow">文本型 PDF</div>
        <h1>把 PDF 也读起来。</h1>
        <p>提取文字后，可按目录或页码定位，再解释、翻译和检验理解。</p>
      </header>
      <section className="card">
        <span className="tag">01 · 打开 PDF</span>
        <h2 style={{ marginTop: 12 }}>PDF 地址</h2>
        <label htmlFor="pdf-url">URL</label>
        <input
          id="pdf-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/paper.pdf"
        />
        <p className="form-help">扫描版 PDF 没有文字层，无法提取。</p>
        <div className="actions">
          <button
            className="primary"
            disabled={!url.trim() || status === 'loading'}
            onClick={() => void extractFromUrl()}
          >
            {status === 'loading' ? '正在提取…' : '提取网址中的 PDF'}
          </button>
        </div>
        <label htmlFor="pdf-local-file">或选择本机 PDF</label>
        <input
          id="pdf-local-file"
          type="file"
          accept=".pdf,application/pdf"
          disabled={status === 'loading'}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void extractFromFile(file);
            event.target.value = '';
          }}
        />
        <p className="form-help">
          本机文件只在此浏览器中提取文字，不会整份发送给模型；解释、测验或提交回答时才发送相应内容。
        </p>
        {status === 'loading' && (
          <div className="busy" role="status">
            <span className="dot" />
            正在提取文字… {progressLabel}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </section>
      {pages.length > 0 && (
        <section className="card" aria-label="PDF 导航">
          <span className="tag">02 · 定位原文</span>
          <h2 style={{ marginTop: 12 }}>快速找到要读的页面</h2>
          <p className="muted">当前文档 · {title}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (validPage) navigateToPage(requestedPage);
            }}
          >
            <label htmlFor="pdf-jump-page">跳到页码（共 {pages.length} 页）</label>
            <input
              id="pdf-jump-page"
              type="number"
              min={1}
              max={pages.length}
              step={1}
              value={jumpPage}
              onChange={(event) => setJumpPage(event.target.value)}
            />
            <div className="actions">
              <button type="submit" disabled={!validPage}>
                跳到提取文字
              </button>
              {loadedUrl && (
                <button
                  type="button"
                  disabled={!validPage}
                  onClick={() => {
                    const target = sourcePdfPageUrl(loadedUrl, requestedPage);
                    if (target) void chrome.tabs.create({ url: target });
                  }}
                >
                  在原 PDF 查看这一页
                </button>
              )}
            </div>
          </form>
          {outline.length > 0 ? (
            <details>
              <summary>文档自带目录 · {outline.length} 项</summary>
              <div style={{ maxHeight: 270, overflow: 'auto', marginTop: 10 }}>
                {outline.map((item, index) => (
                  <div key={`${index}-${item.page}`} style={{ marginLeft: item.depth * 14 }}>
                    <button className="quiet" onClick={() => navigateToPage(item.page)}>
                      {item.title} · 第 {item.page} 页
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <p className="muted">这份 PDF 没有可用的内置目录，可用页码跳转。</p>
          )}
          <p className="muted">
            目录来自 PDF 自带书签，最多读取前 120 项；图表、公式和排版请在原 PDF 中核对。
          </p>
        </section>
      )}
      {pages.length > 0 && (
        <section className="card">
          <span className="tag">03 · 学习工具</span>
          <h2 style={{ marginTop: 12 }}>整份 PDF 抽样测验</h2>
          <p className="muted">
            基于提取的文字出 {quizCount}{' '}
            道选择题。长文档会抽取开头、中间和结尾的页面；未抽到的页面不会被考到。也可以在下方逐页解释、翻译或出题。
          </p>
          <div className="actions">
            <button className="primary" disabled={!fullText} onClick={() => setQuizOpen(true)}>
              开始抽样测验
            </button>
            <button
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') })}
            >
              粘贴文本面板
            </button>
          </div>
          <p className="muted">
            共 {pages.length} 页 · 提取 {extractedCharacters} 字符 · 本次测验发送 {fullText.length}{' '}
            字符给你配置的模型服务。
          </p>
        </section>
      )}
      <TranslationLanguageSelect
        value={targetLanguage}
        disabled={!languageReady}
        onChange={setTargetLanguage}
      />
      {pages.map((page) => (
        <PdfPage
          translationReady={languageReady}
          targetLanguage={targetLanguage}
          key={page.page}
          page={page}
          title={title}
          sourceUrl={loadedUrl}
        />
      ))}
      {quizOpen && (
        <div
          role="dialog"
          aria-label="整份 PDF 抽样测验"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: '#00000080',
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setQuizOpen(false);
          }}
        >
          <div
            style={{
              width: 'min(560px, calc(100vw - 32px))',
              maxHeight: 'min(80vh, 660px)',
              overflow: 'auto',
              borderRadius: 18,
            }}
          >
            <QuizRunner
              source={{ title, text: fullText, count: quizCount }}
              onClose={() => setQuizOpen(false)}
              onNavigatePage={(page) => {
                setQuizOpen(false);
                navigateToPage(page);
              }}
              label="整份 PDF 抽样测验"
            />
          </div>
        </div>
      )}
      <div className="footer">EASY LEARN · PDF 伴读 · AI 的解释可能有误</div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<PdfApp />);
