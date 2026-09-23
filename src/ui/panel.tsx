import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AIRequest, type Concept, type Explanation, type TextContext, type Mastered } from '../core/types';
import { rpc } from './rpc';
import { connectSurface } from '../core/connection';
import { Practice } from './practice';
import { ReviewDesk } from './review';
import './style.css';
type Payload = { context: TextContext; expandedContext: TextContext; concept?: Concept; mode: 'explain' | 'translate' | 'practice'; notice?: string };
type PdfSelection = { id: string; mode: 'explain' | 'translate'; text: string; title: string; truncated: boolean };
const isSidePanelSurface = window.location.pathname.endsWith('/sidepanel.html');
const sourceTabParam = new URLSearchParams(window.location.search).get('sourceTab');
function Panel() {
  const [view, setView] = useState<'reading' | 'review'>(new URLSearchParams(window.location.search).get('view') === 'review' ? 'review' : 'reading');
  const [practiceActive, setPracticeActive] = useState(false), [payloadVersion, setPayloadVersion] = useState(0);
  const [payload, setPayload] = useState<Payload | null>(null), [expanded, setExpanded] = useState(false), [paste, setPaste] = useState('');
  const [explanation, setExplanation] = useState<Explanation | null>(null), [translation, setTranslation] = useState('');
  const [history, setHistory] = useState<{role:'user'|'assistant';content:string}[]>([]), [followup, setFollowup] = useState(''), [mastered, setMastered] = useState<Mastered | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const epoch = useRef(0), port = useRef<chrome.runtime.Port | null>(null), retry = useRef<(() => void) | null>(null);
  const loadedPdfSelection = useRef('');
  function reset(next: Payload | null) { epoch.current++; setPracticeActive(next?.mode === 'practice'); setPayloadVersion(v => v + 1); setView('reading'); setPayload(next); setExpanded(false); setExplanation(null); setTranslation(''); setHistory([]); setMastered(null); setError(''); setBusy(''); setFollowup(''); retry.current = null; }
  useEffect(() => {
    const connection = connectSurface('panel'); const p = connection.port; port.current = p;
    p.onMessage.addListener(msg => { if (msg.type === 'CONTEXT') reset(msg.payload); });
    async function loadPdfSelection(tabId: number) {
      if (!Number.isInteger(tabId) || tabId < 0) return;
      try {
        const selection = await rpc<PdfSelection | null>('TAKE_PDF_SELECTION', { tabId });
        if (!selection || selection.id === loadedPdfSelection.current) return;
        loadedPdfSelection.current = selection.id;
        const context: TextContext = { title: selection.title, heading: '', text: selection.text, before: '', after: '' };
        reset({ context, expandedContext: context, mode: selection.mode, ...(selection.truncated ? { notice: '选区超过 16,000 字符，当前只使用前 16,000 字符。为了保留语境，建议选取一个段落。' } : {}) });
      } catch (e) { setError((e as Error).message); }
    }
    function onExtensionMessage(msg: any) {
      if (!isSidePanelSurface || msg?.type !== 'PDF_SELECTION_READY' || !Number.isInteger(msg.tabId)) return;
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id === msg.tabId) void loadPdfSelection(msg.tabId);
      });
    }
    chrome.runtime.onMessage.addListener(onExtensionMessage);
    const sourceTab = Number(sourceTabParam);
    if (sourceTabParam !== null && Number.isInteger(sourceTab) && sourceTab >= 0) void loadPdfSelection(sourceTab);
    else if (isSidePanelSurface) {
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id !== undefined) void loadPdfSelection(tab.id);
      });
    }
    return () => { chrome.runtime.onMessage.removeListener(onExtensionMessage); connection.disconnect(); };
  }, []);
  async function run<T>(label: string, request: AIRequest, accept: (data:T) => void) {
    const current = ++epoch.current; setBusy(label); setError('');
    retry.current = () => { void run(label, request, accept); };
    try { const data = await rpc<T>('AI', {request}); if (epoch.current === current) { accept(data); retry.current = null; } }
    catch (e) { if (epoch.current === current) setError((e as Error).message); }
    finally { if (epoch.current === current) setBusy(''); }
  }
  function request(operation: AIRequest['operation'], extras: Partial<AIRequest> = {}): AIRequest { return {operation, context: expanded ? payload!.expandedContext : payload!.context, ...(payload?.concept ? {concept:payload.concept} : {}), ...extras}; }
  useEffect(() => {
    if (!payload || payload.mode === 'practice') return;
    const translating = payload.mode === 'translate';
    const label = translating ? '正在翻译所选文字…' : '正在结合上下文解释…';
    void run<Explanation>(label, {operation:'explain',context:payload.context,concept:payload.concept,mode:payload.mode}, data => {
      if (translating) { setTranslation(data.translation || data.explanation); setExplanation(null); }
      else { setExplanation(data); if (data.translation) setTranslation(data.translation); }
    });
  }, [payload]);
  function pasteText(mode: 'explain'|'translate'|'practice') { const context = {title:'粘贴文本',heading:'',text:paste.trim().slice(0,16000),before:'',after:''}; if(context.text) reset({context,expandedContext:context,mode}); }
  function showReading() {
    setPracticeActive(false);
    if (payload?.mode === 'practice' && !explanation && !busy) {
      void run<Explanation>('正在结合上下文解释…', request('explain', { mode: 'explain' }), setExplanation);
    }
  }
  async function toggleMastered() {
    try {
      if (mastered) { await rpc('UNMASTER', {key:mastered.key}); setMastered(null); }
      else {
        const concept: Concept = payload?.concept ?? {anchor:payload!.context.text.slice(0,160),category:'术语',meaning:explanation!.meaning.slice(0,300),expansion:explanation!.expansion.slice(0,300),evidence:explanation!.evidence.slice(0,1500),ambiguity:explanation!.ambiguity.slice(0,1500)};
        setMastered(await rpc('MASTER',{concept}));
      }
    } catch(e) {setError((e as Error).message);}
  }
  return <><header className="topbar"><div className="brand"><span className="brandmark">✦</span><div>Easy Learn<div className="muted">读懂，再学会</div></div></div><div><button className="quiet" title="设置" onClick={() => void rpc('OPEN_OPTIONS')}>设置</button><button className="quiet" aria-label={isSidePanelSurface ? '清空当前内容' : '关闭学习面板'} title={isSidePanelSurface ? '清空当前内容' : '关闭学习面板'} onClick={() => { if (isSidePanelSurface) { reset(null); return; } port.current?.postMessage({type:'CLOSE'}); if(window.top === window) window.close(); }}>✕</button></div></header>
    <main className="panel-main"><nav className="learning-tabs" aria-label="学习导航"><button aria-pressed={view === 'reading'} onClick={() => setView('reading')}>阅读与练习</button><button aria-pressed={view === 'review'} onClick={() => setView('review')}>我的复习</button></nav><div hidden={view !== 'reading'}>{!payload ? <><div className="intro"><div className="eyebrow">A LITTLE CLARITY, EVERY DAY</div><h1>从不懂的地方，<br/>再往前一步。</h1><p>{isSidePanelSurface ? '在网页或 PDF 中选中文字，右键选择 Easy Learn，即可解释或翻译。也可以粘贴一段文字。' : '悬停原文下划线即可阅读准备好的注释。想继续追问或练习时，再打开这个面板；也可以选中或粘贴一段文字。'}</p></div><div className="card"><span className="tag">也可以从一段文字开始</span><label htmlFor="paste">粘贴想理解的内容</label><textarea id="paste" rows={7} maxLength={16000} value={paste} onChange={e => setPaste(e.target.value)} placeholder="粘贴英文文档、术语或让你困惑的一段话…"/><div className="actions"><button className="primary" disabled={!paste.trim()} onClick={() => pasteText('explain')}>帮我理解</button><button disabled={!paste.trim()} onClick={() => pasteText('translate')}>翻译成中文</button><button disabled={!paste.trim()} onClick={() => pasteText('practice')}>直接练习</button></div><p className="muted">最多 16,000 字符。内容仅发送给你配置的模型服务。</p></div><div className="notice">第一次使用？先在设置中连接模型。文章中的“阅读注释”也有设置入口。</div></> : <>
      <div className="row"><span className="eyebrow">READ & UNDERSTAND</span><button className="quiet" onClick={() => reset(null)}>新文本</button></div><h1 style={{fontSize:25,marginTop:10}}>{payload.concept?.anchor ?? (payload.mode === 'translate' ? '翻译所选文字' : '理解这一段')}</h1><div className="learning-tabs" aria-label="选段学习方式"><button aria-pressed={!practiceActive} onClick={showReading}>阅读解释</button><button aria-pressed={practiceActive} onClick={() => setPracticeActive(true)}>练会这一段</button></div><div hidden={!practiceActive}><Practice key={payloadVersion} context={payload.context} concept={payload.concept} onReview={() => setView('review')}/></div><div hidden={practiceActive}><div className="source">{payload.context.text}</div>{payload.notice && <div className="notice">{payload.notice}</div>}
      {payload.context.heading && <p className="muted">章节 · {payload.context.heading}</p>}
      {explanation && <section className="card" aria-label="概念解释"><span className="tag">语境中的含义</span><h2 style={{marginTop:12}}>{explanation.meaning}</h2>{explanation.expansion && <p className="muted">{explanation.expansion}</p>}<p style={{marginTop:12}}>{explanation.explanation}</p>{explanation.ambiguity && <div className="notice">仍有歧义：{explanation.ambiguity}</div>}{explanation.evidence && <><h3>为什么这样理解</h3><p>{explanation.evidence}</p></>}{explanation.example && <><h3>举个例子</h3><p>{explanation.example}</p></>}{explanation.prerequisites.length > 0 && <><h3>补一点背景</h3>{explanation.prerequisites.map((item,i) => <details key={i}><summary>{item.term}</summary><p>{item.explanation}</p></details>)}</>}</section>}
      <div className="actions"><button disabled={!!busy} onClick={() => void run<Explanation>('正在翻译原文…',request('explain',{mode:'translate'}),data => setTranslation(data.translation || data.explanation))}>翻译这一段</button><button disabled={!!busy || !explanation?.meaning} onClick={toggleMastered}>{mastered ? '恢复显示' : '我懂了，不再显示'}</button></div>
      {mastered && <p className="muted" role="status">已加入“不再显示”列表，可在设置中恢复。</p>}
      {!expanded && payload.expandedContext.section && <button className="quiet" disabled={!!busy} onClick={() => {setExpanded(true);void run<Explanation>('正在结合当前章节重新解释…',{operation:'explain',context:payload.expandedContext,concept:payload.concept,mode:'explain'},setExplanation);}}>上下文不够？加入当前章节重新解释 ↗</button>}
      {expanded && <p className="muted">已包含当前章节（最多 24,000 字符）。</p>}
      {translation && <section className="card" aria-label="段落翻译"><span className="tag">中文翻译</span><p style={{marginTop:12}}>{translation}</p></section>}
      <section className="section-line"><h2>再问深一点</h2><div className="conversation">{history.map((item,i) => <p key={i} className={item.role === 'user' ? 'user' : 'answer'}>{item.content}</p>)}</div><form onSubmit={e => {e.preventDefault(); const q = followup.trim(); if (!q) return; void run<Explanation>('正在回答你的追问…',request('explain',{mode:'followup',question:q,history:[...(explanation ? [{role:'assistant' as const,content:explanation.explanation}] : []),...history.slice(-6)]}),data => {setHistory(prev => [...prev,{role:'user',content:q},{role:'assistant',content:data.explanation}]);setFollowup('');});}}><label htmlFor="followup" className="muted">还有哪里没弄明白？</label><textarea id="followup" maxLength={2000} rows={2} value={followup} onChange={e => setFollowup(e.target.value)} placeholder="例如：它和我熟悉的概念有什么区别？"/><button style={{marginTop:10}} disabled={!!busy || !followup.trim()} type="submit">继续追问 ↗</button></form></section>
    </div></>}{busy && <div role="status" className="busy"><span className="dot"/>{busy}</div>}{error && <div className="error" role="alert"><p>{error}</p><div className="actions">{retry.current && <button onClick={() => retry.current?.()}>重试</button>}<button onClick={() => void rpc('OPEN_OPTIONS')}>打开设置</button></div></div>}</div><div hidden={view !== 'review'}><ReviewDesk active={view === 'review'} onRead={() => setView('reading')}/></div><div className="footer">保留好奇，也保留判断 · AI 的解释可能有误</div></main></>;
}
createRoot(document.getElementById('root')!).render(<Panel/>);
