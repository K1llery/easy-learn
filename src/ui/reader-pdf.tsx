import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFViewer } from 'pdfjs-dist/types/web/pdf_viewer';
import type { EventBus } from 'pdfjs-dist/types/web/event_utils';
import type { PDFPageView } from 'pdfjs-dist/types/web/pdf_page_view';
import { wordKey, wordOccurrences, type ReadingWord } from '../reader/vocabulary';
import type { Concept } from '../core/types';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import './reader-pdf.css';

export type PdfDestination = { page: number; top?: number; title?: string };
type Props = {
  pdf: PDFDocumentProxy;
  page: number;
  destination: PdfDestination;
  wordsForPage: (page: number) => ReadingWord[];
  language: string;
  conceptFor: (w: ReadingWord) => Concept | undefined;
  onWord: (w: ReadingWord) => void;
  onPageChange: (page: number) => void;
  filename: string;
  onDirtyChange: (dirty: boolean) => void;
  interactionLocked: boolean;
};
type Tool = 'hand' | 'select' | 'highlight' | 'note' | 'ink';
type Zoom = 'page-actual' | 'page-fit' | 'page-width' | 'custom';

export function ReaderPdf(props: Props) {
  const { pdf, page, destination, wordsForPage, language, conceptFor } = props;
  const container = useRef<HTMLDivElement>(null),
    pages = useRef<HTMLDivElement>(null),
    viewer = useRef<PDFViewer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [initialized, setInitialized] = useState(false),
    [error, setError] = useState('');
  const [continuous, setContinuous] = useState(true),
    [zoom, setZoom] = useState<Zoom>('page-width'),
    [percent, setPercent] = useState(100);
  const [pageInput, setPageInput] = useState(String(page)),
    [pageError, setPageError] = useState('');
  const preferences = useRef({ continuous, zoom });
  preferences.current = { continuous, zoom };
  const navigationEpoch = useRef(0),
    pendingHeading = useRef<(PdfDestination & { ticket: number }) | null>(null);
  const eventBus = useRef<EventBus | null>(null),
    editorMode = useRef(0),
    lifecycleSignal = useRef<AbortSignal | null>(null);
  const editorModes = useRef<Record<Tool, number> | null>(null);
  const [tool, setTool] = useState<Tool>('hand'),
    [switching, setSwitching] = useState(false),
    [saving, setSaving] = useState(false),
    [saveNotice, setSaveNotice] = useState('');
  const [undo, setUndo] = useState(false),
    [redo, setRedo] = useState(false);
  const animations = useRef<Animation[]>([]);
  const savedHash = useRef(''),
    checkChanges = useRef(() => {});
  function revealHeading(view: PDFPageView) {
    const target = pendingHeading.current,
      layer = view.textLayer?.div;
    if (
      !target ||
      target.page !== view.id ||
      target.ticket !== navigationEpoch.current ||
      !layer ||
      layer.hidden
    )
      return;
    const spans = Array.from(
      layer.querySelectorAll<HTMLElement>('span[role="presentation"]:not(.markedContent)'),
    );
    const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const texts = spans.map((span) => normalize(span.textContent ?? '')),
      needle = normalize(target.title ?? '').replace(/^\d+(?:[.．]\d+)*[.．]?/, '');
    if (!needle) return;
    const joined = texts.join('');
    let start = joined.indexOf(needle);
    if (start < 0) return;
    // Bookmarks may repeat running headers: prefer the occurrence nearest their destination.
    const positions: number[] = [];
    let offset = 0;
    for (const text of texts) {
      positions.push(offset);
      offset += text.length;
    }
    if (target.top !== undefined) {
      let next = start,
        best = Infinity;
      while (next >= 0) {
        const span =
          spans[positions.findIndex((pos, i) => pos <= next && pos + texts[i].length > next)];
        if (span) {
          const y =
            (span.getBoundingClientRect().top - view.div.getBoundingClientRect().top) /
            view.viewport.scale;
          const distance = Math.abs(y - target.top);
          if (distance < best) {
            start = next;
            best = distance;
          }
        }
        next = joined.indexOf(needle, next + needle.length);
      }
    }
    const hits = spans.filter(
      (_, i) => positions[i] < start + needle.length && positions[i] + texts[i].length > start,
    );
    if (!hits.length) return;
    pendingHeading.current = null;
    const box = hits[0].getBoundingClientRect(),
      frame = container.current!,
      frameBox = frame.getBoundingClientRect();
    frame.scrollTop += box.top - frameBox.top - frame.clientHeight / 3;
    if (box.left < frameBox.left || box.right > frameBox.right)
      frame.scrollLeft += box.left - frameBox.left - 24;
    for (const animation of animations.current) animation.cancel();
    animations.current = hits.map((span) =>
      span.animate(
        [{ backgroundColor: 'rgba(255,204,0,.65)' }, { backgroundColor: 'rgba(255,204,0,0)' }],
        { duration: 650, iterations: 2 },
      ),
    );
    for (const span of hits) span.dataset.navigationTarget = target.title;
  }
  function changeTool(next: Tool) {
    const current = viewer.current;
    if (!current || !editorModes.current || switching || saving) return;
    setTool(next);
    const mode = editorModes.current[next];
    if (mode === editorMode.current) return;
    setSwitching(true);
    current.annotationEditorMode = { mode };
    current.update();
  }
  async function exportPdf() {
    if (saving || switching) return;
    setSaving(true);
    setSaveNotice('');
    setError('');
    const current = viewer.current,
      document = pdf;
    try {
      // Leaving edit mode commits the active FreeText/Ink editor before serializing.
      if (current && editorMode.current !== 0) {
        await new Promise<void>((resolve, reject) => {
          const bus = eventBus.current!,
            signal = lifecycleSignal.current!;
          const cleanup = () => {
            bus.off('annotationeditormodechanged', done);
            signal.removeEventListener('abort', cancel);
          };
          const done = () => {
              cleanup();
              resolve();
            },
            cancel = () => {
              cleanup();
              reject(new Error('文档已关闭'));
            };
          signal.addEventListener('abort', cancel, { once: true });
          bus.on('annotationeditormodechanged', done);
          current.annotationEditorMode = { mode: 0 };
          current.update();
        });
        if (viewer.current !== current) return;
        setTool('select');
      }
      const hash = document.annotationStorage.serializable.hash;
      const bytes = document.annotationStorage.size
        ? await document.saveDocument()
        : await document.getData();
      if (viewer.current !== current) return;
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      );
      const a = window.document.createElement('a');
      a.href = url;
      a.download = latest.current.filename.replace(/\.pdf$/i, '') + '-批注.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      savedHash.current = hash;
      latest.current.onDirtyChange(false);
      setSaveNotice('已导出含批注的 PDF。原文件保持不变。');
    } catch {
      if (viewer.current === current) {
        setError('批注导出失败，请重试；本次批注仍保留在阅读器中。');
        latest.current.onDirtyChange(true);
      }
    } finally {
      if (viewer.current === current) setSaving(false);
    }
  }
  const originalText = useRef(new WeakMap<HTMLElement, string>());
  const decorated = useRef(new WeakMap<HTMLElement, string>());

  function decorate(view: PDFPageView) {
    const layer = view.textLayer?.div;
    if (!layer || layer.hidden) return;
    // Candidate removal can rebuild a run. Preserve selection using source-text offsets.
    const selection = window.getSelection();
    const boundary = (node: Node | null, offset: number) => {
      if (!node) return null;
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const span = element?.closest<HTMLElement>('span[role="presentation"]:not(.markedContent)');
      if (!span || !layer.contains(span)) return { node, offset, span: null };
      const range = document.createRange();
      range.selectNodeContents(span);
      range.setEnd(node, offset);
      return { node, offset: range.toString().length, span };
    };
    const anchor =
      selection && !selection.isCollapsed
        ? boundary(selection.anchorNode, selection.anchorOffset)
        : null;
    const focus =
      selection && !selection.isCollapsed
        ? boundary(selection.focusNode, selection.focusOffset)
        : null;
    const rebuilt = new Set<HTMLElement>();
    const words = latest.current.wordsForPage(view.id ?? 0),
      language = latest.current.language;
    const spans = Array.from(
      layer.querySelectorAll<HTMLElement>('span[role="presentation"]:not(.markedContent)'),
    ).map((element) => {
      let text = originalText.current.get(element);
      if (text === undefined) {
        text = element.textContent ?? '';
        originalText.current.set(element, text);
      }
      return { element, text };
    });
    const matches = new Map(
      spans.map(({ element, text }) => [element, wordOccurrences(text, words, language)]),
    );
    // Preserve both source fragments when a candidate crosses a PDF line break.
    if (language.startsWith('en'))
      for (let i = 0; i < spans.length - 1; i++) {
        const left = spans[i],
          right = spans[i + 1],
          a = /(\p{L}{2,})-[ \t]*$/u.exec(left.text),
          b = /^[ \t]*(\p{Ll}{2,})/u.exec(right.text);
        if (!a || !b) continue;
        const word = words.find((w) => w.key === wordKey(a[1] + b[1], language));
        if (!word) continue;
        const add = (element: HTMLElement, start: number, end: number) => {
          const existing = matches.get(element)!.filter((m) => m.end <= start || m.start >= end);
          matches.set(
            element,
            [...existing, { word, start, end }].sort((a, b) => a.start - b.start),
          );
        };
        add(left.element, a.index, a.index + a[1].length + 1);
        const start = right.text.indexOf(b[1]);
        add(right.element, start, start + b[1].length);
      }
    for (const { element, text } of spans) {
      const occurrences = matches.get(element) ?? [],
        signature = JSON.stringify(
          occurrences.map(({ word, start, end }) => [
            word.sectionId,
            word.key,
            word.context,
            start,
            end,
          ]),
        );
      const describe = (button: HTMLElement, word: ReadingWord) => {
        const concept = latest.current.conceptFor(word);
        button.className = `pdf-word highlight appended ${concept ? 'is-ready' : 'is-pending'}`;
        button.title = concept
          ? [concept.expansion, concept.meaning, concept.summary].filter(Boolean).join(' · ')
          : '候选生词 · 释义尚未准备好';
        button.setAttribute(
          'aria-label',
          `${word.anchor}：${concept?.meaning ?? '待准备的候选生词'}`,
        );
      };
      if (decorated.current.get(element) === signature) {
        const existing = element.querySelectorAll<HTMLElement>('.pdf-word');
        occurrences.forEach(({ word }, i) => describe(existing[i], word));
        continue;
      }
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of occurrences) {
        // The upstream selection shim recognises highlight wrappers and keeps its end marker outside the text run.
        fragment.append(text.slice(cursor, match.start));
        const button = document.createElement('span');
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.textContent = text.slice(match.start, match.end);
        describe(button, match.word);
        const select = () => latest.current.onWord(match.word);
        button.onmouseenter = select;
        button.onfocus = select;
        button.onclick = select;
        button.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select();
          }
        };
        fragment.append(button);
        cursor = match.end;
      }
      fragment.append(text.slice(cursor));
      element.replaceChildren(fragment);
      decorated.current.set(element, signature);
      rebuilt.add(element);
    }
    if (
      selection &&
      anchor &&
      focus &&
      ((anchor.span && rebuilt.has(anchor.span)) || (focus.span && rebuilt.has(focus.span)))
    ) {
      const restore = (point: NonNullable<typeof anchor>) => {
        if (!point.span)
          return point.node.isConnected ? { node: point.node, offset: point.offset } : null;
        const walker = document.createTreeWalker(point.span, NodeFilter.SHOW_TEXT);
        let remaining = point.offset,
          node: Node | null;
        while ((node = walker.nextNode())) {
          const length = node.textContent?.length ?? 0;
          if (remaining <= length) return { node, offset: remaining };
          remaining -= length;
        }
        return null;
      };
      const a = restore(anchor),
        f = restore(focus);
      if (a && f) selection.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    }
  }
  function goTo(target: PdfDestination) {
    const ticket = ++navigationEpoch.current,
      current = viewer.current;
    if (!current?.pagesCount) return;
    pendingHeading.current = target.title ? { ...target, ticket } : null;
    current.scrollPageIntoView({ pageNumber: target.page });
    if (target.top === undefined) revealHeading(current.getPageView(target.page - 1));
    if (target.top !== undefined) {
      // Offsets use viewport scale 1; viewer zoom 1 also converts PDF points to CSS pixels.
      const locate = (proxy: import('pdfjs-dist').PDFPageProxy) => {
        if (viewer.current !== current || ticket !== navigationEpoch.current) return;
        const y = proxy.getViewport({ scale: 1 }).convertToPdfPoint(0, target.top!)[1];
        current.scrollPageIntoView({
          pageNumber: target.page,
          destArray: [null, { name: 'XYZ' }, 0, y, null],
          ignoreDestinationZoom: true,
        });
        revealHeading(current.getPageView(target.page - 1));
      };
      const view: PDFPageView = current.getPageView(target.page - 1);
      if (view.pdfPage) locate(view.pdfPage);
      else
        void pdf
          .getPage(target.page)
          .then(locate)
          .catch(() => undefined);
    }
  }
  useEffect(() => {
    let disposed = false,
      current: PDFViewer | undefined;
    const lifecycle = new AbortController();
    lifecycleSignal.current = lifecycle.signal;
    setTool('hand');
    setSwitching(false);
    setSaving(false);
    setSaveNotice('');
    editorMode.current = 0;
    setUndo(false);
    setRedo(false);
    setInitialized(false);
    setError('');
    setContinuous(true);
    setZoom('page-width');
    setPageError('');
    savedHash.current = pdf.annotationStorage.serializable.hash;
    const detectChanges = () => {
      if (!disposed && pdf.annotationStorage.serializable.hash !== savedHash.current) {
        latest.current.onDirtyChange(true);
        setSaveNotice('');
      }
    };
    checkChanges.current = detectChanges;
    // Existing editors mutate in-place; undo/removal need not call onSetModified.
    const afterEdit = () => queueMicrotask(detectChanges);
    window.addEventListener('pointerup', afterEdit, { signal: lifecycle.signal });
    window.addEventListener('keyup', afterEdit, { signal: lifecycle.signal });
    void (async () => {
      // The viewer consumes globalThis.pdfjsLib; load the matching legacy API first.
      const { pdfjs } = await import('./pdf-source');
      const { PDFViewer, EventBus } = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
      if (disposed) return;
      const types = pdfjs.AnnotationEditorType;
      editorModes.current = {
        hand: types.NONE,
        select: types.NONE,
        highlight: types.HIGHLIGHT,
        note: types.FREETEXT,
        ink: types.INK,
      };
      const bus = new EventBus();
      eventBus.current = bus;
      const options = {
        container: container.current!,
        viewer: pages.current!,
        eventBus: bus,
        annotationMode: pdfjs.AnnotationMode.ENABLE,
        annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
        annotationEditorHighlightColors: 'yellow=#fff066,green=#a6f5a6,blue=#9bd7ff,pink=#ffafd6',
        enableAutoLinking: false,
        enableSelectionRendering: false,
        maxCanvasPixels: 8 * 1024 * 1024,
        abortSignal: lifecycle.signal,
      };
      current = new PDFViewer(options);
      viewer.current = current;
      const storage = pdf.annotationStorage as unknown as { onSetModified: (() => void) | null };
      storage.onSetModified = afterEdit;
      bus.on('annotationeditormodechanged', ({ mode }: { mode: number }) => {
        if (!disposed) {
          editorMode.current = mode;
          setSwitching(false);
        }
      });
      bus.on(
        'switchannotationeditormode',
        (options: { mode: number; editId?: string; mustEnterInEditMode?: boolean }) => {
          if (disposed) return;
          setTool(
            options.mode === types.NONE
              ? 'select'
              : ((Object.keys(editorModes.current!) as Tool[]).find(
                  (tool) => editorModes.current![tool] === options.mode,
                ) ?? 'select'),
          );
          setSwitching(true);
          if (options.mode === editorMode.current) {
            setSwitching(false);
            return;
          }
          current!.annotationEditorMode = options;
          current!.update();
        },
      );
      bus.on(
        'editingstateschanged',
        ({
          details,
        }: {
          details: { hasSomethingToUndo: boolean; hasSomethingToRedo: boolean };
        }) => {
          if (!disposed) {
            setUndo(details.hasSomethingToUndo);
            setRedo(details.hasSomethingToRedo);
            afterEdit();
          }
        },
      );
      bus.on('pagesinit', () => {
        if (disposed) return;
        current!.currentScaleValue = 'page-width';
        setInitialized(true);
        goTo({
          page: latest.current.page,
          ...(latest.current.destination.page === latest.current.page
            ? { top: latest.current.destination.top }
            : {}),
        });
      });
      bus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
        if (!disposed) latest.current.onPageChange(pageNumber);
      });
      bus.on('scalechanging', ({ scale }: { scale: number }) => {
        if (!disposed) setPercent(Math.round(scale * 100));
      });
      bus.on(
        'textlayerrendered',
        ({ pageNumber, error }: { pageNumber: number; error?: unknown }) => {
          if (!disposed && !error) {
            const view = current!.getPageView(pageNumber - 1);
            decorate(view);
            revealHeading(view);
          }
        },
      );
      bus.on('pagerendered', ({ pageNumber, error }: { pageNumber: number; error?: unknown }) => {
        if (disposed) return;
        if (error) {
          setError('PDF 原版渲染失败，请重新导入文件。');
          return;
        }
        const view: PDFPageView = current!.getPageView(pageNumber - 1),
          canvas = view.div.querySelector<HTMLCanvasElement>('canvas');
        if (!canvas) return;
        canvas.dataset.testid = 'pdf-canvas';
        canvas.dataset.renderedPage = String(pageNumber);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `PDF 原版第 ${pageNumber} 页（含图片、图表与公式）`);
      });
      current.setDocument(pdf);
      void current.firstPagePromise.catch(() => {
        if (!disposed) setError('PDF 原版渲染失败，请重新导入文件。');
      });
    })().catch(() => {
      if (!disposed) setError('PDF 阅读器加载失败，请重新导入文件。');
    });
    return () => {
      disposed = true;
      navigationEpoch.current++;
      pendingHeading.current = null;
      for (const animation of animations.current) animation.cancel();
      lifecycle.abort();
      (pdf.annotationStorage as unknown as { onSetModified: null }).onSetModified = null;
      eventBus.current = null;
      if (current) {
        current.setDocument(null as unknown as PDFDocumentProxy);
        viewer.current = null;
      }
      pages.current?.replaceChildren();
    };
  }, [pdf]);
  useEffect(() => {
    if (initialized) goTo(destination);
  }, [destination, initialized]);
  useEffect(() => {
    if (initialized && viewer.current) viewer.current.scrollMode = continuous ? 0 : 3;
  }, [continuous, initialized]);
  useEffect(() => {
    if (initialized && viewer.current && zoom !== 'custom') viewer.current.currentScaleValue = zoom;
  }, [zoom, initialized]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const current = viewer.current,
        mode = preferences.current.zoom;
      if (element.clientWidth && element.clientHeight && current?.pagesCount && mode !== 'custom') {
        current.currentScaleValue = mode;
        current.update();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (initialized) for (const view of viewer.current?.getCachedPageViews() ?? []) decorate(view);
  }, [initialized, wordsForPage, language, conceptFor]);
  useEffect(() => {
    setPageInput(String(page));
    setPageError('');
  }, [page]);
  useEffect(() => {
    if (!props.interactionLocked && !saving) return;
    // Native editor shortcuts/clipboard handlers live on window and bypass inert.
    // Stop their delivery while keeping browser defaults (e.g. reload) available.
    const lifecycle = new AbortController(),
      block = (event: Event) => event.stopImmediatePropagation();
    for (const name of ['keydown', 'keyup', 'cut', 'paste'])
      window.addEventListener(name, block, { capture: true, signal: lifecycle.signal });
    return () => lifecycle.abort();
  }, [props.interactionLocked, saving]);
  useEffect(() => {
    const element = container.current;
    if (!element || tool !== 'hand') return;
    const lifecycle = new AbortController(),
      options = { signal: lifecycle.signal };
    let drag: {
      id: number;
      x: number;
      y: number;
      left: number;
      top: number;
      moved: boolean;
    } | null = null;
    const finish = () => {
      if (drag && element.hasPointerCapture(drag.id)) element.releasePointerCapture(drag.id);
      element.classList.remove('is-grabbing');
    };
    element.addEventListener(
      'pointerdown',
      (event) => {
        if (
          event.button !== 0 ||
          event.pointerType !== 'mouse' ||
          (event.target as Element).closest(
            'a,input,textarea,[contenteditable],.annotationEditorLayer,button:not(.pdf-word)',
          )
        )
          return;
        // Native scrollbars must remain draggable.
        const box = element.getBoundingClientRect();
        if (
          event.clientX >= box.left + element.clientWidth ||
          event.clientY >= box.top + element.clientHeight
        )
          return;
        event.preventDefault();
        drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: element.scrollLeft,
          top: element.scrollTop,
          moved: false,
        };
      },
      options,
    );
    window.addEventListener(
      'pointermove',
      (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        if (!event.buttons) {
          finish();
          drag = null;
          return;
        }
        const dx = event.clientX - drag.x,
          dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        element.setPointerCapture(drag.id);
        element.classList.add('is-grabbing');
        element.scrollLeft = drag.left - dx;
        element.scrollTop = drag.top - dy;
      },
      options,
    );
    window.addEventListener('pointerup', () => finish(), options);
    window.addEventListener(
      'pointercancel',
      () => {
        finish();
        drag = null;
      },
      options,
    );
    window.addEventListener(
      'blur',
      () => {
        finish();
        drag = null;
      },
      options,
    );
    element.addEventListener(
      'click',
      (event) => {
        if (drag?.moved) {
          event.preventDefault();
          event.stopPropagation();
        }
        drag = null;
      },
      { ...options, capture: true },
    );
    return () => {
      finish();
      lifecycle.abort();
    };
  }, [tool, pdf]);
  function jump(event: React.FormEvent) {
    event.preventDefault();
    const number = Number(pageInput.trim());
    if (
      !/^\d+$/.test(pageInput.trim()) ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > pdf.numPages
    ) {
      setPageError(`请输入 1–${pdf.numPages} 的整数页码`);
      return;
    }
    setPageError('');
    goTo({ page: number });
  }
  function adjustZoom(value: number) {
    setZoom('custom');
    setPercent(value);
    if (viewer.current) viewer.current.currentScale = value / 100;
  }
  function historyAction(name: 'undo' | 'redo') {
    eventBus.current?.dispatch('editingaction', { name });
    queueMicrotask(() => checkChanges.current());
  }
  return (
    <section className="reader-pdf" aria-label="PDF 阅读器">
      <div className="pdf-reader-controls" role="group" aria-label="PDF 阅读控制">
        <label className="check-row">
          <input
            type="checkbox"
            disabled={!initialized}
            checked={continuous}
            onChange={(e) => setContinuous(e.target.checked)}
          />
          <span>连续阅读</span>
        </label>
        <label>
          缩放模式
          <select
            aria-label="缩放模式"
            disabled={!initialized}
            value={zoom}
            onChange={(e) => setZoom(e.target.value as Zoom)}
          >
            <option value="page-actual">实际大小</option>
            <option value="page-fit">适合页面</option>
            <option value="page-width">适合宽度</option>
            <option value="custom" disabled>
              自定义
            </option>
          </select>
        </label>
        <label className="pdf-zoom-slider">
          <span>
            缩放 <output aria-live="polite">{percent}%</output>
          </span>
          <input
            aria-label="缩放比例"
            disabled={!initialized}
            type="range"
            min="25"
            max="400"
            step="1"
            value={Math.min(400, Math.max(25, percent))}
            onChange={(e) => adjustZoom(Number(e.target.value))}
          />
        </label>
        <form className="pdf-page-jump" onSubmit={jump} noValidate>
          <button
            type="button"
            aria-label="上一页"
            disabled={!initialized || page === 1}
            onClick={() => goTo({ page: page - 1 })}
          >
            ‹
          </button>
          <label>
            第{' '}
            <input
              aria-label="跳转页码"
              inputMode="numeric"
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              aria-invalid={!!pageError}
              aria-describedby={pageError ? 'pdf-page-error' : undefined}
            />{' '}
            / {pdf.numPages} 页
          </label>
          <button type="submit" disabled={!initialized}>
            跳转
          </button>
          <button
            type="button"
            aria-label="下一页"
            disabled={!initialized || page === pdf.numPages}
            onClick={() => goTo({ page: page + 1 })}
          >
            ›
          </button>
        </form>
      </div>
      <div className="pdf-edit-controls" role="group" aria-label="PDF 工具">
        {(
          [
            ['hand', '拖动'],
            ['select', '选择文字'],
            ['highlight', '高亮文字'],
            ['note', '文字批注'],
            ['ink', '画笔标记'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            disabled={!initialized || switching || saving}
            aria-pressed={tool === value}
            onClick={() => changeTool(value)}
          >
            {label}
          </button>
        ))}
        <button disabled={!undo || switching || saving} onClick={() => historyAction('undo')}>
          撤销
        </button>
        <button disabled={!redo || switching || saving} onClick={() => historyAction('redo')}>
          重做
        </button>
        <button disabled={!initialized || switching || saving} onClick={() => void exportPdf()}>
          {saving ? '正在导出…' : '导出含批注 PDF'}
        </button>
      </div>
      <p className="reader-hint">
        {tool === 'hand'
          ? '拖动页面调整显示区域；选段学习请切换“选择文字”。'
          : tool === 'select'
            ? '拖选原文后，点击上方“解释”“翻译”或“考考我”。'
            : tool === 'highlight'
              ? '拖选文字添加高亮，也可在空白或图表上拖动画出标记。'
              : tool === 'note'
                ? '点击页面任意位置输入文字批注。中文批注请用工作台重新打开，部分外部阅读器可能不显示。'
                : '在页面上拖动画出标记。'}{' '}
        批注保留在本次阅读中，关闭或换文件前请导出 PDF 保存。
      </p>
      {saveNotice && (
        <p role="status" className="reader-hint">
          {saveNotice}
        </p>
      )}
      {pageError && (
        <p className="reader-hint" id="pdf-page-error" role="alert">
          {pageError}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="pdf-viewport-frame">
        <div
          className="pdf-scroll-container"
          inert={saving}
          aria-busy={saving}
          ref={container}
          tabIndex={0}
          role="region"
          aria-label="PDF 页面"
          data-testid="pdf-scroll-container"
          data-tool={tool}
          onInput={() => {
            latest.current.onDirtyChange(true);
            setSaveNotice('');
          }}
          data-current-page={page}
          data-zoom-mode={zoom}
          data-continuous={continuous}
        >
          <div className="pdfViewer" ref={pages} />
        </div>
      </div>
      {!initialized && !error && (
        <p className="reader-hint" role="status">
          正在准备 PDF 页面…
        </p>
      )}
    </section>
  );
}
