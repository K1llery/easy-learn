import { translationLanguageInfo } from '../core/translation-languages';
import { TranslationLanguageSelect, useTranslationLanguage } from './translation-language';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type AIRequest,
  type Concept,
  type Explanation,
  type TextContext,
  type Mastered,
} from '../core/types';
import { rpc } from './rpc';
import { connectSurface } from '../core/connection';
import { Practice } from './practice';
import { ReviewDesk } from './review';
import { QuickQuiz } from './quick-quiz';
import './style.css';
type Payload = {
  context: TextContext;
  expandedContext: TextContext;
  concept?: Concept;
  mode: 'explain' | 'translate' | 'practice' | 'quiz';
  notice?: string;
};
type PdfSelection = {
  id: string;
  mode: 'explain' | 'translate';
  text: string;
  title: string;
  truncated: boolean;
};
const isSidePanelSurface = window.location.pathname.endsWith('/sidepanel.html');
const sourceTabParam = new URLSearchParams(window.location.search).get('sourceTab');
function Panel() {
  const { targetLanguage, setTargetLanguage, ready: languageReady } = useTranslationLanguage();
  const [view, setView] = useState<'reading' | 'review'>(
    new URLSearchParams(window.location.search).get('view') === 'review' ? 'review' : 'reading',
  );
  const [studyMode, setStudyMode] = useState<'explain' | 'translate' | 'practice' | 'quiz'>(
      'explain',
    ),
    [payloadVersion, setPayloadVersion] = useState(0);
  const [payload, setPayload] = useState<Payload | null>(null),
    [expanded, setExpanded] = useState(false),
    [paste, setPaste] = useState('');
  const [explanation, setExplanation] = useState<Explanation | null>(null),
    [translation, setTranslation] = useState('');
  const [translationRequest, setTranslationRequest] = useState<{
    context: TextContext;
    concept?: Concept;
  } | null>(null);
  const [translationVersion, setTranslationVersion] = useState(0);
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]),
    [followup, setFollowup] = useState(''),
    [mastered, setMastered] = useState<Mastered | null>(null);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const epoch = useRef(0),
    port = useRef<chrome.runtime.Port | null>(null),
    retry = useRef<(() => void) | null>(null);
  const loadedPdfSelection = useRef('');
  function reset(next: Payload | null) {
    epoch.current++;
    setStudyMode(next?.mode ?? 'explain');
    setPayloadVersion((v) => v + 1);
    setView('reading');
    setPayload(next);
    setExpanded(false);
    setExplanation(null);
    setTranslation('');
    setTranslationRequest(
      next?.mode === 'translate' ? { context: next.context, concept: next.concept } : null,
    );
    setHistory([]);
    setMastered(null);
    setError('');
    setBusy('');
    setFollowup('');
    retry.current = null;
  }
  useEffect(() => {
    const connection = connectSurface('panel');
    const p = connection.port;
    port.current = p;
    p.onMessage.addListener((msg) => {
      if (msg.type === 'CONTEXT') reset(msg.payload);
    });
    async function loadPdfSelection(tabId: number) {
      if (!Number.isInteger(tabId) || tabId < 0) return;
      try {
        const selection = await rpc<PdfSelection | null>('TAKE_PDF_SELECTION', { tabId });
        if (!selection || selection.id === loadedPdfSelection.current) return;
        loadedPdfSelection.current = selection.id;
        const context: TextContext = {
          title: selection.title,
          heading: '',
          text: selection.text,
          before: '',
          after: '',
        };
        reset({
          context,
          expandedContext: context,
          mode: selection.mode,
          ...(selection.truncated
            ? {
                notice:
                  '选区超过 16,000 字符，当前只使用前 16,000 字符。为了保留语境，建议选取一个段落。',
              }
            : {}),
        });
      } catch (e) {
        setError((e as Error).message);
      }
    }
    function onExtensionMessage(msg: { type?: unknown; tabId: number }) {
      if (
        !isSidePanelSurface ||
        msg?.type !== 'PDF_SELECTION_READY' ||
        !Number.isInteger(msg.tabId)
      )
        return;
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id === msg.tabId) void loadPdfSelection(msg.tabId);
      });
    }
    chrome.runtime.onMessage.addListener(onExtensionMessage);
    const sourceTab = Number(sourceTabParam);
    if (sourceTabParam !== null && Number.isInteger(sourceTab) && sourceTab >= 0)
      void loadPdfSelection(sourceTab);
    else if (isSidePanelSurface) {
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id !== undefined) void loadPdfSelection(tab.id);
      });
    }
    return () => {
      chrome.runtime.onMessage.removeListener(onExtensionMessage);
      connection.disconnect();
    };
  }, []);
  const run = useCallback(async function run<T>(
    label: string,
    request: AIRequest,
    accept: (data: T) => void,
  ) {
    const current = ++epoch.current;
    setBusy(label);
    setError('');
    retry.current = () => {
      void run(label, request, accept);
    };
    try {
      const data = await rpc<T>('AI', { request });
      if (epoch.current === current) {
        accept(data);
        retry.current = null;
      }
    } catch (e) {
      if (epoch.current === current) setError((e as Error).message);
    } finally {
      if (epoch.current === current) setBusy('');
    }
  }, []);
  function request(operation: AIRequest['operation'], extras: Partial<AIRequest> = {}): AIRequest {
    return {
      operation,
      context: expanded ? payload!.expandedContext : payload!.context,
      ...(payload?.concept ? { concept: payload.concept } : {}),
      ...extras,
      ...(extras.mode === 'translate' ? { targetLanguage } : {}),
    };
  }
  useEffect(() => {
    if (
      !payload ||
      payload.mode === 'translate' ||
      payload.mode === 'practice' ||
      payload.mode === 'quiz'
    )
      return;
    void run<Explanation>(
      '正在结合上下文解释…',
      {
        operation: 'explain',
        context: payload.context,
        concept: payload.concept,
        mode: payload.mode,
      },
      setExplanation,
    );
  }, [payload, run]);
  useEffect(() => {
    if (!translationRequest || !languageReady) return;
    setTranslation('');
    void run<Explanation>(
      '正在翻译所选文字…',
      {
        operation: 'explain',
        mode: 'translate',
        context: translationRequest.context,
        concept: translationRequest.concept,
        targetLanguage,
      },
      (data) => setTranslation(data.translation || data.explanation),
    );
  }, [translationRequest, translationVersion, targetLanguage, languageReady, run]);
  function pasteText(mode: 'explain' | 'translate' | 'practice' | 'quiz') {
    const context = {
      title: '粘贴文本',
      heading: '',
      text: paste.trim().slice(0, 16000),
      before: '',
      after: '',
    };
    if (context.text) reset({ context, expandedContext: context, mode });
  }
  function showReading() {
    setStudyMode('explain');
    if (payload && payload.mode !== 'explain' && !explanation && !busy) {
      void run<Explanation>(
        '正在结合上下文解释…',
        request('explain', { mode: 'explain' }),
        setExplanation,
      );
    }
  }
  async function toggleMastered() {
    try {
      if (mastered) {
        await rpc('UNMASTER', { key: mastered.key });
        setMastered(null);
      } else {
        const concept: Concept = payload?.concept ?? {
          anchor: payload!.context.text.slice(0, 160),
          category: '术语',
          meaning: explanation!.meaning.slice(0, 300),
          expansion: explanation!.expansion.slice(0, 300),
          evidence: explanation!.evidence.slice(0, 1500),
          ambiguity: explanation!.ambiguity.slice(0, 1500),
        };
        setMastered(await rpc<Mastered>('MASTER', { concept }));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brandmark">E</span>
          <div>Easy Learn</div>
        </div>
        <div>
          <button className="quiet" title="设置" onClick={() => void rpc('OPEN_OPTIONS')}>
            设置
          </button>
          <button
            className="quiet"
            aria-label={isSidePanelSurface ? '清空当前内容' : '关闭学习面板'}
            title={isSidePanelSurface ? '清空当前内容' : '关闭学习面板'}
            onClick={() => {
              if (isSidePanelSurface) {
                reset(null);
                return;
              }
              port.current?.postMessage({ type: 'CLOSE' });
              if (window.top === window) window.close();
            }}
          >
            ✕
          </button>
        </div>
      </header>
      <main className="panel-main">
        <nav className="learning-tabs" aria-label="学习导航">
          <button aria-pressed={view === 'reading'} onClick={() => setView('reading')}>
            阅读与练习
          </button>
          <button aria-pressed={view === 'review'} onClick={() => setView('review')}>
            我的复习
          </button>
        </nav>
        <div hidden={view !== 'reading'}>
          <TranslationLanguageSelect
            value={targetLanguage}
            disabled={!languageReady || !!busy}
            onChange={setTargetLanguage}
          />
          {!payload ? (
            <>
              <div className="intro">
                <h1>选段学习</h1>
                <p>
                  {isSidePanelSurface
                    ? '在网页或 PDF 中选中文字，右键选择 Easy Learn，即可解释或翻译。也可以粘贴一段文字。'
                    : '悬停原文下划线即可阅读准备好的注释。想继续追问或练习时，再打开这个面板；也可以选中或粘贴一段文字。'}
                </p>
              </div>
              <div className="card">
                <label htmlFor="paste">粘贴想理解的内容</label>
                <textarea
                  id="paste"
                  rows={7}
                  maxLength={16000}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="粘贴英文文档、术语或让你困惑的一段话…"
                />
                <div className="actions">
                  <button
                    className="primary"
                    disabled={!paste.trim()}
                    onClick={() => pasteText('explain')}
                  >
                    帮我理解
                  </button>
                  <button
                    disabled={!paste.trim() || !languageReady}
                    onClick={() => pasteText('translate')}
                  >
                    翻译 / Translate
                  </button>
                  <button disabled={!paste.trim()} onClick={() => pasteText('practice')}>
                    先练再看
                  </button>
                  <button disabled={!paste.trim()} onClick={() => pasteText('quiz')}>
                    出一道选择题
                  </button>
                </div>
                <p className="muted">最多 16,000 字符。内容仅发送给你配置的模型服务。</p>
              </div>
              <div className="notice">
                第一次使用？先在设置中连接模型。文章中的“阅读注释”也有设置入口。
              </div>
            </>
          ) : (
            <>
              <div className="row">
                <button className="quiet" onClick={() => reset(null)}>
                  新文本
                </button>
              </div>
              <h1 style={{ fontSize: 25, marginTop: 10 }}>
                {payload.concept?.anchor ??
                  (payload.mode === 'translate'
                    ? '翻译所选文字'
                    : payload.mode === 'quiz'
                      ? '根据选段练一道题'
                      : '理解这一段')}
              </h1>
              <nav className="study-mode-tabs" aria-label="学习方式">
                <button
                  aria-pressed={studyMode === 'explain' || studyMode === 'translate'}
                  onClick={showReading}
                >
                  解释
                </button>
                <button
                  aria-pressed={studyMode === 'practice'}
                  onClick={() => setStudyMode('practice')}
                >
                  练会这一段
                </button>
                <button
                  className="study-quiz-tab"
                  aria-pressed={studyMode === 'quiz'}
                  onClick={() => setStudyMode('quiz')}
                >
                  考考我！
                </button>
              </nav>
              <div hidden={studyMode !== 'practice'}>
                <Practice
                  key={payloadVersion}
                  context={payload.context}
                  concept={payload.concept}
                  onReview={() => setView('review')}
                />
              </div>
              <div hidden={studyMode !== 'quiz'}>
                <QuickQuiz
                  key={payloadVersion}
                  context={payload.context}
                  active={studyMode === 'quiz'}
                />
              </div>
              <div hidden={studyMode !== 'explain' && studyMode !== 'translate'}>
                <div className="source">{payload.context.text}</div>
                {payload.notice && <div className="notice">{payload.notice}</div>}
                {payload.context.heading && (
                  <p className="muted">章节 · {payload.context.heading}</p>
                )}
                {explanation && (
                  <section className="card" aria-label="概念解释">
                    <span className="tag">语境中的含义</span>
                    <h2 style={{ marginTop: 12 }}>{explanation.meaning}</h2>
                    {explanation.expansion && <p className="muted">{explanation.expansion}</p>}
                    <p style={{ marginTop: 12 }}>{explanation.explanation}</p>
                    {explanation.ambiguity && (
                      <div className="notice">仍有歧义：{explanation.ambiguity}</div>
                    )}
                    {explanation.evidence && (
                      <>
                        <h3>为什么这样理解</h3>
                        <p>{explanation.evidence}</p>
                      </>
                    )}
                    {explanation.example && (
                      <>
                        <h3>举个例子</h3>
                        <p>{explanation.example}</p>
                      </>
                    )}
                    {explanation.prerequisites.length > 0 && (
                      <>
                        <h3>补一点背景</h3>
                        {explanation.prerequisites.map((item, i) => (
                          <details key={i}>
                            <summary>{item.term}</summary>
                            <p>{item.explanation}</p>
                          </details>
                        ))}
                      </>
                    )}
                  </section>
                )}
                <div className="actions">
                  <button
                    disabled={!!busy || !languageReady}
                    onClick={() => {
                      setTranslationRequest({
                        context: expanded ? payload.expandedContext : payload.context,
                        concept: payload.concept,
                      });
                      setTranslationVersion((version) => version + 1);
                    }}
                  >
                    翻译这一段
                  </button>
                  <button disabled={!!busy || !explanation?.meaning} onClick={toggleMastered}>
                    {mastered ? '恢复显示' : '我懂了，不再显示'}
                  </button>
                </div>
                {mastered && (
                  <p className="muted" role="status">
                    已加入“不再显示”列表，可在设置中恢复。
                  </p>
                )}
                {!expanded && payload.expandedContext.section && (
                  <button
                    className="quiet"
                    disabled={!!busy}
                    onClick={() => {
                      setExpanded(true);
                      void run<Explanation>(
                        '正在结合当前章节重新解释…',
                        {
                          operation: 'explain',
                          context: payload.expandedContext,
                          concept: payload.concept,
                          mode: 'explain',
                        },
                        setExplanation,
                      );
                    }}
                  >
                    上下文不够？加入当前章节重新解释 ↗
                  </button>
                )}
                {expanded && <p className="muted">已包含当前章节（最多 24,000 字符）。</p>}
                {translation && (
                  <section className="card" aria-label="段落翻译">
                    <span className="tag">{translationLanguageInfo(targetLanguage).label}译文</span>
                    <p
                      lang={targetLanguage}
                      dir={translationLanguageInfo(targetLanguage).direction}
                      style={{ marginTop: 12 }}
                    >
                      {translation}
                    </p>
                  </section>
                )}
                <section className="section-line">
                  <h2>再问深一点</h2>
                  <div className="conversation">
                    {history.map((item, i) => (
                      <p key={i} className={item.role === 'user' ? 'user' : 'answer'}>
                        {item.content}
                      </p>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const q = followup.trim();
                      if (!q) return;
                      void run<Explanation>(
                        '正在回答你的追问…',
                        request('explain', {
                          mode: 'followup',
                          question: q,
                          history: [
                            ...(explanation
                              ? [{ role: 'assistant' as const, content: explanation.explanation }]
                              : []),
                            ...history.slice(-6),
                          ],
                        }),
                        (data) => {
                          setHistory((prev) => [
                            ...prev,
                            { role: 'user', content: q },
                            { role: 'assistant', content: data.explanation },
                          ]);
                          setFollowup('');
                        },
                      );
                    }}
                  >
                    <label htmlFor="followup" className="muted">
                      还有哪里没弄明白？
                    </label>
                    <textarea
                      id="followup"
                      maxLength={2000}
                      rows={2}
                      value={followup}
                      onChange={(e) => setFollowup(e.target.value)}
                      placeholder="例如：它和我熟悉的概念有什么区别？"
                    />
                    <button
                      style={{ marginTop: 10 }}
                      disabled={!!busy || !followup.trim()}
                      type="submit"
                    >
                      继续追问 ↗
                    </button>
                  </form>
                </section>
              </div>
            </>
          )}
          {busy && (
            <div role="status" className="busy">
              <span className="dot" />
              {busy}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              <p>{error}</p>
              <div className="actions">
                {retry.current && <button onClick={() => retry.current?.()}>重试</button>}
                <button onClick={() => void rpc('OPEN_OPTIONS')}>打开设置</button>
              </div>
            </div>
          )}
        </div>
        <div hidden={view !== 'review'}>
          <ReviewDesk active={view === 'review'} onRead={() => setView('reading')} />
        </div>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Panel />);
