import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QuizRunner, type QuizSource } from '../ui/quiz-runner';

// Full-page quiz overlay mounted inside the reader's shadow root. React renders
// into a detached card so the page stylesheet can never reach it.
export function openQuizOverlay(shadow: ShadowRoot, source: () => QuizSource) {
  const layer = document.createElement('div');
  layer.dataset.easyLearn = '';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', '整页测验');
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;background:#00000080;backdrop-filter:blur(2px);pointer-events:auto';
  const card = document.createElement('div');
  card.style.cssText = 'width:min(560px,calc(100vw - 32px));max-height:min(80vh,660px);overflow:auto;border-radius:18px';
  layer.append(card);
  let root: Root | undefined;
  const close = () => { root?.unmount(); root = undefined; layer.remove(); };
  layer.addEventListener('mousedown', event => { if (event.target === layer) close(); });
  try {
    root = createRoot(card);
    root.render(createElement(QuizRunner, { source: source(), onClose: close }));
  } catch (error) {
    console.error('Easy Learn quiz overlay failed:', error);
    layer.remove();
    return undefined;
  }
  shadow.append(layer);
  return close;
}
