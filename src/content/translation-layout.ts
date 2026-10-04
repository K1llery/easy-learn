import type { Block } from './document';

export type TranslationLayout = 'after' | 'inside' | 'fragment' | 'tooltip';

function horizontalFlex(style: CSSStyleDeclaration) {
  return /flex/.test(style.display) && !style.flexDirection.startsWith('column');
}

/** 导航与紧凑控件不增加布局项；正文译文留在原有 Flex/Grid 单元内。 */
export function translationLayout(block: Block): TranslationLayout {
  const element = block.element;
  const style = getComputedStyle(element);
  if (element.closest('nav,[role="navigation"],[role="toolbar"],button,summary,[role="button"]'))
    return 'tooltip';
  const control = element.closest('a');
  if (
    control &&
    (control === element || (element.parentElement === control && element.tagName === 'SPAN')) &&
    horizontalFlex(getComputedStyle(control))
  )
    return 'tooltip';
  if (block.afterNode)
    return horizontalFlex(style) || /grid/.test(style.display) ? 'tooltip' : 'fragment';
  const parent = element.parentElement;
  const parentStyle = parent ? getComputedStyle(parent) : undefined;
  const inside =
    /^(LI|TD|TH|A)$/.test(element.tagName) ||
    (!!parentStyle && (horizontalFlex(parentStyle) || /grid/.test(parentStyle.display)));
  if (!inside) return 'after';
  // 不向单行省略或行数截断的标签内部追加看不见的正文。
  if (
    /hidden|clip/.test(style.overflowX + style.overflowY) &&
    (style.whiteSpace === 'nowrap' || Number(style.getPropertyValue('-webkit-line-clamp')) > 0)
  )
    return 'tooltip';
  return 'inside';
}

export function translationWhiteSpace(element: HTMLElement) {
  const whitespace = getComputedStyle(element).whiteSpace;
  return /^(pre|pre-wrap|pre-line|break-spaces)$/.test(whitespace) ? whitespace : 'normal';
}
