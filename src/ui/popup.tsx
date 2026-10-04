import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { startCurrentPage } from './start-reading';
import './style.css';

function Popup() {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; title: string } | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(false);
    setPdf(null);
    try {
      await startCurrentPage();
      window.close();
    } catch {
      setError(true);
      setBusy(false);
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && /\.pdf($|[?#])/i.test(tab.url))
          setPdf({ url: tab.url, title: tab.title ?? 'PDF 文档' });
      } catch {
        /* URL not available; keep the generic fallback. */
      }
    }
  }

  function openPdfReader() {
    if (!pdf) return;
    void chrome.tabs.create({
      url: chrome.runtime.getURL(
        `pdf.html?url=${encodeURIComponent(pdf.url)}&title=${encodeURIComponent(pdf.title.slice(0, 300))}`,
      ),
    });
    window.close();
  }

  const initialStart = useRef(start);
  useEffect(() => {
    void initialStart.current();
  }, []);

  return (
    <main className="popup-page" aria-live="polite">
      <div className="brand">
        <span className="brandmark">E</span>Easy Learn <span className="muted">/ 伴读</span>
      </div>
      <h1>{error ? '当前页面无法开启伴读' : '正在切换伴读状态…'}</h1>
      <p className="muted">
        {error
          ? '浏览器暂不允许在此页面注入。文本型 PDF 可以在 Easy Learn 的阅读页中提取文字学习；扫描版 PDF 请打开粘贴面板。'
          : '完成后此窗口会自动关闭；点击网页右侧悬浮球可开启或关闭生词翻译。'}
      </p>
      <div className="actions">
        <button
          onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') })}
        >
          打开阅读工作台
        </button>
      </div>
      {error && (
        <div className="actions">
          {pdf && (
            <button className="primary" onClick={openPdfReader}>
              用 Easy Learn 阅读此 PDF
            </button>
          )}
          <button className={pdf ? '' : 'primary'} disabled={busy} onClick={() => void start()}>
            重试
          </button>
          <button
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') })}
          >
            打开粘贴文本面板
          </button>
          <button className="quiet" onClick={() => void chrome.runtime.openOptionsPage()}>
            设置
          </button>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
