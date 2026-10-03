import { defaultConcurrency, defaultBatchSize } from '../core/reading-defaults';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Concept, TextContext } from '../core/types';
import { ReaderStudy, type ReadingAction } from './reader-study';
import { connectSurface } from '../core/connection';
import { textDocument, type ReadingDocument } from '../reader/document';
import {
  exportVocabulary,
  recordWord,
  scanVocabulary,
  wordOccurrences,
  type ReadingWord,
  type WordRecord,
} from '../reader/vocabulary';
import { importReadingFile } from './reader-source';
import { analyzeReading, inExtension } from './reader-rpc';
import { ReaderSettings } from './reader-settings';
import { ReaderDirectory } from './reader-directory';
import { ReaderVocabulary } from './reader-vocabulary';
import { ReaderPdf, type PdfDestination } from './reader-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { rpc, type SettingsResponse, type PublicSettings } from './rpc';
import './style.css';
import './reader.css';
const WORD_STORE = 'easy-learn-reader-words-v1';
function storedWords(): Record<string, WordRecord> {
  try {
    const data = JSON.parse(localStorage.getItem(WORD_STORE) ?? '{}');
    return Object.fromEntries(
      Object.entries(data).filter(([key, v]) => {
        const r = v as WordRecord;
        return (
          key.length < 100 &&
          r &&
          typeof r.word === 'string' &&
          r.word.length <= 60 &&
          typeof r.language === 'string' &&
          ['known', 'learning'].includes(r.status) &&
          (!r.meaning || (typeof r.meaning === 'string' && r.meaning.length <= 300)) &&
          (!r.summary || (typeof r.summary === 'string' && r.summary.length <= 1200)) &&
          (!r.expansion || (typeof r.expansion === 'string' && r.expansion.length <= 300)) &&
          (!r.ambiguity || (typeof r.ambiguity === 'string' && r.ambiguity.length <= 1500))
        );
      }),
    ) as Record<string, WordRecord>;
  } catch {
    return {};
  }
}
const keyFor = (w: ReadingWord) => JSON.stringify([w.sectionId, w.key, w.context]);
function Reader() {
  const [doc, setDoc] = useState<ReadingDocument | null>(null),
    [sectionIndex, setSectionIndex] = useState(0),
    [fingerprint, setFingerprint] = useState('');
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [pdfPage, setPdfPage] = useState(1),
    [pdfView, setPdfView] = useState(true);
  const [pdfDestination, setPdfDestination] = useState<PdfDestination>({ page: 1 });
  const [language, setLanguage] = useState('en'),
    [baseline, setBaseline] = useState(5000),
    [fontSize, setFontSize] = useState(19);
  const [records, setRecords] = useState(storedWords),
    [wordsFile, setWordsFile] = useState<string[]>([]);
  const [settings, setSettings] = useState(false),
    [vocabOpen, setVocabOpen] = useState(false),
    [pasteOpen, setPasteOpen] = useState(false),
    [paste, setPaste] = useState('');
  const [loading, setLoading] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false),
    [wholeBook, setWholeBook] = useState(false);
  const [concepts, setConcepts] = useState<Record<string, Concept>>({}),
    [completed, setCompleted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(0),
    [batchSize, setBatchSize] = useState(defaultBatchSize),
    [concurrency, setConcurrency] = useState(defaultConcurrency),
    [density, setDensity] = useState(6);
  const [selected, setSelected] = useState<ReadingWord | null>(null);
  const [selection, setSelection] = useState<TextContext | null>(null),
    [study, setStudy] = useState<{ context: TextContext; mode: ReadingAction; id: number } | null>(
      null,
    );
  const [pdfDirty, setPdfDirty] = useState(false),
    [focused, setFocused] = useState(false);
  const focusButton = useRef<HTMLButtonElement>(null);
  const [desktop, setDesktop] = useState(false),
    [exited, setExited] = useState(false);
  const studyId = useRef(0);
  const importing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null),
    port = useRef<ReturnType<typeof connectSurface> | null>(null);
  const epoch = useRef(0),
    claimed = useRef(new Set<string>()),
    done = useRef(new Set<string>()),
    conceptRef = useRef<Record<string, Concept>>({});
  const currentIndex = useRef(0),
    active = useRef(false),
    inflight = useRef(0),
    work = useRef<ReadingWord[]>([]),
    scopeAll = useRef(false),
    book = useRef(doc);
  const prefs = useRef({ batchSize, concurrency });
  const indices = useRef(new Map<string, number>());
  indices.current = useMemo(() => new Map(doc?.sections.map((s, i) => [s.id, i]) ?? []), [doc]);
  currentIndex.current = sectionIndex;
  active.current = reading;
  scopeAll.current = wholeBook;
  book.current = doc;
  prefs.current = { batchSize, concurrency };
  async function refreshSettings() {
    try {
      const data = await rpc<PublicSettings>('PUBLIC_SETTINGS');
      setBatchSize(data.batchSize ?? defaultBatchSize);
      setConcurrency(data.concurrency ?? defaultConcurrency);
      setDensity(data.maxPerBlock ?? 6);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const invalidateRequests = () => {
      epoch.current++;
    };
    if (inExtension) {
      port.current = connectSurface('reader');
      port.current.port.onMessage.addListener((msg) => {
        if (msg.type === 'REFRESH') {
          setRecords(storedWords());
          setReading(false);
          active.current = false;
          resetAnalysis();
          void refreshSettings();
          setNotice('阅读设置已更新，点击开启伴读继续。');
        }
      });
    }
    void refreshSettings();
    void rpc<SettingsResponse>('GET_SETTINGS')
      .then((data) => {
        setDesktop(data.desktop === true);
        if (!data.config) setSettings(true);
      })
      .catch((e) => setError(e.message));
    void fetch(
      inExtension
        ? chrome.runtime.getURL('vocabulary/english-frequency.txt')
        : '/vocabulary/english-frequency.txt',
    )
      .then((r) => {
        if (!r.ok) throw new Error('词频表加载失败');
        return r.text();
      })
      .then((s) => setWordsFile(s.split(/\s+/).filter(Boolean)))
      .catch((e) => setError(e.message));
    return () => {
      invalidateRequests();
      active.current = false;
      port.current?.disconnect();
    };
  }, []);
  useEffect(
    () => () => {
      void pdf?.loadingTask.destroy().catch(() => undefined);
    },
    [pdf],
  );
  const common = useMemo(() => new Set(wordsFile.slice(0, baseline)), [wordsFile, baseline]);
  const frequency = useMemo(() => new Map(wordsFile.map((w, i) => [w, i + 1])), [wordsFile]);
  const known = useMemo(
    () =>
      new Set(
        Object.entries(records)
          .filter(([, r]) => r.status === 'known')
          .map(([key]) => key),
      ),
    [records],
  );
  const candidates = useMemo(
    () =>
      doc?.sections
        .flatMap((s) =>
          scanVocabulary(
            s,
            language,
            common,
            known,
            Math.min(100, density * Math.max(1, Math.ceil(s.text.length / 600))),
            frequency,
          ),
        )
        .map((w, i) => ({ ...w, id: `c${i}` })) ?? [],
    [doc, language, common, known, density, frequency],
  );
  work.current = candidates;
  function resetAnalysis() {
    epoch.current++;
    claimed.current.clear();
    done.current.clear();
    conceptRef.current = {};
    setConcepts({});
    setCompleted(new Set());
    setSelected(null);
    setError('');
  }
  async function loadDocument(next: ReadingDocument, source: PDFDocumentProxy | null = null) {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(next)),
    );
    const key = Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
    let index = 0;
    try {
      index = Number(localStorage.getItem('reader-position:' + key) ?? 0);
    } catch {
      /* reading still works */
    }
    const restored =
      Number.isInteger(index) && index >= 0 && index < next.sections.length ? index : 0;
    setReading(false);
    active.current = false;
    resetAnalysis();
    setSelection(null);
    setStudy(null);
    setPdfDirty(false);
    setFocused(false);
    setFingerprint(key);
    setSectionIndex(restored);
    setDoc(next);
    setPdf(source);
    setPdfPage(next.sections[restored].pageStart ?? 1);
    setPdfDestination({
      page: next.sections[restored].pageStart ?? 1,
      top: next.sections[restored].top,
    });
    setPdfView(true);
    setLanguage(
      ['en', 'fr', 'de', 'es', 'ja', 'ko'].includes(next.language.split('-')[0])
        ? next.language.split('-')[0]
        : 'en',
    );
    setNotice('文件已在本机读取。点击“开启伴读”后，候选词和短语境才会发送给模型。');
    setLoading('');
    setPasteOpen(false);
  }
  async function openFile(file: File) {
    if (importing.current) return;
    if (pdfDirty && !window.confirm('PDF 批注尚未导出。打开新文件会丢失本次批注，是否继续？'))
      return;
    importing.current = true;
    setLoading('正在读取文件');
    setError('');
    try {
      const imported = await importReadingFile(file, setLoading);
      await loadDocument(imported.document, imported.pdf ?? null);
    } catch (e) {
      setError((e as Error).message);
      setLoading('');
    } finally {
      importing.current = false;
    }
  }
  async function openPaste() {
    if (importing.current) return;
    if (pdfDirty && !window.confirm('PDF 批注尚未导出。替换文章会丢失本次批注，是否继续？')) return;
    importing.current = true;
    setLoading('正在准备阅读');
    setError('');
    try {
      await loadDocument(textDocument(paste, '粘贴的文章'));
    } catch (e) {
      setError((e as Error).message);
      setLoading('');
    } finally {
      importing.current = false;
    }
  }
  async function quitDesktop() {
    if (pdfDirty && !window.confirm('PDF 批注尚未导出，退出会丢失本次批注。是否继续？')) return;
    try {
      await rpc('QUIT_DESKTOP');
      active.current = false;
      setReading(false);
      setPdfDirty(false);
      setPdf(null);
      setDoc(null);
      setStudy(null);
      setExited(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(index: number) {
    setSelection(null);
    setSectionIndex(index);
    setPdfPage(doc?.sections[index].pageStart ?? 1);
    setPdfDestination({
      page: doc?.sections[index].pageStart ?? 1,
      top: doc?.sections[index].top,
      title: doc?.sections[index].title,
    });
    setSelected(null);
    try {
      if (fingerprint) localStorage.setItem('reader-position:' + fingerprint, String(index));
    } catch {
      /* nonessential position */
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const onPdfPageChange = useCallback(
    (page: number) => {
      setPdfPage(page);
      setSelected(null);
      setSectionIndex((current) => {
        const section = doc?.sections[current];
        if (section && (section.pageStart ?? 1) <= page && (section.pageEnd ?? 1) >= page)
          return current;
        const index =
          doc?.sections.findIndex((s) => (s.pageStart ?? 1) <= page && (s.pageEnd ?? 1) >= page) ??
          -1;
        return index >= 0 ? index : current;
      });
    },
    [doc],
  );
  function startAnalysis() {
    setError('');
    setNotice('');
    setReading(true);
    active.current = true;
    pump();
  }
  const pump = useCallback(function pump() {
    const generation = epoch.current;
    while (active.current && inflight.current < prefs.current.concurrency && book.current) {
      const eligible = work.current
        .filter((w) => {
          const i = indices.current.get(w.sectionId) ?? 0;
          return (
            (scopeAll.current || (i >= currentIndex.current && i < currentIndex.current + 3)) &&
            !claimed.current.has(keyFor(w)) &&
            !done.current.has(keyFor(w))
          );
        })
        .sort((a, b) => {
          const rank = (w: ReadingWord) => {
            const i = indices.current.get(w.sectionId) ?? 0;
            return i >= currentIndex.current ? i - currentIndex.current : 10000 + i;
          };
          return rank(a) - rank(b);
        });
      const batch = eligible.slice(0, prefs.current.batchSize);
      if (!batch.length) break;
      for (const w of batch) claimed.current.add(keyFor(w));
      inflight.current++;
      setBusy(inflight.current);
      const apply = (p: { concepts: Concept[]; skipped: string[] }) => {
        if (generation !== epoch.current) return;
        for (const c of p.concepts) {
          const w = batch.find((w) => w.id === c.id);
          if (w) {
            conceptRef.current[keyFor(w)] = c;
            done.current.add(keyFor(w));
          }
        }
        for (const id of p.skipped) {
          const w = batch.find((w) => w.id === id);
          if (w) done.current.add(keyFor(w));
        }
        setConcepts({ ...conceptRef.current });
        setCompleted(new Set(done.current));
      };
      const controller = new AbortController();
      const request = {
        operation: 'analyze' as const,
        context: {
          title: book.current.title,
          heading: '',
          text: '生词预读',
          before: '',
          after: '',
        },
        candidates: batch.map(({ id, anchor, kind, heading, context }) => ({
          id,
          anchor,
          kind,
          heading,
          context,
        })),
      };
      void analyzeReading(request, controller.signal, apply, port.current?.port)
        .then((result) => {
          apply(result);
          if (generation !== epoch.current) return;
          if (result.missing?.length || result.__warning) {
            active.current = false;
            setReading(false);
            setError(result.__warning ?? '部分释义尚未完成，已暂停。点击继续后手动重试。');
          }
        })
        .catch((e) => {
          if (generation === epoch.current) {
            active.current = false;
            setReading(false);
            setError(e.message);
          }
        })
        .finally(() => {
          if (generation === epoch.current)
            for (const w of batch) claimed.current.delete(keyFor(w));
          inflight.current--;
          setBusy(inflight.current);
          if (generation === epoch.current && active.current) pump();
          else if (active.current && inflight.current === 0) pump();
        });
    }
  }, []);
  useEffect(() => {
    if (reading && wordsFile.length) pump();
  }, [reading, sectionIndex, wholeBook, candidates, batchSize, concurrency, wordsFile, pump]);
  const section = doc?.sections[sectionIndex];
  function captureSelection(event: React.SyntheticEvent<HTMLElement>) {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) return;
    const range = selected.getRangeAt(0),
      root = event.currentTarget;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const element =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    if (element?.closest('.annotationEditorLayer')) return;
    const text = selected.toString().trim();
    if (!text) return;
    setSelection({
      title: doc!.title.slice(0, 500),
      heading: section!.title.slice(0, 500),
      text: text.slice(0, 16000),
      before: '',
      after: '',
    });
    if (text.length > 16000) setNotice('选段超过 16,000 字符，学习功能仅使用前 16,000 字符。');
  }
  useEffect(() => {
    if (!pdfDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pdfDirty]);
  useEffect(() => {
    if (!focused) return;
    const leave = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        loading ||
        settings ||
        vocabOpen ||
        pasteOpen ||
        study
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,[contenteditable],[role=dialog]')
      )
        return;
      setFocused(false);
      focusButton.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [focused, loading, settings, vocabOpen, pasteOpen, study]);
  const wordsForPdfPage = useCallback(
    (page: number) =>
      candidates.filter((w) => {
        const s = doc?.sections[indices.current.get(w.sectionId) ?? -1];
        return (
          !!s &&
          (s.pageStart ?? 1) <= page &&
          (s.pageEnd ?? 1) >= page &&
          (concepts[keyFor(w)] || !completed.has(keyFor(w)))
        );
      }),
    [candidates, concepts, completed, doc],
  );
  const conceptFor = useCallback(
    (w: ReadingWord) => conceptRef.current[JSON.stringify([w.sectionId, w.key, w.context])],
    [],
  );
  const sectionWords = useMemo(
    () => candidates.filter((w) => w.sectionId === section?.id),
    [candidates, section?.id],
  );
  const visibleWords = useMemo(
    () => sectionWords.filter((w) => concepts[keyFor(w)] || !completed.has(keyFor(w))),
    [sectionWords, concepts, completed],
  );
  const occurrences = useMemo(
    () => (section ? wordOccurrences(section.text, visibleWords, language) : []),
    [section, visibleWords, language],
  );
  function saveWord(w: ReadingWord, status: 'known' | 'learning') {
    const next = { ...records, [w.key]: recordWord(w, language, status, concepts[keyFor(w)]) };
    try {
      if (Object.keys(next).length > 5000)
        throw new Error('词汇记录达到 5000 条，请导出并清理后继续。');
      localStorage.setItem(WORD_STORE, JSON.stringify(next));
      setRecords(next);
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function removeWord(key: string) {
    try {
      const next = { ...records };
      delete next[key];
      localStorage.setItem(WORD_STORE, JSON.stringify(next));
      setRecords(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function exportWords() {
    const blob = new Blob(['\ufeff' + exportVocabulary(Object.values(records))], {
      type: 'text/tab-separated-values;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Easy-Learn-vocabulary.tsv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const displayedConcept = selected ? concepts[keyFor(selected)] : null;
  const learning = Object.values(records).filter((r) => r.status === 'learning');
  let cursor = 0;
  const rendered: React.ReactNode[] = [];
  for (const { word, start, end } of occurrences) {
    rendered.push(section!.text.slice(cursor, start));
    const concept = concepts[keyFor(word)];
    rendered.push(
      <button
        key={start}
        className={`reader-word ${concept ? 'is-ready' : 'is-pending'}`}
        title={
          concept
            ? [concept.expansion, concept.meaning, concept.summary].filter(Boolean).join(' · ')
            : '候选生词 · 释义尚未准备好'
        }
        onMouseEnter={() => setSelected(word)}
        onFocus={() => setSelected(word)}
        onClick={() => setSelected(word)}
        aria-label={
          concept ? `${word.anchor}：${concept.meaning}` : `${word.anchor}：待准备的候选生词`
        }
      >
        {section!.text.slice(start, end)}
      </button>,
    );
    cursor = end;
  }
  if (section) rendered.push(section.text.slice(cursor));
  if (exited)
    return (
      <div className="reader-shell">
        <header className="reader-bar">
          <span className="brand">Easy Learn</span>
        </header>
        <main className="reader-message card" role="status">
          阅读服务已退出，可以关闭此页面。再次双击 Easy Learn 即可继续使用。
        </main>
      </div>
    );
  return (
    <div className={`reader-shell${focused ? ' is-focused' : ''}`}>
      <header className="reader-bar">
        <a className="brand" href="reader.html">
          <span className="brandmark">E</span>Easy Learn
        </a>
        <nav aria-label="工作台" inert={!!loading}>
          <button className="quiet" onClick={() => fileInput.current?.click()}>
            打开文件
          </button>
          <button className="quiet" onClick={() => setPasteOpen(!pasteOpen)}>
            粘贴文本
          </button>
          <button className="quiet" onClick={() => setVocabOpen(!vocabOpen)}>
            生词本{learning.length > 0 ? ` · ${learning.length}` : ''}
          </button>
          <button className="quiet" onClick={() => setSettings(!settings)}>
            设置
          </button>
          {doc && (
            <button
              ref={focusButton}
              className="quiet reader-focus-toggle"
              aria-pressed={focused}
              onClick={() => setFocused(!focused)}
            >
              {focused ? '退出专注' : '专注阅读'}
            </button>
          )}
          {desktop && (
            <button className="quiet" onClick={() => void quitDesktop()}>
              退出软件
            </button>
          )}
        </nav>
      </header>
      <input
        ref={fileInput}
        id="reader-file"
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        aria-label="导入阅读文件"
        hidden
        disabled={!!loading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openFile(file);
          e.target.value = '';
        }}
      />
      {settings && (
        <ReaderSettings
          onClose={() => setSettings(false)}
          onSaved={() => {
            setReading(false);
            active.current = false;
            resetAnalysis();
            void refreshSettings();
          }}
        />
      )}
      {error && (
        <div className="reader-message error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="reader-message busy" role="status">
          <span className="dot" />
          {loading}
        </div>
      )}
      {pasteOpen && (
        <form
          className="reader-message card"
          inert={!!loading}
          onSubmit={(e) => {
            e.preventDefault();
            void openPaste();
          }}
        >
          <label htmlFor="reader-paste">粘贴要读的外语原文</label>
          <textarea
            id="reader-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            maxLength={3000000}
          />
          <div className="actions">
            <button className="primary" disabled={!paste.trim()}>
              开始阅读
            </button>
            <button type="button" onClick={() => setPasteOpen(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      {study && (
        <ReaderStudy
          key={study.id}
          context={study.context}
          mode={study.mode}
          onClose={() => setStudy(null)}
        />
      )}
      {vocabOpen && (
        <ReaderVocabulary
          records={records}
          onRemove={removeWord}
          onExport={exportWords}
          onClose={() => setVocabOpen(false)}
        />
      )}
      {!doc && !loading && (
        <main className="reader-welcome">
          <div className="reader-book-icon" aria-hidden="true">
            Aa
          </div>
          <h1>阅读工作台</h1>
          <p>打开外语原文，提前准备生词释义。</p>
          <div
            className="reader-import"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void openFile(f);
            }}
          >
            <button className="primary" onClick={() => fileInput.current?.click()}>
              选择文件
            </button>
            <span>或将文件拖到这里</span>
            <small>PDF · EPUB · TXT · Markdown</small>
          </div>
          <p className="reader-local">
            文件在本机提取。原文保持原样，释义按需提前准备。
            <br />
            阅读位置和生词记录保存在本机，重新导入同一文件可继续阅读。
          </p>
        </main>
      )}
      {doc && section && (
        <div className="reader-layout" inert={!!loading} aria-busy={!!loading}>
          <ReaderDirectory
            key={fingerprint}
            document={doc}
            current={sectionIndex}
            onNavigate={navigate}
          />
          <main className="reader-main">
            <div className="reader-location" aria-label="阅读位置">
              <div className="reader-location-label">
                <span>
                  第 {sectionIndex + 1} / {doc.sections.length}{' '}
                  {doc.structure === 'fragments' ? '片段' : '章节'}
                </span>
                {focused && <small>Esc 退出专注</small>}
                <div className="reader-location-actions">
                  <button
                    aria-label="前一章节"
                    disabled={sectionIndex === 0}
                    onClick={() => navigate(sectionIndex - 1)}
                  >
                    ←
                  </button>
                  <button
                    aria-label="后一章节"
                    disabled={sectionIndex === doc.sections.length - 1}
                    onClick={() => navigate(sectionIndex + 1)}
                  >
                    →
                  </button>
                </div>
              </div>
              <progress aria-label="章节位置" max={doc.sections.length} value={sectionIndex + 1} />
            </div>
            <div className="reader-toolbar">
              <label>
                原文语言
                <select
                  aria-label="原文语言"
                  value={language}
                  disabled={busy > 0}
                  onChange={(e) => {
                    setReading(false);
                    active.current = false;
                    resetAnalysis();
                    setLanguage(e.target.value);
                  }}
                >
                  {[
                    ['en', '英语'],
                    ['fr', '法语'],
                    ['de', '德语'],
                    ['es', '西班牙语'],
                    ['ja', '日语'],
                    ['ko', '韩语'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {language === 'en' && (
                <label>
                  常用词基础
                  <select
                    aria-label="常用词基础"
                    value={baseline}
                    disabled={busy > 0}
                    onChange={(e) => {
                      setReading(false);
                      active.current = false;
                      resetAnalysis();
                      setBaseline(Number(e.target.value));
                    }}
                  >
                    <option value={2000}>前 2000 词</option>
                    <option value={5000}>前 5000 词</option>
                    <option value={10000}>前 10000 词</option>
                  </select>
                </label>
              )}
              <label>
                字号
                <select
                  aria-label="阅读字号"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                >
                  <option value={17}>小</option>
                  <option value={19}>中</option>
                  <option value={22}>大</option>
                </select>
              </label>
              <button
                className={reading ? '' : 'primary'}
                disabled={!wordsFile.length}
                onClick={() => {
                  if (reading) {
                    active.current = false;
                    setReading(false);
                  } else startAnalysis();
                }}
              >
                {reading ? '暂停伴读' : completed.size ? '继续伴读' : '开启伴读'}
              </button>
            </div>
            <div className="reader-progress" role="status">
              <span>
                {busy ? `正在准备 · ${busy} 路请求` : reading ? '伴读已开启' : '伴读已暂停'} · 本节{' '}
                {sectionWords.filter((w) => completed.has(keyFor(w))).length} /{' '}
                {sectionWords.length} 个候选已处理
              </span>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={wholeBook}
                  onChange={(e) => setWholeBook(e.target.checked)}
                />
                <span>提前准备整份文档</span>
              </label>
            </div>
            {notice && <p className="reader-hint reader-notice">{notice}</p>}
            {language !== 'en' && (
              <p className="reader-hint">
                当前语言使用浏览器分词筛选候选，尚无对应词频等级表；候选不代表你一定不认识，可标记“已认识”。
              </p>
            )}
            {pdf && (
              <>
                <div className="reader-view-switch" role="group" aria-label="PDF 阅读视图">
                  <button
                    aria-pressed={pdfView}
                    onClick={() => {
                      if (!pdfView) {
                        setPdfDestination({ page: pdfPage });
                        setPdfView(true);
                      }
                    }}
                  >
                    原版（含图表）
                  </button>
                  <button aria-pressed={!pdfView} onClick={() => setPdfView(false)}>
                    文字伴读
                  </button>
                </div>
                <p
                  className={
                    doc.sections.some((s) => s.text.trim())
                      ? 'reader-hint'
                      : 'reader-hint reader-notice'
                  }
                >
                  {doc.structure === 'outline'
                    ? '目录来自 PDF 书签。'
                    : doc.structure === 'headings'
                      ? '目录依据结构标签与标题样式识别。'
                      : '未检测到可靠标题；以下为阅读片段，不是论文的章节。'}{' '}
                  原版保留图片、图表和公式，图片不发送给模型。
                  {!doc.sections.some((s) => s.text.trim())
                    ? '此文件没有文字层，仍可查看原版；生词伴读需要先 OCR。'
                    : ''}
                </p>
              </>
            )}
            <div className="reader-selection-actions" role="group" aria-label="选段操作">
              <span>
                {selection
                  ? `已选择 ${selection.text.length} 字符`
                  : '选中文字后，可解释、翻译或考考自己'}
              </span>
              {(['explain', 'translate', 'quiz'] as const).map((mode) => (
                <button
                  key={mode}
                  disabled={!selection}
                  onClick={() => {
                    if (selection) setStudy({ context: selection, mode, id: ++studyId.current });
                  }}
                >
                  {mode === 'explain' ? '解释' : mode === 'translate' ? '翻译' : '考考我'}
                </button>
              ))}
            </div>
            {pdf && (
              <div hidden={!pdfView} onPointerUp={captureSelection} onKeyUp={captureSelection}>
                <h1 className="pdf-section-heading">{section.title}</h1>
                <ReaderPdf
                  pdf={pdf}
                  page={pdfPage}
                  destination={pdfDestination}
                  wordsForPage={wordsForPdfPage}
                  language={language}
                  conceptFor={conceptFor}
                  onWord={setSelected}
                  onPageChange={onPdfPageChange}
                  filename={doc.title}
                  onDirtyChange={setPdfDirty}
                  interactionLocked={!!loading}
                />
              </div>
            )}
            {!(pdf && pdfView) && (
              <article
                onPointerUp={captureSelection}
                onKeyUp={captureSelection}
                className="reader-article"
                lang={language}
                style={{ fontSize }}
              >
                <h1>{section.title}</h1>
                <div className="reader-prose" data-testid="reader-prose">
                  {rendered}
                </div>
              </article>
            )}
            {!(pdf && pdfView) && (
              <div className="reader-pagination">
                <button disabled={sectionIndex === 0} onClick={() => navigate(sectionIndex - 1)}>
                  上一节
                </button>
                <span>
                  {sectionIndex + 1} / {doc.sections.length}
                </span>
                <button
                  disabled={sectionIndex === doc.sections.length - 1}
                  onClick={() => navigate(sectionIndex + 1)}
                >
                  下一节
                </button>
              </div>
            )}
            <p className="reader-hint">
              默认预读本节与接下来两节。下划线表示候选，释义准备好后显示浅色标记。悬停和点击都不请求模型。暂停后在途请求可能继续完成。
            </p>
          </main>
          <aside
            className={`reader-inspector${selected ? ' has-selection' : ''}`}
            aria-label="词语释义"
          >
            {selected ? (
              <>
                <div className="row">
                  <small>{displayedConcept ? '语境释义' : '候选生词'}</small>
                  <button className="quiet" onClick={() => setSelected(null)} aria-label="关闭释义">
                    ×
                  </button>
                </div>
                <h2 lang={language}>{selected.anchor}</h2>
                {displayedConcept ? (
                  <>
                    <h3>{displayedConcept.meaning}</h3>
                    {displayedConcept.expansion && (
                      <p className="reader-expansion" lang="en" aria-label="英文全称">
                        {displayedConcept.expansion}
                      </p>
                    )}
                    <p>{displayedConcept.summary}</p>
                    {displayedConcept.ambiguity && (
                      <p className="muted">{displayedConcept.ambiguity}</p>
                    )}
                  </>
                ) : (
                  <p className="muted">释义尚未准备好。开启伴读后会提前分析，悬停不会发起请求。</p>
                )}
                <div className="actions">
                  <button
                    disabled={!displayedConcept}
                    onClick={() => saveWord(selected, 'learning')}
                  >
                    加入生词本
                  </button>
                  <button className="quiet" onClick={() => saveWord(selected, 'known')}>
                    已认识
                  </button>
                </div>
              </>
            ) : (
              <>
                <small>词语释义</small>
                <h2>边读边理解</h2>
                <p className="muted">
                  将鼠标移到标注的单词，或用键盘聚焦，即可查看预先准备的解释。
                </p>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Reader />);
