import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuizRunner } from '../src/ui/quiz-runner';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/ui/rpc', () => ({ rpc }));

const questions = [
  {
    question: 'What keeps a second copy?',
    options: [
      { id: 'A', text: 'Backups' },
      { id: 'B', text: 'Cache' },
      { id: 'C', text: 'Queue' },
      { id: 'D', text: 'Log' },
    ],
    correctOption: 'A',
    explanation: 'The page says backups keep a second copy.',
    evidence: 'Page body text',
  },
  {
    question: 'What does DR stand for?',
    options: [
      { id: 'A', text: 'Daily Run' },
      { id: 'B', text: 'Disaster Recovery' },
      { id: 'C', text: 'Data Rate' },
      { id: 'D', text: 'Drive Redundancy' },
    ],
    correctOption: 'B',
    explanation: 'DR is expanded in the first paragraph.',
  },
];

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => {
  document.body.replaceChildren();
  rpc.mockReset();
  vi.unstubAllGlobals();
});

it('runs a page quiz end to end: request carries count, feedback after answering, score and retry', async () => {
  rpc.mockResolvedValue({ questions });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(QuizRunner, {
        source: { title: 'Doc', text: 'Page body text', count: 2 },
        onClose: () => undefined,
      }),
    );
  });
  expect(rpc).toHaveBeenCalledTimes(1);
  const request = rpc.mock.calls[0][1].request;
  expect(request).toMatchObject({
    operation: 'pageQuiz',
    count: 2,
    context: { title: 'Doc', text: 'Page body text' },
  });
  const radios = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')];
  expect(radios).toHaveLength(4);
  expect(container.querySelector('details')?.open).toBe(false);
  await act(async () => {
    radios[0].click();
  });
  expect(container.querySelector('.elq-result')?.textContent).toContain('答对了');
  expect(container.querySelector('.elq-reference')?.textContent).toContain('Page body text');
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === '下一题')!.click();
  });
  expect(container.querySelector('.elq-question')?.textContent).toContain(
    'What does DR stand for?',
  );
  const second = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')];
  await act(async () => {
    second[0].click();
  });
  expect(container.querySelector('.elq-result')?.textContent).toContain('再看看正确答案');
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === '查看成绩')!.click();
  });
  expect(container.querySelector('.elq-score')?.textContent).toContain('1 / 2');
  expect(container.textContent).toContain('1 题独立答对');
  expect(container.querySelectorAll('.elq-miss')).toHaveLength(1);
  expect(container.querySelector('.elq-miss')?.textContent).toContain('Disaster Recovery');
  await act(async () => {
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('再考一轮'))!
      .click();
  });
  expect(rpc).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it('counts a correct answer after opening the source as open book', async () => {
  rpc.mockResolvedValue({ questions: [questions[0]] });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(QuizRunner, {
        source: { title: 'Doc', text: 'Page body text', count: 1 },
      }),
    ),
  );
  await act(async () => {
    container
      .querySelector('details summary')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLInputElement>('input[type=radio]')!.click());
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === '查看成绩')!.click(),
  );
  expect(container.textContent).toContain('0 题独立答对，1 题查看原文后答对');
  await act(async () => root.unmount());
});

it('surfaces model errors with a manual retry and never invents questions', async () => {
  rpc.mockRejectedValue(new Error('模型服务限流'));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(QuizRunner, { source: { title: 'Doc', text: 'Body', count: 3 } }),
    );
  });
  expect(container.querySelector('[role=alert]')?.textContent).toContain('限流');
  expect(container.querySelector('.elq-question')).toBeNull();
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === '重新出题')!.click();
  });
  expect(rpc).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});
