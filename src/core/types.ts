import { maxConcurrency } from './reading-defaults';
import { z } from 'zod';
import { translationLanguageSchema } from './translation-languages';
export const profileSchema = z.object({
  domain: z.string().trim().min(1).max(80),
  level: z.enum(['入门', '熟悉', '进阶']),
});
export const apiKinds = ['openai', 'anthropic', 'codex', 'claude-oauth'] as const;
export type ApiKind = (typeof apiKinds)[number];
export const oauthApiKinds: ApiKind[] = ['codex', 'claude-oauth'];
export const explanationStyles = ['concise', 'balanced', 'deep'] as const;
export type ExplanationStyle = (typeof explanationStyles)[number];
export const reasoningEfforts = [
  'auto',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const modelTuningSchema = z.object({
  thinking: z.enum(['auto', 'disabled', 'enabled']).optional(),
  reasoningEffort: z.enum(reasoningEfforts).optional(),
  fast: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(256).max(32768).optional(),
});
export type ModelTuning = z.infer<typeof modelTuningSchema>;
export const configSchema = z
  .object({
    baseUrl: z.string().max(500),
    model: z.string().trim().min(1).max(150),
    apiKey: z.string().trim().max(2000).default(''),
    profile: profileSchema,
    api: z.enum(apiKinds).optional(),
    style: z.enum(explanationStyles).optional(),
    tuning: modelTuningSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const api = value.api ?? 'openai';
    if (!oauthApiKinds.includes(api) && !value.apiKey)
      ctx.addIssue({ code: 'custom', message: '请填写 API Key，或改用订阅账户登录。' });
  });
export const readingPrefsSchema = z.object({
  translationTargetLanguage: translationLanguageSchema.optional(),
  vocabularyBaseline: z.union([z.literal(2000), z.literal(5000), z.literal(10000)]).optional(),
  vocabularyPerBlock: z.number().int().min(1).max(6).optional(),
  concurrency: z.number().int().min(1).max(maxConcurrency).optional(),
  quizCount: z.number().int().min(2).max(8).optional(),
  maxPerBlock: z.union([z.literal(2), z.literal(4), z.literal(6)]).optional(),
  batchSize: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)]).optional(),
});
export type ReadingPrefs = z.infer<typeof readingPrefsSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Config = z.infer<typeof configSchema>;
export const defaultProfile: Profile = { domain: '软件开发', level: '入门' };
export const annotationTypeValues = ['abbreviation', 'term', 'command', 'vocabulary'] as const;
export type AnnotationType = (typeof annotationTypeValues)[number];
export const defaultAnnotationTypes: AnnotationType[] = ['abbreviation', 'term', 'command'];
export function normalizeAnnotationTypes(value: unknown): AnnotationType[] {
  if (!Array.isArray(value)) return [...defaultAnnotationTypes];
  return [
    ...new Set(
      value.filter(
        (item): item is AnnotationType =>
          typeof item === 'string' && annotationTypeValues.includes(item as AnnotationType),
      ),
    ),
  ];
}
export const contextSchema = z.object({
  title: z.string().max(500),
  heading: z.string().max(500),
  text: z.string().min(1).max(16000),
  before: z.string().max(4000),
  after: z.string().max(4000),
  section: z.string().max(24000).optional(),
  kind: z.enum(['prose', 'command', 'code']).optional(),
  translationMarker: z
    .string()
    .regex(/^EL\d*$/)
    .max(32)
    .optional(),
});
export type TextContext = z.infer<typeof contextSchema>;
export const conceptSchema = z.object({
  anchor: z.string().min(1).max(500),
  category: z.enum(['缩写', '术语', '词汇', '背景', '命令', '代码']),
  meaning: z.string().min(1).max(300),
  expansion: z.string().max(300),
  evidence: z.string().max(1500),
  ambiguity: z.string().max(1500),
  summary: z.string().max(1200).default(''),
  id: z.string().max(20).optional(),
  parts: z
    .array(z.object({ text: z.string().min(1).max(300), explanation: z.string().min(1).max(600) }))
    .max(16)
    .default([]),
});
export type Concept = z.input<typeof conceptSchema>;
export const analyzeSchema = z.object({
  concepts: z
    .array(
      conceptSchema.extend({
        summary: z.string().min(1).max(1200),
        expansion: z.string().max(300).default(''),
        evidence: z.string().max(1500).default(''),
        ambiguity: z.string().max(1500).default(''),
      }),
    )
    .max(12),
});
export const explainSchema = z.object({
  meaning: z.string().max(2000),
  expansion: z.string().max(500),
  evidence: z.string().max(2000),
  ambiguity: z.string().max(2000),
  explanation: z.string().min(1).max(6000),
  example: z.string().max(2000),
  prerequisites: z
    .array(z.object({ term: z.string().max(200), explanation: z.string().max(2000) }))
    .max(5),
  translation: z.string().max(10000),
});
export type Explanation = z.infer<typeof explainSchema>;
export const quizSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  application: z.string().trim().min(1).max(2000),
});
export const choiceQuizSchema = z
  .object({
    question: z.string().trim().min(1).max(1200),
    options: z
      .array(
        z.object({ id: z.enum(['A', 'B', 'C', 'D']), text: z.string().trim().min(1).max(500) }),
      )
      .length(4),
    correctOption: z.enum(['A', 'B', 'C', 'D']),
    explanation: z.string().trim().min(1).max(1500),
    evidence: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.options.map((option) => option.id)).size !== 4)
      ctx.addIssue({ code: 'custom', message: '选项编号必须包含 A、B、C、D 且不重复。' });
  });
export type ChoiceQuiz = z.infer<typeof choiceQuizSchema>;
export const pageQuizSchema = z.object({ questions: z.array(choiceQuizSchema).min(1).max(8) });
export type PageQuiz = z.infer<typeof pageQuizSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export const evaluationSchema = z.object({
  correct: z.string().trim().min(1).max(3000),
  gaps: z.string().trim().min(1).max(3000),
  reference: z.string().trim().min(1).max(4000),
  evidence: z.string().trim().max(500).optional(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export const candidateSchema = z.object({
  id: z
    .string()
    .regex(/^c\d+$/)
    .max(20),
  anchor: z.string().min(1).max(300),
  kind: z.enum(['term', 'abbreviation', 'command', 'code', 'vocabulary']),
  heading: z.string().max(120),
  context: z.string().max(420),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const aiRequestSchema = z
  .object({
    operation: z.enum(['analyze', 'explain', 'quiz', 'choice', 'evaluate', 'pageQuiz']),
    count: z.number().int().min(1).max(8).optional(),
    candidates: z.array(candidateSchema).min(1).max(8).optional(),
    context: contextSchema,
    concept: conceptSchema.optional(),
    mode: z.enum(['explain', 'translate', 'followup']).optional(),
    targetLanguage: translationLanguageSchema.optional(),
    goal: z.string().trim().max(300).optional(),
    question: z.string().max(2000).optional(),
    answer: z.string().max(5000).optional(),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(10000) }))
      .max(8)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetLanguage && (value.operation !== 'explain' || value.mode !== 'translate'))
      ctx.addIssue({ code: 'custom', message: '译文语言仅用于翻译任务。' });
    if (value.operation === 'evaluate' && (!value.question?.trim() || !value.answer?.trim()))
      ctx.addIssue({ code: 'custom', message: '请先写下自己的回答。' });
    if (value.candidates && value.operation !== 'analyze')
      ctx.addIssue({ code: 'custom', message: '候选词仅用于注释分析。' });
    if (value.operation === 'pageQuiz' && !value.count)
      ctx.addIssue({ code: 'custom', message: '整页测验需要指定题目数量。' });
  });
export type AIRequest = z.input<typeof aiRequestSchema>;
export type Mastered = {
  key: string;
  domain: string;
  meaning: string;
  anchor: string;
  createdAt: number;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export function conceptKey(domain: string, meaning: string) {
  return JSON.stringify([domain.trim().toLocaleLowerCase(), meaning.trim().toLocaleLowerCase()]);
}
export function endpoint(baseUrl: string) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('模型地址无效，请填写完整的 HTTPS Base URL。');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
  )
    throw new Error(
      '请使用 HTTPS 地址，或本机 localhost / 127.0.0.1 的 HTTP 地址；地址不能包含密钥、查询参数或片段。',
    );
  url.pathname =
    url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions';
  return url;
}
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export function apiKindOf(config: Pick<Config, 'api'>): ApiKind {
  return config.api ?? 'openai';
}
// Builds the concrete request URL for the configured protocol kind.
export function requestTarget(baseUrl: string, api: ApiKind): URL {
  if (api === 'codex') return new URL(CODEX_RESPONSES_URL);
  if (api === 'anthropic' || api === 'claude-oauth') {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('模型地址无效，请填写完整的 HTTPS Base URL。');
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('请使用 HTTPS 地址，或本机 localhost / 127.0.0.1 的 HTTP 地址。');
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/messages';
    url.search = '';
    url.hash = '';
    return url;
  }
  return endpoint(baseUrl);
}
