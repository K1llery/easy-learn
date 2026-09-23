import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { startCurrentPage } from './start-reading';
import './style.css';

function Popup() {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      await startCurrentPage();
      window.close();
    } catch {
      setError(true); setBusy(false);
    }
  }

  useEffect(() => { void start(); }, []);

  return <main className="popup-page" aria-live="polite">
    <div className="brand"><span className="brandmark">✦</span>Easy Learn <span className="muted">/ 伴读</span></div>
    <h1>{error ? '当前页面无法开启伴读' : '正在切换伴读状态…'}</h1>
    <p className="muted">{error ? '浏览器暂不允许在此页面注入（包括原生 PDF）。可在 PDF 中选中文字后右键选择 Easy Learn；扫描版 PDF 请打开粘贴面板。' : '完成后此窗口会自动关闭；页面右下角浮窗可调整设置。'}</p>
    {error && <div className="actions"><button className="primary" disabled={busy} onClick={() => void start()}>重试</button><button onClick={() => void chrome.tabs.create({url: chrome.runtime.getURL('panel.html')})}>打开粘贴文本面板</button><button className="quiet" onClick={() => void chrome.runtime.openOptionsPage()}>设置</button></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
