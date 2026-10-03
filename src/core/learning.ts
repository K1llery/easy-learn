import { z } from 'zod';
import { evaluationSchema, quizSchema } from './types';
import { findSourceEvidence } from './source-evidence';

export const LEARNING_KEY = 'learningCardsV1';
export const MAX_LEARNING_CARDS = 50;
export const MAX_LEARNING_BYTES = 2_000_000;
export const REVIEW_DAYS = [1, 3, 7, 14, 30] as const;
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const learningDraftSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  sourceText: z.string().trim().min(1).max(16000),
  goal: z.string().trim().max(300),
  question: quizSchema.shape.question,
  application: quizSchema.shape.application,
  answer: z.string().trim().min(1).max(5000),
  feedback: evaluationSchema,
});
export const learningCardSchema = learningDraftSchema.extend({
  createdAt: timestamp,
  dueAt: timestamp,
  step: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_DAYS.length - 1),
  reviewCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  lastReviewedAt: timestamp.nullable(),
  lastAnswer: z.string().max(5000),
  actionNote: z.string().max(3000),
  actionRecordedAt: timestamp.nullable(),
});
export type LearningDraft = z.infer<typeof learningDraftSchema>;
export type LearningCard = z.infer<typeof learningCardSchema>;
export const learningIdSchema = z.string().uuid();
export const reviewInputSchema = z.object({
  id: learningIdSchema,
  revision: z.number().int().nonnegative(),
  rating: z.enum(['again', 'remembered']),
  answer: z.string().trim().min(1).max(5000),
});
export const actionInputSchema = z.object({
  id: learningIdSchema,
  revision: z.number().int().nonnegative(),
  note: z.string().trim().max(3000),
});
export function readLearningCards(value: unknown): LearningCard[] {
  return value === undefined
    ? []
    : z.array(learningCardSchema).max(MAX_LEARNING_CARDS).parse(value);
}
export function saveLearningCard(cards: LearningCard[], draft: LearningDraft, now = Date.now()) {
  const existing = cards.find((card) => card.id === draft.id);
  if (existing) return { cards, card: existing }; // Retrying a save never duplicates or resets progress.
  if (cards.length >= MAX_LEARNING_CARDS)
    throw new Error('已保存 50 条练习。请先导出或删除不再需要的记录。');
  const card: LearningCard = {
    ...draft,
    createdAt: now,
    dueAt: now + 86400000,
    step: 0,
    reviewCount: 0,
    revision: 0,
    lastReviewedAt: null,
    lastAnswer: '',
    actionNote: '',
    actionRecordedAt: null,
  };
  const next = [...cards, card];
  assertLearningCapacity(next);
  return { cards: next, card };
}
export function assertLearningCapacity(cards: LearningCard[]) {
  if (new TextEncoder().encode(JSON.stringify(cards)).byteLength > MAX_LEARNING_BYTES)
    throw new Error('学习记录已达到本机容量上限。请先导出并删除部分记录。');
}
export function findLearningCard(cards: LearningCard[], id: string, revision: number) {
  const card = cards.find((item) => item.id === id);
  if (!card) throw new Error('这条练习已被删除，请返回复习列表。');
  if (card.revision !== revision) throw new Error('这条记录已在另一处更新，请返回列表后重新打开。');
  return card;
}
export function reviewLearningCard(
  card: LearningCard,
  input: z.infer<typeof reviewInputSchema>,
  now = Date.now(),
): LearningCard {
  const step = input.rating === 'again' ? 0 : Math.min(card.step + 1, REVIEW_DAYS.length - 1);
  return {
    ...card,
    step,
    dueAt: now + REVIEW_DAYS[step] * 86400000,
    reviewCount: card.reviewCount + 1,
    revision: card.revision + 1,
    lastReviewedAt: now,
    lastAnswer: input.answer,
  };
}
export function learningMarkdown(cards: LearningCard[]) {
  return [
    '# Easy Learn · 我的学习记录',
    '复习次数与间隔来自自评，不代表已经掌握。AI 反馈需结合原文核对。',
    ...cards.map((card) => {
      const evidence = findSourceEvidence(card.sourceText, card.feedback.evidence);
      return [
        `## ${card.title}`,
        `目标：${card.goal || '用自己的话解释，并尝试应用'}`,
        `### 原文选段\n${card.sourceText}`,
        `### 回忆问题\n${card.question}`,
        `### 第一次回答\n${card.answer}`,
        `### AI 反馈\n理解正确的部分：${card.feedback.correct}\n\n待补充：${card.feedback.gaps}\n\n参考解释：${card.feedback.reference}\n\n原文依据：${evidence ? `${evidence.text}（已在选段中找到，仍需判断是否支持反馈）` : '无可核对引文，请自行对照原文'}`,
        `### 应用任务\n${card.application}`,
        `### 实践记录\n${card.actionNote || '尚未记录'}`,
        `### 最近一次回忆\n${card.lastAnswer || '尚未复习'}`,
        `已复习 ${card.reviewCount} 次 · 下次复习：${new Date(card.dueAt).toLocaleDateString('zh-CN')}`,
      ].join('\n\n');
    }),
  ].join('\n\n');
}
