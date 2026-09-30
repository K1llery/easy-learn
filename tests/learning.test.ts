// @vitest-environment node
import { expect, it } from 'vitest';
import { aiRequestSchema } from '../src/core/types';
import { learningDraftSchema, learningMarkdown, saveLearningCard, reviewLearningCard, readLearningCards, findLearningCard, MAX_LEARNING_CARDS, MAX_LEARNING_BYTES } from '../src/core/learning';
const now = Date.UTC(2026, 8, 23);
const draft = () => learningDraftSchema.parse({ id: crypto.randomUUID(), title: 'Recovery', sourceText: 'DR restores service after a regional failure.', goal: '设计一个恢复方案', question: '为什么需要异地副本？', application: '画出两个区域切换服务的流程。', answer: '为了能恢复服务。', feedback: { correct: '提到了恢复服务。', gaps: '需要说明故障范围。', reference: '异地副本在区域故障后仍可用。' } });
it('saves only explicit learning fields and retries without resetting the review date', () => {
  const input = learningDraftSchema.parse({ ...draft(), apiKey: 'do-not-store', context: { before: 'private neighbor' } });
  const first = saveLearningCard([], input, now);
  expect(first.card.dueAt).toBe(now + 86400000);
  expect(JSON.stringify(first.cards)).not.toContain('do-not-store');
  expect(JSON.stringify(first.cards)).not.toContain('private neighbor');
  const retry = saveLearningCard(first.cards, input, now + 5000);
  expect(retry.cards).toHaveLength(1); expect(retry.card).toEqual(first.card);
});
it('spaces successful recalls, caps the interval, and resets after a missed recall', () => {
  let card = saveLearningCard([], draft(), now).card;
  for (const days of [3, 7, 14, 30, 30]) {
    card = reviewLearningCard(card, { id: card.id, revision: card.revision, rating: 'remembered', answer: '区域故障可能让本地所有副本都不可用。' }, now);
    expect(card.dueAt).toBe(now + days * 86400000);
  }
  card = reviewLearningCard(card, { id: card.id, revision: card.revision, rating: 'again', answer: '想不清楚故障范围。' }, now);
  expect(card).toMatchObject({ step: 0, reviewCount: 6, revision: 6, lastAnswer: '想不清楚故障范围。', dueAt: now + 86400000 });
});
it('rejects stale or deleted cards instead of overwriting another panel', () => {
  const card = saveLearningCard([], draft(), now).card;
  expect(() => findLearningCard([card], card.id, 1)).toThrow('另一处更新');
  expect(() => findLearningCard([], card.id, 0)).toThrow('已被删除');
});
it('bounds card count and UTF-8 storage without silently evicting learning records', () => {
  const cards = Array.from({ length: MAX_LEARNING_CARDS }, () => saveLearningCard([], draft(), now).card);
  expect(() => saveLearningCard(cards, draft(), now)).toThrow('50 条');
  const large = cards.slice(0, 42).map(card => ({ ...card, sourceText: '学'.repeat(16000) }));
  expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeGreaterThan(MAX_LEARNING_BYTES);
  expect(() => saveLearningCard(large, draft(), now)).toThrow('容量上限');
  expect(cards).toHaveLength(50);
});
it('exports usable learning evidence and rejects invalid stored records', () => {
  const card = { ...saveLearningCard([], draft(), now).card, actionNote: '画了恢复流程图，下一步验证切换。', lastAnswer: '主区域失效时使用异地副本。' };
  const markdown = learningMarkdown([card]);
  for (const content of [card.sourceText, card.question, card.answer, card.feedback.reference, card.application, card.actionNote, card.lastAnswer]) expect(markdown).toContain(content);
  expect(readLearningCards(undefined)).toEqual([]);
  expect(() => readLearningCards([{ ...card, step: -1 }])).toThrow();
});
it('exports only source-matched evaluation quotes while keeping older cards readable', () => {
  const card = saveLearningCard([], draft(), now).card;
  const quoted = { ...card, feedback: { ...card.feedback, evidence: 'DR restores service after a regional failure.' } };
  expect(learningMarkdown([quoted])).toContain('已在选段中找到，仍需判断是否支持反馈');
  const invented = { ...card, feedback: { ...card.feedback, evidence: 'The source promises zero downtime everywhere.' } };
  expect(learningMarkdown([invented])).not.toContain('The source promises zero downtime everywhere.');
  expect(learningMarkdown([invented])).toContain('无可核对引文');
  expect(readLearningCards([card])).toHaveLength(1);
});
it('requires a question and a nonblank attempt before asking for feedback', () => {
  const request = { operation: 'evaluate', context: { title: '', heading: '', text: 'A paragraph.', before: '', after: '' }, question: 'Why?', answer: '  ' };
  expect(aiRequestSchema.safeParse(request).success).toBe(false);
  expect(aiRequestSchema.safeParse({ ...request, answer: 'My attempt.' }).success).toBe(true);
  expect(aiRequestSchema.safeParse({ ...request, question: undefined, answer: 'My attempt.' }).success).toBe(false);
});
