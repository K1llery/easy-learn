import {
  extractBlocks,
  isExtensionMutation,
  matchesSnapshot,
  readableTextNodes,
  type Block,
} from './document';
import { readingPriority } from './reading-order';
import type { TextContext } from '../core/types';
import {
  applyTextStyle,
  formattedTranslation,
  textStyle,
  translatedRuns,
  translationParts,
  type TranslationPart,
} from './translation-format';

type Unit = {
  block: Block;
  parts: TranslationPart[];
  sourceNodes: { node: Text; parent: Element | null }[];
  sourceBreaks: Element[];
  node?: HTMLElement;
  rendered?: string;
};
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
export const translationStyle = `.easy-learn-translation{display:block!important;margin:8px 0 15px;padding:0 0 0 12px;border-left:2px solid #0071e344;white-space:pre-wrap!important;overflow-wrap:anywhere!important}.easy-learn-translation[hidden]{display:none!important}.easy-learn-translation span{display:inline!important;margin:0!important;padding:0!important;border:0!important;float:none!important;position:static!important}`;

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
  private onResize = () => this.schedule();

  constructor(private options: Options) {
    this.observer = new MutationObserver((records) => {
      const displaced = [...this.units.values()].some((unit) => unit.node && !this.isPlaced(unit));
      if (!records.every(isExtensionMutation) || displaced) this.schedule();
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'style', 'class'],
    });
    window.addEventListener('resize', this.onResize);
  }

  start() {
    this.visible = true;
    this.paused = false;
    this.error = '';
    this.preservePosition(() => this.refresh());
    this.pump();
  }

  toggle() {
    if (this.visible) this.restore();
    else this.start();
  }
  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }

  restore() {
    this.visible = false;
    this.pause();
    this.preservePosition(() => {
      for (const unit of this.units.values()) {
        unit.node?.remove();
        unit.node = undefined;
        unit.rendered = undefined;
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
      .then(() => this.options.cancel())
      .catch(() => undefined);
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
    this.preservePosition(() => this.units.forEach((unit) => unit.node?.remove()));
    this.units.clear();
    this.error = '连接或学习设置已改变，请点击继续翻译。';
    this.notify();
  }

  dispose() {
    this.restore();
    this.observer.disconnect();
    window.removeEventListener('resize', this.onResize);
    clearTimeout(this.timer);
  }

  reprioritize() {
    this.pump();
  }

  private schedule() {
    if (!this.visible || this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.refresh();
      this.pump();
    }, 150);
  }

  private refresh() {
    const blocks = extractBlocks(document, 'translation').filter(
      (block) => block.kind === 'prose' && /\p{L}/u.test(block.text),
    );
    const live = new Set(blocks.map((block) => block.element));
    for (const [element, unit] of this.units) {
      if (!live.has(element) || !this.matchesUnit(unit)) {
        this.preservePosition(() => unit.node?.remove());
        this.units.delete(element);
      }
    }
    for (const block of blocks) {
      let unit = this.units.get(block.element);
      if (!unit) {
        unit = {
          block,
          parts: translationParts(block),
          sourceNodes: readableTextNodes(block.element).map((node) => ({
            node,
            parent: node.parentElement,
          })),
          sourceBreaks: this.sourceBreaks(block.element),
        };
        this.units.set(block.element, unit);
      }
      this.render(unit);
    }
    this.notify();
  }

  private render(unit: Unit) {
    if (!this.visible || !this.matchesUnit(unit)) return;
    // 按原文顺序拼接，保留尚未完成的片段位置。
    if (!unit.parts.some((part) => part.translation?.trim())) return;
    const inline = /^(LI|TD)$/.test(unit.block.element.tagName);
    const style = textStyle(unit.block.element);
    // 列表/单元格内的译文已经处于原文背景和透明度之下，避免叠加两次。
    if (inline) {
      style.opacity = '1';
      style['background-color'] = 'transparent';
    }
    const formatted = unit.parts.map((part) =>
      part.translation ? formattedTranslation(part, unit.block.element) : undefined,
    );
    const signature = JSON.stringify([
      style,
      formatted.map((part) =>
        part?.pieces.map((piece) => [piece.text, piece.run?.breakBefore, piece.style]),
      ),
    ]);
    if (unit.node && unit.rendered === signature && this.isPlaced(unit)) return;
    this.preservePosition(() => {
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
      applyTextStyle(unit.node, style);
      if (unit.rendered !== signature) {
        const content = document.createDocumentFragment();
        for (const part of formatted) {
          if (!part) continue;
          if (!part.valid)
            this.error = '部分译文未保留格式标记，已显示完整文字；可还原原文查看强调内容。';
          for (const piece of part.pieces) {
            for (let i = 0; i < (piece.run?.breakBefore ?? 0); i++)
              content.append(document.createElement('br'));
            if (piece.style) {
              const span = document.createElement('span');
              applyTextStyle(span, piece.style);
              span.textContent = piece.text;
              content.append(span);
            } else content.append(document.createTextNode(piece.text));
          }
        }
        unit.node.replaceChildren(content);
        unit.rendered = signature;
      }
    });
  }

  private isPlaced(unit: Unit) {
    if (!unit.node?.isConnected) return false;
    return /^(LI|TD)$/.test(unit.block.element.tagName)
      ? unit.node.parentElement === unit.block.element
      : unit.node.previousElementSibling === unit.block.element;
  }

  private matchesUnit(unit: Unit) {
    if (!matchesSnapshot(unit.block)) return false;
    const nodes = readableTextNodes(unit.block.element);
    const breaks = this.sourceBreaks(unit.block.element);
    return (
      breaks.length === unit.sourceBreaks.length &&
      breaks.every((node, index) => node === unit.sourceBreaks[index]) &&
      nodes.length === unit.sourceNodes.length &&
      nodes.every(
        (node, index) =>
          node === unit.sourceNodes[index].node &&
          node.parentElement === unit.sourceNodes[index].parent,
      )
    );
  }

  private sourceBreaks(element: HTMLElement) {
    return [...element.querySelectorAll('br')].filter((node) => !node.closest('[data-easy-learn]'));
  }

  private preservePosition(change: () => void) {
    if (this.changingPosition) {
      change();
      return;
    }
    // 固定首个可见原文段落，并考虑内层滚动容器的裁剪。
    const anchor = [...this.units.keys()].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      let top = 0,
        bottom = innerHeight;
      for (let parent = candidate.parentElement; parent; parent = parent.parentElement) {
        if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.bottom);
        }
      }
      return rect.bottom > top && rect.top < bottom;
    });
    if (!anchor) {
      change();
      return;
    }
    let scroller = anchor.parentElement;
    while (scroller) {
      if (
        scroller.scrollHeight > scroller.clientHeight &&
        /^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)
      )
        break;
      scroller = scroller.parentElement;
    }
    const top = anchor.getBoundingClientRect().top;
    this.changingPosition = true;
    try {
      change();
    } finally {
      this.changingPosition = false;
    }
    const delta = anchor.getBoundingClientRect().top - top;
    if (Math.abs(delta) < 1) return;
    if (scroller) scroller.scrollTop += delta;
    else window.scrollBy(0, delta);
  }

  private notify() {
    const units = [...this.units.values()];
    this.options.changed({
      visible: this.visible,
      paused: this.paused,
      ready: units.filter((unit) => unit.parts.every((part) => part.state === 'ready')).length,
      total: units.length,
      error: this.error,
    });
  }

  private pump() {
    if (!this.visible || this.paused || this.canceling) return;
    const ordered = [...this.units.values()].sort((a, b) => {
      const x = a.block.element.getBoundingClientRect(),
        y = b.block.element.getBoundingClientRect();
      return (
        readingPriority(x.top, x.bottom, innerHeight) -
        readingPriority(y.top, y.bottom, innerHeight)
      );
    });
    while (this.inflight < this.options.concurrency()) {
      const unit = ordered.find(
        (candidate) =>
          this.matchesUnit(candidate) && candidate.parts.some((part) => part.state === 'pending'),
      );
      const part = unit?.parts.find((part) => part.state === 'pending');
      if (!unit || !part) break;
      this.dispatch(unit, part);
    }
    this.notify();
  }

  private dispatch(unit: Unit, part: TranslationPart) {
    part.state = 'loading';
    this.inflight++;
    const epoch = this.epoch;
    void this.options
      .request({
        title: document.title.slice(0, 500),
        heading: unit.block.heading,
        text: part.source,
        before: '',
        after: '',
        ...(part.marker ? { translationMarker: part.marker } : {}),
      })
      .then((translation) => {
        if (
          epoch !== this.epoch ||
          this.units.get(unit.block.element) !== unit ||
          !this.matchesUnit(unit)
        )
          return;
        if (!translatedRuns({ ...part, translation }).pieces.some((piece) => piece.text.trim()))
          throw new Error('此段未收到有效译文，请手动继续。');
        part.translation = translation;
        part.state = 'ready';
        this.render(unit);
      })
      .catch((error) => {
        if (epoch !== this.epoch || this.units.get(unit.block.element) !== unit) return;
        part.state = 'failed';
        this.error = error instanceof Error ? error.message : '翻译暂不可用。';
        // 不自动发起付费重试，已完成译文仍可阅读。
        this.pause();
      })
      .finally(() => {
        this.inflight--;
        this.notify();
        this.pump();
      });
  }
}
