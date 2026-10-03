import { extractBlocks, isExtensionMutation, matchesSnapshot, type Block } from './document';
import { readingPriority } from './reading-order';
import type { TextContext } from '../core/types';

type Part = {
  source: string;
  translation?: string;
  state: 'pending' | 'loading' | 'ready' | 'failed';
};
type Unit = { block: Block; parts: Part[]; node?: HTMLElement };
export type TranslationStatus = {
  visible: boolean;
  paused: boolean;
  ready: number;
  total: number;
  error: string;
};
type Options = {
  request: (context: TextContext) => Promise<string>;
  cancel: () => Promise<unknown>;
  concurrency: () => number;
  changed: (status: TranslationStatus) => void;
};
export const translationStyle = `.easy-learn-translation{display:block!important;margin:8px 0 15px;padding:0 0 0 12px;border-left:2px solid #0071e344;color:inherit;font:400 .95em/1.7 system-ui;white-space:pre-wrap;overflow-wrap:anywhere;opacity:.88}.easy-learn-translation[hidden]{display:none!important}`;

function splitParagraph(text: string): Part[] {
  const result: Part[] = [];
  while (text) {
    let end = Math.min(text.length, 2000);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary > 1000) end = boundary;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    const source = text.slice(0, end).trim();
    if (source) result.push({ source, state: 'pending' });
    text = text.slice(end).trimStart();
  }
  return result;
}

/** 原文节点不替换；译文与请求状态只保留在当前页面。 */
export class PageTranslation {
  private units = new Map<HTMLElement, Unit>();
  private visible = false;
  private paused = true;
  private error = '';
  private epoch = 0;
  private inflight = 0;
  private changingPosition = false;
  private timer = 0;
  private canceling: Promise<unknown> | undefined;
  private observer: MutationObserver;

  constructor(private options: Options) {
    this.observer = new MutationObserver(records => {
      const displaced = [...this.units.values()].some(unit => unit.node && !this.isPlaced(unit));
      if (!records.every(isExtensionMutation) || displaced) this.schedule();
    });
    this.observer.observe(document.body, {
      childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'style', 'class'],
    });
  }

  start() {
    this.visible = true;
    this.paused = false;
    this.error = '';
    this.preservePosition(() => this.refresh());
    this.pump();
  }

  toggle() { if (this.visible) this.restore(); else this.start(); }
  togglePause() { if (this.paused) this.resume(); else this.pause(); }

  restore() {
    this.visible = false;
    this.pause();
    this.preservePosition(() => {
      for (const unit of this.units.values()) {
        unit.node?.remove();
        unit.node = undefined;
      }
    });
    this.notify();
  }

  pause() {
    this.paused = true;
    this.epoch++;
    for (const unit of this.units.values()) {
      for (const part of unit.parts) if (part.state === 'loading') part.state = 'pending';
    }
    // 快速继续前先等待上一轮取消完成，避免取消新请求。
    const cancellation = (this.canceling ?? Promise.resolve())
      .then(() => this.options.cancel()).catch(() => undefined);
    this.canceling = cancellation;
    void cancellation.finally(() => {
      if (this.canceling === cancellation) {
        this.canceling = undefined;
        this.pump();
      }
    });
    this.notify();
  }

  resume() {
    for (const unit of this.units.values()) {
      for (const part of unit.parts) if (part.state === 'failed') part.state = 'pending';
    }
    this.start();
  }

  invalidate() {
    this.pause();
    this.preservePosition(() => this.units.forEach(unit => unit.node?.remove()));
    this.units.clear();
    this.error = '连接或学习设置已改变，请点击继续翻译。';
    this.notify();
  }

  dispose() {
    this.restore();
    this.observer.disconnect();
    clearTimeout(this.timer);
  }

  reprioritize() { this.pump(); }

  private schedule() {
    if (!this.visible || this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.refresh();
      this.pump();
    }, 150);
  }

  private refresh() {
    const blocks = extractBlocks(document, 'translation')
      .filter(block => block.kind === 'prose' && /\p{L}/u.test(block.text));
    const live = new Set(blocks.map(block => block.element));
    for (const [element, unit] of this.units) {
      if (!live.has(element) || !matchesSnapshot(unit.block)) {
        this.preservePosition(() => unit.node?.remove());
        this.units.delete(element);
      }
    }
    for (const block of blocks) {
      let unit = this.units.get(block.element);
      if (!unit) {
        unit = { block, parts: splitParagraph(block.text) };
        this.units.set(block.element, unit);
      }
      this.render(unit);
    }
    this.notify();
  }

  private render(unit: Unit) {
    if (!this.visible || !matchesSnapshot(unit.block)) return;
    // 按原文顺序拼接，保留尚未完成的片段位置。
    const translation = unit.parts.map(part => part.translation ?? '').join('\n');
    if (!translation.trim() || (unit.node?.textContent === translation && this.isPlaced(unit))) return;
    this.preservePosition(() => {
      const inline = /^(LI|TD)$/.test(unit.block.element.tagName);
      if (!unit.node) {
        unit.node = document.createElement(inline ? 'span' : 'div');
        unit.node.dataset.easyLearn = 'translation';
        unit.node.className = 'easy-learn-translation';
        unit.node.lang = 'zh-CN';
        unit.node.setAttribute('aria-label', '中文译文');
      }
      if (!this.isPlaced(unit)) {
        if (inline) unit.block.element.append(unit.node);
        else unit.block.element.after(unit.node);
      }
      if (unit.node.textContent !== translation) unit.node.textContent = translation;
    });
  }

  private isPlaced(unit: Unit) {
    if (!unit.node?.isConnected) return false;
    return /^(LI|TD)$/.test(unit.block.element.tagName)
      ? unit.node.parentElement === unit.block.element
      : unit.node.previousElementSibling === unit.block.element;
  }

  private preservePosition(change: () => void) {
    if (this.changingPosition) { change(); return; }
    // 固定首个可见原文段落，并考虑内层滚动容器的裁剪。
    const anchor = [...this.units.keys()].find(candidate => {
      const rect = candidate.getBoundingClientRect();
      let top = 0, bottom = innerHeight;
      for (let parent = candidate.parentElement; parent; parent = parent.parentElement) {
        if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.bottom);
        }
      }
      return rect.bottom > top && rect.top < bottom;
    });
    if (!anchor) { change(); return; }
    let scroller = anchor.parentElement;
    while (scroller) {
      if (scroller.scrollHeight > scroller.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)) break;
      scroller = scroller.parentElement;
    }
    const top = anchor.getBoundingClientRect().top;
    this.changingPosition = true;
    try { change(); } finally { this.changingPosition = false; }
    const delta = anchor.getBoundingClientRect().top - top;
    if (Math.abs(delta) < 1) return;
    if (scroller) scroller.scrollTop += delta;
    else window.scrollBy(0, delta);
  }

  private notify() {
    const units = [...this.units.values()];
    this.options.changed({
      visible: this.visible, paused: this.paused,
      ready: units.filter(unit => unit.parts.every(part => part.state === 'ready')).length,
      total: units.length, error: this.error,
    });
  }

  private pump() {
    if (!this.visible || this.paused || this.canceling) return;
    const ordered = [...this.units.values()].sort((a, b) => {
      const x = a.block.element.getBoundingClientRect(), y = b.block.element.getBoundingClientRect();
      return readingPriority(x.top, x.bottom, innerHeight) - readingPriority(y.top, y.bottom, innerHeight);
    });
    while (this.inflight < this.options.concurrency()) {
      const unit = ordered.find(candidate => matchesSnapshot(candidate.block) && candidate.parts.some(part => part.state === 'pending'));
      const part = unit?.parts.find(part => part.state === 'pending');
      if (!unit || !part) break;
      this.dispatch(unit, part);
    }
    this.notify();
  }

  private dispatch(unit: Unit, part: Part) {
    part.state = 'loading';
    this.inflight++;
    const epoch = this.epoch;
    void this.options.request({
      title: document.title.slice(0, 500), heading: unit.block.heading,
      text: part.source, before: '', after: '',
    }).then(translation => {
      if (epoch !== this.epoch || this.units.get(unit.block.element) !== unit || !matchesSnapshot(unit.block)) return;
      if (!translation.trim()) throw new Error('此段未收到有效译文，请手动继续。');
      part.translation = translation;
      part.state = 'ready';
      this.render(unit);
    }).catch(error => {
      if (epoch !== this.epoch || this.units.get(unit.block.element) !== unit) return;
      part.state = 'failed';
      this.error = error instanceof Error ? error.message : '翻译暂不可用。';
      // 不自动发起付费重试，已完成译文仍可阅读。
      this.pause();
    }).finally(() => {
      this.inflight--;
      this.notify();
      this.pump();
    });
  }
}
