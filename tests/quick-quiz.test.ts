import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuickQuiz } from '../src/ui/quick-quiz';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/ui/rpc', () => ({ rpc }));

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => {
  document.body.replaceChildren();
  rpc.mockReset();
  vi.unstubAllGlobals();
});

it('shows the actual option IDs when a model returns options out of order', async () => {
  rpc.mockResolvedValue({
    question: 'Which answer is supported?',
    options: [
      { id: 'B', text: 'Second' },
      { id: 'A', text: 'First' },
      { id: 'D', text: 'Fourth' },
      { id: 'C', text: 'Third' },
    ],
    correctOption: 'B',
    explanation: 'The source supports B.',
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(QuickQuiz, {
        context: { title: '', heading: '', text: 'The source supports B.', before: '', after: '' },
        active: true,
      }),
    );
  });
  const labels = [...container.querySelectorAll<HTMLLabelElement>('.quiz-option')];
  expect(
    labels.map((label) => ({
      value: label.querySelector('input')?.value,
      shown: label.querySelector('.quiz-letter')?.textContent,
    })),
  ).toEqual([
    { value: 'B', shown: 'B' },
    { value: 'A', shown: 'A' },
    { value: 'D', shown: 'D' },
    { value: 'C', shown: 'C' },
  ]);
  await act(async () => root.unmount());
});
