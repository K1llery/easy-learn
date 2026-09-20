import { z } from 'zod';
export const profileSchema = z.object({ domain: z.string().trim().min(1).max(80), level: z.enum(['入门', '熟悉', '进阶']) });
export const configSchema = z.object({ baseUrl: z.string().max(500), model: z.string().trim().min(1).max(150), apiKey: z.string().trim().min(1).max(2000), profile: profileSchema });
export type Profile = z.infer<typeof profileSchema>;
export type Config = z.infer<typeof configSchema>;
export const defaultProfile: Profile = { domain: '软件开发', level: '入门' };
export const contextSchema = z.object({ title: z.string().max(500), heading: z.string().max(500), text: z.string().min(1).max(16000), before: z.string().max(4000), after: z.string().max(4000), section: z.string().max(24000).optional(), kind: z.enum(['prose', 'command', 'code']).optional() });
export type TextContext = z.infer<typeof contextSchema>;
export const conceptSchema = z.object({ anchor: z.string().min(1).max(500), category: z.enum(['缩写', '术语', '背景', '命令', '代码']), meaning: z.string().min(1).max(300), expansion: z.string().max(300), evidence: z.string().max(1500), ambiguity: z.string().max(1500), summary: z.string().max(1200).default(''), id:z.string().max(20).optional(), parts: z.array(z.object({ text: z.string().min(1).max(300), explanation: z.string().min(1).max(600) })).max(16).default([]) });
export type Concept = z.input<typeof conceptSchema>;
export const analyzeSchema = z.object({ concepts: z.array(conceptSchema.extend({ summary: z.string().min(1).max(1200), expansion:z.string().max(300).default(''), evidence:z.string().max(1500).default(''), ambiguity:z.string().max(1500).default('') })).max(12) });
export const explainSchema = z.object({ meaning: z.string().max(2000), expansion: z.string().max(500), evidence: z.string().max(2000), ambiguity: z.string().max(2000), explanation: z.string().min(1).max(6000), example: z.string().max(2000), prerequisites: z.array(z.object({ term: z.string().max(200), explanation: z.string().max(2000) })).max(5), translation: z.string().max(10000) });
export type Explanation = z.infer<typeof explainSchema>;
export const quizSchema = z.object({ question: z.string().min(1).max(2000) });
export const evaluationSchema = z.object({ correct: z.string().max(3000), gaps: z.string().max(3000), reference: z.string().max(4000) });
export type Evaluation = z.infer<typeof evaluationSchema>;
export const candidateSchema = z.object({ id:z.string().regex(/^c\d+$/).max(20), anchor:z.string().min(1).max(300), kind:z.enum(['term','abbreviation','command','code']), heading:z.string().max(120), context:z.string().max(420) });
export type Candidate = z.infer<typeof candidateSchema>;
export const aiRequestSchema = z.object({ operation: z.enum(['analyze', 'explain', 'quiz', 'evaluate']), candidates:z.array(candidateSchema).min(1).max(8).optional(), context: contextSchema, concept: conceptSchema.optional(), mode: z.enum(['explain', 'translate', 'followup']).optional(), question: z.string().max(2000).optional(), answer: z.string().max(5000).optional(), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(10000) })).max(8).optional() });
export type AIRequest = z.input<typeof aiRequestSchema>;
export type Mastered = { key: string; domain: string; meaning: string; anchor: string; createdAt: number };
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export function conceptKey(domain: string, meaning: string) { return JSON.stringify([domain.trim().toLocaleLowerCase(), meaning.trim().toLocaleLowerCase()]); }
export function endpoint(baseUrl: string) {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('模型地址无效，请填写完整的 HTTPS Base URL。'); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('请使用 HTTPS 地址，或本机 localhost / 127.0.0.1 的 HTTP 地址；地址不能包含密钥、查询参数或片段。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions';
  return url;
}
