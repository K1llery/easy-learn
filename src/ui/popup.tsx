import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { annotationTypeValues, defaultAnnotationTypes, normalizeAnnotationTypes, type AnnotationType } from '../core/types';
import { rpc } from './rpc';
import './style.css';

const labels: Record<AnnotationType, string> = {
  abbreviation: '英文缩写',
  term: '专有名词与技术术语',
  command: 'CLI 命令',
  vocabulary: '扩展词汇（常用词表外，试验）',
};

function Popup() {
  const [types, setTypes] = useState<AnnotationType[]>(defaultAnnotationTypes);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void rpc<{annotationTypes?: unknown}>('PUBLIC_SETTINGS')
      .then(data => { setTypes(normalizeAnnotationTypes(data.annotationTypes)); setReady(true); })
      .catch(e => { setError((e as Error).message); setReady(true); });
  }, []);

  async function toggle(type: AnnotationType, enabled: boolean) {
    const next = enabled ? [...new Set([...types, type])] : types.filter(item => item !== type);
    setTypes(next); setError('');
    try { await rpc('SET_ANNOTATION_TYPES', {types: next}); }
    catch (e) { setTypes(types); setError((e as Error).message); }
  }

  async function start() {
    setBusy(true); setError('');
    try {
      const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
      if (tab?.id === undefined) throw new Error('没有找到当前页面。');
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
      window.close();
    } catch {
      setError('这个页面暂不支持伴读。请切换到普通网页后再试。'); setBusy(false);
    }
  }

  return <main className="popup-page">
    <div className="brand"><span className="brandmark">✦</span>Easy Learn <span className="muted">/ 伴读</span></div>
    <h1>这次想看哪些注释？</h1>
    <p className="muted">选择会保存，下次打开仍然适用。</p>
    <div className="annotation-options" aria-label="注释类型">
      {annotationTypeValues.map(type => <label className="check-row" key={type}>
        <input type="checkbox" checked={types.includes(type)} disabled={!ready || busy} onChange={e => void toggle(type, e.target.checked)}/>
        <span>{labels[type]}</span>
      </label>)}
    </div>
    <div className="notice">扩展词汇是可选试验：它依据常用词频表筛选，不等同于官方四级词表。开启后可能增加模型用量。</div>
    {error && <div role="alert" className="error">{error}</div>}
    <div className="actions"><button className="primary" disabled={!ready || busy} onClick={() => void start()}>{busy ? '正在开启…' : '开启 / 关闭当前页面'}</button></div>
    <button className="quiet" onClick={() => void rpc('OPEN_OPTIONS')}>模型连接与更多设置 ↗</button>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
