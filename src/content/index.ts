import { defaultConcurrency, defaultBatchSize } from '../core/reading-defaults';
import { PageTranslation, translationStyle } from './page-translation';
import {
  annotationTypeValues,
  conceptKey,
  defaultAnnotationTypes,
  type AnnotationType,
  type Concept,
  type Mastered,
  type Profile,
  type TextContext,
} from '../core/types';
import {
  contextFor,
  extractBlocks,
  isExtensionMutation,
  locateText,
  matchesSnapshot,
  quizText,
  type Block,
} from './document';
import { localExplanation } from './glossary';
import { explainCommand } from './commands';
import { findCandidates, candidateKey, packCandidates, candidateEnvironment } from './candidates';
import type { Candidate } from '../core/types';
import { rpc } from '../ui/rpc';
import { connectSurface } from '../core/connection';
import { readingPriority } from './reading-order';
import { openQuizOverlay } from './quiz';
import type { AnalysisProgress, ModelTiming } from '../core/ai';

type Annotation = {
  range: Range;
  concept: Concept;
  block: Block;
  part?: { text: string; explanation: string };
};
type Payload = {
  context: TextContext;
  expandedContext: TextContext;
  concept?: Concept;
  mode: 'explain' | 'translate' | 'quiz';
};
const state = globalThis as typeof globalThis & { __easyLearn?: { toggle(): void } };
if (state.__easyLearn) state.__easyLearn.toggle();
else {
  let dirty = true;
  let active = false,
    generation = 0,
    running = false,
    scheduled = 0,
    rescan = false,
    hoverTimer = 0,
    dockOpenTimer = 0,
    dockCloseTimer = 0;
  let host: HTMLDivElement,
    shadow: ShadowRoot,
    dock: HTMLDivElement,
    statusNode: HTMLButtonElement,
    quizNode: HTMLButtonElement,
    tools: HTMLDivElement,
    diagnostic: HTMLParagraphElement;
  let tip: HTMLDivElement, selectionButton: HTMLDivElement, frame: HTMLIFrameElement | undefined;
  let connection: ReturnType<typeof connectSurface> | undefined,
    observer: MutationObserver | undefined;
  let blocks: Block[] = [],
    annotations: Annotation[] = [],
    payload: Payload | undefined,
    selected: Payload | undefined,
    shown: Annotation | undefined;
  let profile: Profile = { domain: '软件开发', level: '入门' },
    mastered: Mastered[] = [];
  let settingsError = '',
    networkPaused = false,
    codeAnnotations = false,
    localOnly = false,
    vocabularyError = '';
  let annotationTypes: AnnotationType[] = [...defaultAnnotationTypes],
    commonWords: Set<string> | undefined,
    allCommonWords: string[] | undefined,
    vocabularyLoad: Promise<void> | undefined;
  let quizCount = 5,
    maxPerBlock = 6,
    batchSize = defaultBatchSize,
    concurrency = defaultConcurrency,
    vocabularyBaseline = 10000,
    vocabularyPerBlock = 1;
  let codeToggle: HTMLInputElement, domainInput: HTMLInputElement, levelSelect: HTMLSelectElement;
  const typeToggles = new Map<AnnotationType, HTMLInputElement>();
  type Work = {
    candidate: Candidate;
    state: 'pending' | 'loading' | 'ready' | 'skipped' | 'failed';
    concept?: Concept;
    error?: string;
  };
  type Target = { block: Block; work: Work; offset: number };
  const workByKey = new Map<string, Work>();
  let targets: Target[] = [],
    nextId = 0;
  let batchCount = 0,
    tokenCount = 0,
    usageKnown = false,
    userPaused = false,
    observed: IntersectionObserver | undefined;
  const pendingProgress = new Map<string, (data: AnalysisProgress) => void>();
  let lastTiming: ModelTiming | undefined,
    cacheHits = 0,
    nextRequest = 0;
  let progress: HTMLSpanElement;
  const observedNodes = new Set<HTMLElement>();
  let translation: PageTranslation | undefined,
    translationButton: HTMLButtonElement,
    translationPause: HTMLButtonElement,
    translationProgress: HTMLSpanElement;

  const highlightName = `easy-learn-${chrome.runtime.id}-primary`,
    repeatHighlightName = `easy-learn-${chrome.runtime.id}-repeat`;
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightClass = (globalThis as any).Highlight;
  const style = document.createElement('style');
  style.dataset.easyLearn = '';
  style.textContent = `::highlight(${highlightName}){background-color:#0071e31a;color:inherit;text-decoration:underline solid #0071e366 1px;text-underline-offset:3px}::highlight(${repeatHighlightName}){background-color:transparent;color:inherit;text-decoration:underline dotted #8e8e93 1px;text-underline-offset:3px}`;
  style.textContent += translationStyle;
  function status() {
    if (!active) return;
    const works = [...new Set(targets.map((t) => t.work))];
    const ready = works.filter((w) => w.state === 'ready').length,
      skipped = works.filter((w) => w.state === 'skipped').length;
    const failures = works.filter((w) => w.state === 'failed');
    const remaining = works.filter((w) => w.state === 'pending').length;
    const phase =
      settingsError || networkPaused
        ? '已暂停，查看详情'
        : localOnly
          ? '离线模式 · 仅显示已准备的本地释义'
          : dirty
            ? '正在扫描正文'
            : userPaused
              ? '已暂停'
              : pendingProgress.size > 0 || works.some((w) => w.state === 'loading')
                ? '正在生成解释'
                : remaining
                  ? '正在准备整页注释'
                  : '当前内容已处理';
    statusNode.textContent = '阅读注释';
    const rects = new Map<HTMLElement, DOMRect>();
    const visible = [
      ...new Set(
        targets
          .filter((t) => {
            let r = rects.get(t.block.element);
            if (!r) {
              r = t.block.element.getBoundingClientRect();
              rects.set(t.block.element, r);
            }
            return r.bottom > 0 && r.top < innerHeight;
          })
          .map((t) => t.work),
      ),
    ].filter((w) => w.state !== 'skipped');
    const visibleReady = visible.filter((w) => w.state === 'ready').length;
    progress.textContent = `当前屏幕 ${visibleReady}/${visible.length} 已就绪 · 本地识别 ${works.length} · 已解释 ${ready} · 已过滤 ${skipped} · 未完成 ${failures.length} · ${phase}`;
    statusNode.title = `已准备 ${annotations.filter((a) => !a.part).length} 条注释。悬停下划线即可阅读。`;
    diagnostic.textContent = [
      `API ${batchCount} 批 · 本地缓存 ${cacheHits} 条${usageKnown ? ` · ${tokenCount} tokens` : ''}`,
      lastTiming
        ? `最近一批：排队 ${Math.round(lastTiming.queueMs ?? 0)} ms · 首条 ${lastTiming.firstItemMs === null ? '—' : Math.round(lastTiming.firstItemMs)} ms · 请求 ${Math.round(lastTiming.totalMs)} ms`
        : '',
      settingsError,
      vocabularyError,
      ...new Set(failures.map((w) => w.error)),
    ]
      .filter(Boolean)
      .join('\n');
  }
  function conceptIdentity(concept: Concept) {
    const words = concept.anchor.trim().toLocaleLowerCase().split(/\s+/);
    const last = words.at(-1) ?? '';
    if (concept.category === '术语' || concept.category === '缩写' || concept.category === '词汇') {
      if (/(?:ches|shes|xes|zes|sses)$/.test(last)) words[words.length - 1] = last.slice(0, -2);
      else if (last.endsWith('ies')) words[words.length - 1] = last.slice(0, -3) + 'y';
      else if (/[^s]s$/.test(last) && !/(?:us|is|ous)$/.test(last))
        words[words.length - 1] = last.slice(0, -1);
    }
    return JSON.stringify([
      concept.category,
      words.join(' '),
      concept.meaning.trim().toLocaleLowerCase(),
      concept.expansion.trim().toLocaleLowerCase(),
    ]);
  }
  function rebuild() {
    const next: Annotation[] = [],
      primary: Range[] = [],
      repeat: Range[] = [],
      valid = new Map<Block, boolean>(),
      seen = new Set<string>();
    for (const { block, work, offset } of targets) {
      if (work.state !== 'ready' || !work.concept) continue;
      if (!valid.has(block)) valid.set(block, matchesSnapshot(block));
      if (!valid.get(block)) continue;
      const concept = work.concept;
      if (mastered.some((m) => m.key === conceptKey(profile.domain, concept.meaning))) continue;
      const identity = conceptIdentity(concept),
        isPrimary = !seen.has(identity);
      seen.add(identity);
      const start = (block.offset ?? 0) + offset;
      const range = locateText(block.element, concept.anchor, start);
      if (!range) continue;
      let cursor = 0;
      for (const part of concept.parts ?? []) {
        const index = concept.anchor.indexOf(part.text, cursor);
        if (index < 0) continue;
        const partRange = locateText(block.element, part.text, start + index);
        if (partRange) {
          next.push({ range: partRange, concept, block, part });
          (isPrimary ? primary : repeat).push(partRange);
        }
        cursor = index + part.text.length;
      }
      next.push({ range, concept, block });
      (isPrimary ? primary : repeat).push(range);
    }
    annotations = next;
    if (highlights && HighlightClass) {
      highlights.set(highlightName, new HighlightClass(...primary));
      highlights.set(repeatHighlightName, new HighlightClass(...repeat));
    }
    if (shown && !matchesSnapshot(shown.block)) hideTip();
    status();
  }
  function sendContext() {
    try {
      connection?.port.postMessage({ type: 'CONTEXT', payload: payload ?? null });
    } catch {
      /* worker gone */
    }
  }
  function openPanel(next?: Payload) {
    hideTip();
    payload = next;
    if (!frame) {
      frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL('panel.html');
      frame.title = 'Easy Learn 学习面板';
      frame.className = 'panel';
      shadow.append(frame);
    } else sendContext();
  }
  function hideTip() {
    clearTimeout(hoverTimer);
    shown = undefined;
    if (tip) tip.hidden = true;
  }
  function node(tag: string, text: string) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  }
  function showTip(item: Annotation, x: number, y: number) {
    if (shown === item && !tip.hidden) return;
    shown = item;
    tip.replaceChildren();
    const header = node('div', '');
    header.className = 'tip-header';
    header.append(node('strong', item.part?.text ?? item.concept.anchor));
    const close = node('button', '×') as HTMLButtonElement;
    close.setAttribute('aria-label', '关闭注释');
    close.onclick = hideTip;
    header.append(close);
    tip.append(header);
    const label = node('small', item.concept.meaning);
    tip.append(label);
    if (!item.part && item.concept.expansion) tip.append(node('small', item.concept.expansion));
    tip.append(node('p', item.part?.explanation ?? item.concept.summary!));
    if (!item.part && (item.concept.parts?.length ?? 0) > 0) {
      const list = document.createElement('dl');
      for (const part of item.concept.parts!) {
        list.append(node('dt', part.text), node('dd', part.explanation));
      }
      tip.append(list);
    }
    if (item.concept.ambiguity) tip.append(node('p', `语境尚不确定：${item.concept.ambiguity}`));
    if (!item.part && item.concept.evidence) {
      const evidence = node('small', item.concept.evidence);
      tip.append(evidence);
    }
    const more = node('button', '深入理解 / 翻译') as HTMLButtonElement;
    more.className = 'more';
    more.onclick = () =>
      openPanel({
        context: contextFor(item.block, blocks),
        expandedContext: contextFor(item.block, blocks, true),
        concept: item.concept,
        mode: 'explain',
      });
    tip.append(more);
    const understood = node('button', '我懂了，不再显示') as HTMLButtonElement;
    understood.onclick = async () => {
      understood.disabled = true;
      try {
        const entry = await rpc<Mastered>('MASTER', { concept: item.concept });
        mastered = [...mastered.filter((m) => m.key !== entry.key), entry];
        hideTip();
        rebuild();
      } catch (e) {
        understood.disabled = false;
        tip.append(node('p', (e as Error).message));
      }
    };
    tip.append(understood);
    // No fetch, RPC or analysis is allowed here: every displayed byte is preloaded.
    const articleStyle = getComputedStyle(item.block.element);
    tip.style.fontFamily = articleStyle.fontFamily;
    tip.hidden = false;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - 370, x))}px`;
    tip.style.top = `${Math.max(8, y + 14)}px`;
    const rect = tip.getBoundingClientRect();
    if (rect.bottom > innerHeight - 8) tip.style.top = `${Math.max(8, y - rect.height - 12)}px`;
  }
  function hovered(event: MouseEvent) {
    clearTimeout(hoverTimer);
    if (event.composedPath().includes(host)) return;
    if (window.getSelection()?.toString().trim()) {
      hideTip();
      return;
    }
    const item = annotations.find(
      (a) =>
        matchesSnapshot(a.block) &&
        [...a.range.getClientRects()].some(
          (r) =>
            event.clientX >= r.left &&
            event.clientX <= r.right &&
            event.clientY >= r.top &&
            event.clientY <= r.bottom,
        ),
    );
    if (item) showTip(item, event.clientX, event.clientY);
    else hoverTimer = window.setTimeout(hideTip, 180);
  }
  async function loadCommonWords() {
    if (commonWords) return;
    vocabularyLoad ??= (async () => {
      const response = await fetch(chrome.runtime.getURL('vocabulary/common-words-10k.txt'));
      if (!response.ok) throw new Error('无法读取本地常用词表。');
      const content = await response.text();
      allCommonWords = content
        .split(/\s+/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean);
      commonWords = new Set(allCommonWords.slice(0, vocabularyBaseline));
    })();
    try {
      await vocabularyLoad;
      vocabularyError = '';
    } catch {
      vocabularyLoad = undefined;
      vocabularyError = '本地词汇表暂不可用，扩展词汇候选未加入。';
    }
  }
  async function settings() {
    try {
      const data = await rpc<{
        profile: Profile;
        mastered: Mastered[];
        codeAnnotations?: boolean;
        localOnly?: boolean;
        annotationTypes?: AnnotationType[];
        quizCount?: number;
        maxPerBlock?: number;
        batchSize?: number;
        concurrency?: number;
        vocabularyBaseline?: number;
        vocabularyPerBlock?: number;
      }>('PUBLIC_SETTINGS');
      vocabularyBaseline = data.vocabularyBaseline ?? 10000;
      vocabularyPerBlock = data.vocabularyPerBlock ?? 1;
      if (allCommonWords) commonWords = new Set(allCommonWords.slice(0, vocabularyBaseline));
      batchSize = data.batchSize ?? defaultBatchSize;
      concurrency = data.concurrency ?? defaultConcurrency;
      localOnly = data.localOnly === true;
      profile = data.profile;
      mastered = data.mastered;
      codeAnnotations = data.codeAnnotations === true;
      annotationTypes = data.annotationTypes ?? [...defaultAnnotationTypes];
      if (typeof data.quizCount === 'number' && data.quizCount >= 2 && data.quizCount <= 8)
        quizCount = data.quizCount;
      if (data.maxPerBlock === 2 || data.maxPerBlock === 4 || data.maxPerBlock === 6)
        maxPerBlock = data.maxPerBlock;
      for (const [type, input] of typeToggles) input.checked = annotationTypes.includes(type);
      if (annotationTypes.includes('vocabulary')) await loadCommonWords();
      else vocabularyError = '';
      if (codeToggle) codeToggle.checked = codeAnnotations;
      if (domainInput) domainInput.value = profile.domain;
      if (levelSelect) levelSelect.value = profile.level;
      settingsError = '';
    } catch (e) {
      settingsError = (e as Error).message;
    }
    status();
  }
  function refreshBlocks() {
    blocks = extractBlocks(document, true);
    const next: Target[] = [];
    const environment = candidateEnvironment(blocks, document.title);
    for (const [i, block] of blocks.entries()) {
      if (block.kind === 'code' && !codeAnnotations) continue;
      const local = block.kind === 'command' ? explainCommand(block.text) : null;
      const candidates = local
        ? [
            {
              anchor: block.text,
              start: 0,
              kind: 'command' as const,
              heading: block.heading.slice(0, 120),
              context: block.text.slice(0, 420),
            },
          ]
        : findCandidates(block, {
            ...environment,
            unknownVocabulary: annotationTypes.includes('vocabulary') && !!commonWords,
            commonWords,
            maxPerBlock,
            vocabularyPerBlock,
            nearby: [blocks[i - 1], blocks[i + 1]]
              .filter((b) => b?.sectionId === block.sectionId)
              .map((b) => b.text.slice(0, 120))
              .join(' '),
          });
      for (const c of candidates) {
        if (c.kind === 'code' && !codeAnnotations) continue;
        if (c.kind !== 'code' && !annotationTypes.includes(c.kind as AnnotationType)) continue;
        const identity = candidateKey(c, JSON.stringify(profile));
        let work = workByKey.get(identity);
        if (!work) {
          const immediate = local?.[0] ?? localExplanation(c, profile);
          work = {
            candidate: {
              id: `c${nextId++}`,
              anchor: c.anchor.slice(0, 300),
              kind: c.kind,
              heading: c.heading,
              context: c.context,
            },
            state: immediate ? 'ready' : 'pending',
            concept: immediate,
          };
          workByKey.set(identity, work);
        }
        // One explanation serves every exact occurrence in the same block; later ranges receive the quieter style.
        let from = c.start;
        while (from <= block.text.length - c.anchor.length) {
          const occurrence = block.text.indexOf(c.anchor, from);
          if (occurrence < 0) break;
          const before = block.text[occurrence - 1] ?? '',
            after = block.text[occurrence + c.anchor.length] ?? '';
          const wordLike = /[A-Za-z0-9_]/;
          if (
            !(wordLike.test(c.anchor[0]) && wordLike.test(before)) &&
            !(wordLike.test(c.anchor.at(-1) ?? '') && wordLike.test(after))
          )
            next.push({ block, work, offset: occurrence });
          from = occurrence + c.anchor.length;
        }
      }
    }
    targets = next;
    // Bound removed-node cache while retaining current-page repeats.
    if (workByKey.size > 2000) {
      const live = new Set(targets.map((t) => t.work));
      for (const [k, w] of workByKey) if (!live.has(w)) workByKey.delete(k);
    }
    if (observed) {
      const live = new Set(blocks.map((b) => b.element));
      for (const el of observedNodes)
        if (!live.has(el)) {
          observed.unobserve(el);
          observedNodes.delete(el);
        }
      for (const el of live)
        if (!observedNodes.has(el)) {
          observed.observe(el);
          observedNodes.add(el);
        }
    }
    dirty = false;
    rebuild();
  }
  function orderedTargets() {
    const positions = new Map<HTMLElement, number>();
    for (const t of targets)
      if (!positions.has(t.block.element)) {
        const r = t.block.element.getBoundingClientRect();
        positions.set(t.block.element, readingPriority(r.top, r.bottom, innerHeight));
      }
    return [...targets].sort(
      (a, b) => positions.get(a.block.element)! - positions.get(b.block.element)!,
    );
  }
  async function scan() {
    if (!active) return;
    if (running) {
      rescan = true;
      return;
    }
    running = true;
    rescan = false;
    const current = generation;
    try {
      if (dirty) refreshBlocks();
      const lane = async () => {
        while (
          active &&
          current === generation &&
          !networkPaused &&
          !settingsError &&
          !userPaused &&
          !localOnly
        ) {
          if (dirty) refreshBlocks();
          const pending = [...new Set(orderedTargets().map((t) => t.work))].filter(
            (w) => w.state === 'pending',
          );
          const batch = packCandidates(pending, batchSize);
          if (!batch.length) break;
          batch.forEach((w) => (w.state = 'loading'));
          batchCount++;
          status();
          const requestId = `${generation}-${++nextRequest}`;
          pendingProgress.set(requestId, (data) => {
            if (!active || current !== generation) return;
            for (const w of batch) {
              const concept = data.concepts.find((c) => c.id === w.candidate.id);
              if (concept?.summary) {
                w.concept = { ...concept, anchor: w.candidate.anchor };
                w.state = 'ready';
              } else if (data.skipped.includes(w.candidate.id)) w.state = 'skipped';
            }
            rebuild();
          });
          try {
            const data = await rpc<{
              concepts: Concept[];
              skipped?: string[];
              missing?: string[];
              __usage?: number | null;
              __cached?: boolean;
              __cacheHits?: number;
              __timing?: ModelTiming;
              __warning?: string;
            }>('AI', {
              requestId,
              request: {
                operation: 'analyze',
                context: {
                  title: document.title.slice(0, 160),
                  heading: '',
                  text: '本地候选解释',
                  before: '',
                  after: '',
                },
                candidates: batch.map((w) => w.candidate),
              },
            });
            if (!active || current !== generation) break;
            if (data.__cached) batchCount--;
            else if (typeof data.__usage === 'number') {
              tokenCount += data.__usage;
              usageKnown = true;
            }
            cacheHits += data.__cacheHits ?? 0;
            if (data.__timing) lastTiming = data.__timing;
            for (const w of batch) {
              if (w.state === 'ready' || w.state === 'skipped') continue;
              const concept =
                data.concepts.find((c) => c.id === w.candidate.id) ||
                data.concepts.find((c) => !c.id && c.anchor === w.candidate.anchor);
              if (concept?.summary) {
                w.concept = { ...concept, anchor: w.candidate.anchor };
                w.state = 'ready';
              } else if (data.skipped?.includes(w.candidate.id)) {
                w.state = 'skipped';
              } else {
                w.state = 'failed';
                w.error = data.__warning ?? '此候选暂未收到有效解释，已保留其他结果；可手动重试。';
              }
            }
          } catch (e) {
            if (!active || current !== generation) break;
            const error = (e as Error).message;
            for (const w of batch)
              if (w.state !== 'ready' && w.state !== 'skipped') {
                w.state = 'failed';
                w.error = error;
              }
            if (/限流|额度|认证|授权|配置|先打开设置|连接已中断/.test(error)) networkPaused = true;
          } finally {
            pendingProgress.delete(requestId);
          }
          rebuild();
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => lane()));
    } finally {
      running = false;
      status();
      if (active && (current !== generation || rescan)) schedule();
    }
  }
  function schedule() {
    if (!active) return;
    if (scheduled) return;
    scheduled = window.setTimeout(() => {
      scheduled = 0;
      void scan();
    }, 200);
  }
  function onScroll() {
    hideTip();
    selectionButton.hidden = true;
    schedule();
    translation?.reprioritize();
  }
  function selection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      selectionButton.hidden = true;
      return;
    }
    const range = sel.getRangeAt(0);
    const parent =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (
      parent?.closest(
        'input,textarea,[contenteditable]:not([contenteditable="false"]),nav,header,footer,aside,[data-easy-learn]',
      )
    ) {
      selectionButton.hidden = true;
      return;
    }
    const text = sel.toString().trim().slice(0, 16000);
    if (!text) return;
    const block = blocks.find(
      (b) => b.element.contains(range.commonAncestorContainer) && b.text.includes(text),
    );
    const base = block
      ? contextFor(block, blocks)
      : { title: document.title.slice(0, 500), heading: '', text, before: '', after: '' };
    selected = {
      context: { ...base, text },
      expandedContext: block ? { ...contextFor(block, blocks, true), text } : base,
      mode: 'explain',
    };
    const rect = range.getBoundingClientRect();
    selectionButton.style.left = `${Math.max(8, Math.min(innerWidth - 306, rect.left))}px`;
    selectionButton.style.top = `${Math.min(innerHeight - 54, Math.max(8, rect.bottom + 8))}px`;
    selectionButton.hidden = false;
  }
  function mount() {
    host = document.createElement('div');
    host.dataset.easyLearn = '';
    shadow = host.attachShadow({ mode: 'open' });
    const css = node(
      'style',
      `:host{all:initial;pointer-events:none;position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647;font:14px/1.6 system-ui;color:#1d1d1f}*{box-sizing:border-box}button{pointer-events:auto;font:inherit;cursor:pointer;color:inherit;background:transparent;border:0;padding:7px 11px;border-radius:999px;transition:background .16s,color .16s}button:hover{background:#0000000b}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #007aff;outline-offset:2px}.dock-sheet{pointer-events:auto}.dock-sheet input:not([type=checkbox]),.dock-sheet select{font:inherit;box-sizing:border-box;border:1px solid #d2d2d7;border-radius:11px;padding:9px 11px;background:#fff;color:#1d1d1f}.dock-sheet button{display:block;margin:5px 0;text-align:left}.dock-sheet input[type=checkbox]{accent-color:#0071e3}.type-row{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:12px}.type-row input{margin:0}.tip{pointer-events:auto;z-index:2;position:fixed;width:min(350px,calc(100vw - 16px));max-height:min(440px,70vh);overflow:auto;border:1px solid #e5e5ea;border-radius:17px;background:#fff;color:#1d1d1f;box-shadow:0 9px 32px #0002;padding:16px 17px;font:13px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui}.tip-header{display:flex;align-items:start;justify-content:space-between;gap:12px}.tip strong,.tip dt{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.tip p{margin:9px 0;white-space:pre-wrap}.tip small{display:block;opacity:.68;font-size:11px}.tip dl{margin:10px 0}.tip dt{font-size:12px;margin-top:7px}.tip dd{margin:0;color:inherit;opacity:.85}.more{display:block;margin:10px 0 0 -5px;color:#007aff;font-size:12px;text-decoration:none}.panel{pointer-events:auto;z-index:3;position:fixed;right:14px;top:14px;width:min(420px,calc(100vw - 28px));height:calc(100dvh - 28px);border:1px solid #e5e5ea;border-radius:20px;background:#f5f5f7;box-shadow:0 16px 56px #0003}.selection{pointer-events:auto;position:fixed;display:flex;align-items:center;gap:4px;width:min(306px,calc(100vw - 16px));padding:6px;border:1px solid #e5e5ea;border-radius:999px;background:#fffffff2;color:#1d1d1f;font-size:12px;box-shadow:0 5px 20px #0002;backdrop-filter:blur(20px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui}.selection[hidden]{display:none!important}.selection button{flex:1;min-width:0;padding:8px 5px;font-weight:550;white-space:nowrap}.selection .selection-quiz{color:#fff;background:#007aff}.selection .selection-quiz:hover{background:#0064d9}.selection .selection-explain:hover,.selection button:last-child:hover{background:#0000000a}[hidden]{display:none!important}@media(prefers-color-scheme:dark){.tip{background:#242426;color:#f5f5f7;border-color:#3a3a3c}.selection{background:#242426f2;color:#f5f5f7;border-color:#48484a}.selection .selection-quiz{background:#0a84ff}.panel{background:#1c1c1e;border-color:#38383a}.dock-sheet,.tip{color:#f5f5f7}}`,
    );
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-label', '阅读注释');
    tip.onmouseenter = () => clearTimeout(hoverTimer);
    tip.onmouseleave = () => {
      hoverTimer = window.setTimeout(hideTip, 180);
    };
    selectionButton = document.createElement('div');
    selectionButton.className = 'selection';
    selectionButton.setAttribute('role', 'toolbar');
    selectionButton.setAttribute('aria-label', '对选中文字操作');
    selectionButton.hidden = true;
    selectionButton.onmousedown = (e) => e.preventDefault();
    const openSelected = (mode: Payload['mode']) => {
      if (!selected) return;
      const next = { ...selected, mode };
      if (mode === 'quiz') {
        next.context = {
          title: '',
          heading: '',
          text: selected.context.text,
          before: '',
          after: '',
        };
        next.expandedContext = next.context;
      }
      openPanel(next);
      selectionButton.hidden = true;
    };
    const explainSelection = node('button', '解释') as HTMLButtonElement;
    explainSelection.className = 'selection-explain';
    explainSelection.onclick = () => openSelected('explain');
    const quizSelection = node('button', '考考我！') as HTMLButtonElement;
    quizSelection.className = 'selection-quiz';
    quizSelection.onclick = () => openSelected('quiz');
    const translateSelection = node('button', '翻译') as HTMLButtonElement;
    translateSelection.onclick = () => openSelected('translate');
    selectionButton.append(explainSelection, quizSelection, translateSelection);
    dock = document.createElement('div');
    dock.dataset.easyLearn = '';
    dock.style.cssText =
      'position:fixed;right:12px;bottom:16px;pointer-events:none;z-index:1;display:flex;flex-direction:column;align-items:flex-end;gap:7px;font:13px/1.55 system-ui;color:#293a34';
    statusNode = node('button', '阅读注释') as HTMLButtonElement;
    statusNode.style.cssText =
      'background:#fffffff2;color:#1d1d1f;border:1px solid #e5e5ea;border-radius:12px;padding:9px 13px;box-shadow:0 3px 16px #0000000f';
    statusNode.setAttribute('aria-expanded', 'false');
    statusNode.title = '伴读已开启。悬停展开注释与阅读设置。';
    quizNode = node('button', '整页测验') as HTMLButtonElement;
    quizNode.style.cssText =
      'background:#0071e3;color:white;border:1px solid #0071e3;border-radius:12px;padding:9px 13px;box-shadow:0 3px 16px #0000000f';
    quizNode.title = '扫描整页正文，出几道选择题检验理解';
    quizNode.setAttribute('aria-haspopup', 'dialog');
    quizNode.onclick = () => {
      if (dirty) refreshBlocks();
      const text = quizText(blocks);
      if (!text) {
        progress.textContent = '未找到可测验的正文。';
        return;
      }
      openQuizOverlay(shadow, () => ({ title: document.title, text, count: quizCount }));
    };
    tools = document.createElement('div');
    tools.hidden = true;
    tools.className = 'dock-sheet';
    tools.setAttribute('role', 'dialog');
    tools.setAttribute('aria-label', '伴读设置');
    tools.style.cssText =
      'position:absolute;right:0;bottom:calc(100% + 8px);width:min(310px,calc(100vw - 30px));max-height:70vh;overflow:auto;background:#fff;color:#1d1d1f;border:1px solid #e5e5ea;padding:18px;border-radius:16px;box-shadow:0 5px 24px #00000014';
    progress = document.createElement('span');
    progress.setAttribute('role', 'status');
    progress.setAttribute('aria-live', 'polite');
    progress.style.cssText =
      'pointer-events:none;display:block;max-width:min(330px,calc(100vw - 28px));font-size:11px;line-height:1.45;color:#52685b;text-align:right;margin:0 2px;padding:5px 8px;border-radius:8px;background:#fffff2eF;box-shadow:0 2px 10px #173a3018';
    tools.append(node('strong', '注释类型'));
    const labels: Record<AnnotationType, string> = {
      abbreviation: '英文缩写',
      term: '专有名词与技术术语',
      command: 'CLI 命令',
      vocabulary: '扩展词汇（试验）',
    };
    async function updateTypes(type: AnnotationType, enabled: boolean) {
      const next = enabled
        ? [...new Set([...annotationTypes, type])]
        : annotationTypes.filter((item) => item !== type);
      annotationTypes = next;
      try {
        await rpc('SET_ANNOTATION_TYPES', { types: next });
        await settings();
        if (active) {
          refreshBlocks();
          schedule();
        }
        feedback.textContent = '注释类型已保存。';
      } catch (e) {
        feedback.textContent = (e as Error).message;
        await settings();
      }
    }
    for (const type of annotationTypeValues) {
      const label = node('label', '');
      label.className = 'type-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = annotationTypes.includes(type);
      input.setAttribute('aria-label', labels[type]);
      typeToggles.set(type, input);
      input.onchange = () => void updateTypes(type, input.checked);
      label.append(input, document.createTextNode(labels[type]));
      tools.append(label);
    }
    const vocabularyHelp = node(
      'small',
      '依照常用词频表近似筛选，不等同于四级词表；开启后可能增加 API 用量。',
    );
    vocabularyHelp.style.cssText = 'display:block;margin:2px 0 10px';
    tools.append(vocabularyHelp);
    const codeLabel = node('label', '');
    codeLabel.className = 'type-row';
    codeToggle = document.createElement('input');
    codeToggle.type = 'checkbox';
    codeToggle.setAttribute('aria-label', '代码注释（不含命令行）');
    codeLabel.append(codeToggle, document.createTextNode('代码注释（不含命令行）'));
    codeToggle.onchange = async () => {
      try {
        await rpc('SET_CODE_ANNOTATIONS', { enabled: codeToggle.checked });
        await settings();
        refreshBlocks();
        schedule();
        feedback.textContent = '设置已保存';
      } catch (e) {
        feedback.textContent = (e as Error).message;
      }
    };
    tools.append(codeLabel);
    const codeHelp = node('small', '代码默认关闭；命令行由上方的独立开关控制。');
    codeHelp.style.cssText = 'display:block;margin:-2px 0 12px';
    tools.append(codeHelp);
    tools.append(node('strong', '解释偏好'));
    const domainLabel = node('label', '学习领域');
    domainLabel.style.cssText = 'display:block;margin-top:8px';
    domainInput = document.createElement('input');
    domainInput.maxLength = 80;
    domainInput.setAttribute('aria-label', '学习领域');
    domainInput.style.cssText = 'display:block;width:100%;margin:5px 0 10px';
    domainLabel.append(domainInput);
    tools.append(domainLabel);
    const levelLabel = node('label', '熟悉程度');
    levelSelect = document.createElement('select');
    levelSelect.setAttribute('aria-label', '熟悉程度');
    for (const value of ['入门', '熟悉', '进阶']) {
      const option = node('option', value);
      levelSelect.append(option);
    }
    levelSelect.style.cssText = 'display:block;width:100%;margin:5px 0 10px';
    levelLabel.append(levelSelect);
    tools.append(levelLabel);
    const feedback = node('p', '');
    feedback.setAttribute('aria-live', 'polite');
    feedback.style.cssText = 'font-size:11px;color:#527466;margin:7px 0';
    const saveProfile = node('button', '应用学习偏好') as HTMLButtonElement;
    saveProfile.onclick = async () => {
      try {
        await rpc('SET_PROFILE', {
          profile: { domain: domainInput.value, level: levelSelect.value },
        });
        feedback.textContent = '学习偏好已应用';
      } catch (e) {
        feedback.textContent = (e as Error).message;
      }
    };
    tools.append(saveProfile);
    const actions: [string, () => void][] = [
      [
        '暂停 / 继续预载',
        () => {
          userPaused = !userPaused;
          status();
          if (!userPaused) schedule();
        },
      ],
      [
        '重试未完成项',
        () => {
          for (const w of workByKey.values())
            if (w.state === 'failed') {
              w.state = 'pending';
              w.error = undefined;
            }
          networkPaused = false;
          settingsError = '';
          void settings().then(schedule);
        },
      ],
      ['模型设置 / 不再显示列表', () => void rpc('OPEN_OPTIONS')],
      ['粘贴文本', () => openPanel()],
    ];
    for (const [label, action] of actions) {
      const b = node('button', label) as HTMLButtonElement;
      b.onclick = action;
      tools.append(b);
    }
    diagnostic = document.createElement('p');
    diagnostic.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;margin:6px 0';
    tools.append(diagnostic, feedback);
    function showTools() {
      clearTimeout(dockOpenTimer);
      clearTimeout(dockCloseTimer);
      tools.hidden = false;
      statusNode.setAttribute('aria-expanded', 'true');
    }
    function hideTools() {
      clearTimeout(dockOpenTimer);
      clearTimeout(dockCloseTimer);
      dockCloseTimer = window.setTimeout(() => {
        tools.hidden = true;
        statusNode.setAttribute('aria-expanded', 'false');
      }, 700);
    }
    dock.addEventListener('mouseenter', () => {
      clearTimeout(dockCloseTimer);
      clearTimeout(dockOpenTimer);
      dockOpenTimer = window.setTimeout(showTools, 450);
    });
    dock.addEventListener('mouseleave', hideTools);
    dock.addEventListener('focusin', showTools);
    dock.addEventListener('focusout', (event) => {
      if (!dock.contains(event.relatedTarget as Node | null)) hideTools();
    });
    statusNode.onclick = () => {
      if (tools.hidden) showTools();
      else {
        tools.hidden = true;
        statusNode.setAttribute('aria-expanded', 'false');
      }
    };
    translationButton = node('button', '翻译全文') as HTMLButtonElement;
    translationButton.style.cssText = statusNode.style.cssText;
    translationButton.title = '正文逐段翻译成中文，保留原文；使用已连接模型服务的额度。';
    translationPause = node('button', '暂停翻译') as HTMLButtonElement;
    translationPause.style.cssText = statusNode.style.cssText;
    translationPause.hidden = true;
    translationProgress = node('span', '') as HTMLSpanElement;
    translationProgress.setAttribute('role', 'status');
    translationProgress.style.cssText = progress.style.cssText;
    translationProgress.hidden = true;
    translation = new PageTranslation({
      concurrency: () => concurrency,
      request: async (context) => {
        const result = await rpc<{ translation: string }>('AI', {
          pageTranslation: true,
          request: { operation: 'explain', mode: 'translate', context },
        });
        return result.translation;
      },
      cancel: () => rpc('CANCEL_TRANSLATION'),
      changed: (state) => {
        translationButton.textContent = state.visible ? '还原原文' : '翻译全文';
        translationButton.setAttribute('aria-pressed', String(state.visible));
        translationPause.hidden = !state.visible;
        translationPause.textContent = state.paused ? '继续翻译' : '暂停翻译';
        translationProgress.hidden = !state.visible;
        translationProgress.textContent = `全文翻译 ${state.ready}/${state.total} 段${state.paused ? ' · 已暂停' : ''}${state.error ? ' · ' + state.error : ''}`;
      },
    });
    translationButton.onclick = () => translation?.toggle();
    translationPause.onclick = () => translation?.togglePause();
    dock.append(
      statusNode,
      translationButton,
      translationPause,
      translationProgress,
      quizNode,
      progress,
      tools,
    );
    shadow.append(css, tip, selectionButton, dock);
    document.documentElement.append(host, style);
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') hideTip();
    else selection();
  }
  async function start() {
    active = true;
    dirty = true;
    generation++;
    mount();
    connection = connectSurface('content');
    connection.port.onMessage.addListener((msg) => {
      if (msg.type === 'AI_PROGRESS')
        pendingProgress.get(msg.requestId)?.({
          concepts: msg.concepts ?? [],
          skipped: msg.skipped ?? [],
        });
      if (msg.type === 'PANEL_READY') sendContext();
      if (msg.type === 'CLOSE') {
        frame?.remove();
        frame = undefined;
      }
      if (msg.type === 'REFRESH') {
        if (msg.invalidate !== false) {
          generation++;
          pendingProgress.clear();
          workByKey.clear();
          networkPaused = false;
          translation?.invalidate();
        }
        void settings().then(() => {
          if (active) {
            refreshBlocks();
            schedule();
            translation?.reprioritize();
          }
        });
      }
    });
    connection.port.onDisconnect.addListener(() => {
      if (active) {
        settingsError = '扩展连接已中断，请刷新页面后重新开启伴读。';
        networkPaused = true;
        translation?.pause();
        status();
      }
    });
    document.addEventListener('mousemove', hovered);
    document.addEventListener('mouseup', selection);
    document.addEventListener('keyup', keyboard);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);

    observer = new MutationObserver((records) => {
      if (records.every(isExtensionMutation)) return;
      dirty = true;
      hideTip();
      schedule();
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    await settings();
    if (active) {
      refreshBlocks();
      void scan();
    }
  }
  function stop() {
    translation?.dispose();
    translation = undefined;
    active = false;
    generation++;
    clearTimeout(scheduled);
    clearTimeout(hoverTimer);
    clearTimeout(dockOpenTimer);
    clearTimeout(dockCloseTimer);
    observer?.disconnect();
    observed?.disconnect();
    observed = undefined;
    observedNodes.clear();
    try {
      connection?.port.postMessage({ type: 'STOP' });
    } catch {
      /* closed */
    }
    connection?.disconnect();
    connection = undefined;
    host?.remove();
    typeToggles.clear();
    style.remove();
    frame?.remove();
    frame = undefined;
    payload = undefined;
    selected = undefined;
    shown = undefined;
    highlights?.delete(highlightName);
    highlights?.delete(repeatHighlightName);
    pendingProgress.clear();
    workByKey.clear();
    lastTiming = undefined;
    cacheHits = 0;
    targets = [];
    annotations = [];
    blocks = [];
    scheduled = 0;
    batchCount = 0;
    tokenCount = 0;
    usageKnown = false;
    userPaused = false;
    networkPaused = false;
    settingsError = '';
    document.removeEventListener('mousemove', hovered);
    document.removeEventListener('mouseup', selection);
    document.removeEventListener('keyup', keyboard);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
  }
  state.__easyLearn = {
    toggle() {
      if (active) stop();
      else void start();
    },
  };
  void start();
}
