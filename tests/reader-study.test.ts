import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReaderStudy } from '../src/ui/reader-study';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/ui/rpc', () => ({ rpc }));
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => {
  rpc.mockReset();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([
  ['A backup keeps a second copy.', true],
  ['Replication eliminates every failure.', false],
  ['', false],
])('only presents source-verifiable quotes as evidence: %s', async (evidence, valid) => {
  rpc.mockResolvedValue({
    meaning: '备份',
    explanation: '结合原文的解释。',
    evidence,
    prerequisites: [],
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(ReaderStudy, {
        context: {
          title: 'Doc',
          heading: '',
          text: 'A backup keeps a second copy.',
          before: '',
          after: '',
        },
        mode: 'explain',
        onClose: () => undefined,
      }),
    ),
  );
  expect(!!container.querySelector('blockquote')).toBe(valid);
  expect(container.textContent).toContain(valid ? '已在选段中找到引文' : '没有可核对的原文引文');
  if (!valid && evidence) expect(container.textContent).not.toContain(evidence);
  expect(rpc).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
