import { translationLanguages } from '../src/core/translation-languages';
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { callModel } from '../src/core/ai';
import { parseModelOutput } from '../src/core/model-output';
import type { AIRequest, Config } from '../src/core/types';
const config: Config = {
  baseUrl: 'https://example.test/v1',
  model: 'test',
  apiKey: 'never-log-me',
  profile: { domain: '软件开发', level: '入门' },
};
const request: AIRequest = {
  operation: 'analyze',
  context: {
    title: 'Doc',
    heading: '',
    text: 'unused long paragraph',
    before: 'unused',
    after: '',
  },
  candidates: [
    {
      id: 'c0',
      anchor: 'DR',
      kind: 'abbreviation',
      heading: 'Recovery',
      context: 'DR restores service after a regional failure.',
    },
    {
      id: 'c1',
      anchor: 'API',
      kind: 'abbreviation',
      heading: 'Interfaces',
      context: 'API connects services.',
    },
  ],
};
const response = (content: unknown, other: object = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], ...other }), { status: 200 });
it('sends only compact local candidates and consumes one provider response', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      response(
        '{"items":[{"id":"c0","summary":"灾难后的恢复流程"},{"id":"c1","summary":"程序间接口"}]}',
        { usage: { total_tokens: 123 } },
      ),
    );
  const result = await callModel(config, request);
  expect(result).toMatchObject({ __usage: 123, concepts: [{ anchor: 'DR' }, { anchor: 'API' }] });
  const input = JSON.parse(
    JSON.parse(fetcher.mock.calls[0][1]!.body as string).messages[1].content,
  );
  expect(input.context).toBeUndefined();
  expect(input.candidates).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({ Authorization: 'Bearer never-log-me' });
});
it('authenticates a Cline non-streaming request and reads its successful data envelope', async () => {
  const cline: Config = {
    ...config,
    baseUrl: 'https://api.cline.bot/api/v1',
    model: 'cline-pass/deepseek-v4.1-flash',
  };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          choices: [
            { message: { content: '{"translation":"接口测试成功"}' }, finish_reason: 'stop' },
          ],
          usage: { total_tokens: 69 },
        },
      }),
    ),
  );
  const result = await callModel(cline, {
    operation: 'explain',
    mode: 'translate',
    context: request.context,
  });
  expect(result).toMatchObject({ translation: '接口测试成功', __usage: 69 });
  expect(String(fetcher.mock.calls[0][0])).toBe('https://api.cline.bot/api/v1/chat/completions');
  expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({
    Authorization: 'Bearer never-log-me',
    'Content-Type': 'application/json',
  });
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
    model: 'cline-pass/deepseek-v4.1-flash',
    stream: false,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps explicit gateway failures out of model output without exposing diagnostics or retrying', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        success: false,
        error: 'never-log-me',
        data: { choices: [{ message: { content: '{"translation":"must not use"}' } }] },
      }),
    ),
  );
  await expect(
    callModel(config, { operation: 'explain', context: request.context }),
  ).rejects.toThrow('模型服务报告请求失败');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retains the length-limit diagnosis for wrapped completions without a repair request', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          choices: [{ message: { content: '{"question":"truncated' }, finish_reason: 'length' }],
        },
      }),
    ),
  );
  await expect(callModel(config, { operation: 'quiz', context: request.context })).rejects.toThrow(
    '响应被长度限制截断',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('uses the Qwen workspace output-limit and no-thinking fields', async () => {
  const qwenConfig: Config = {
    ...config,
    baseUrl: 'https://llm-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
  };
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response('这是一个自然语言解释。'));
  await callModel(qwenConfig, { operation: 'explain', context: request.context });
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ enable_thinking: false, max_completion_tokens: 3000 });
  expect(body).not.toHaveProperty('max_tokens');
});
it('uses GPT-6 Luna without reasoning for compact translations and low effort otherwise', async () => {
  const cpa: Config = { ...config, baseUrl: 'http://127.0.0.1:8317/v1', model: 'gpt-6-luna' };
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response('{"translation":"缓存保持有效，除非上游架构发生变化。"}'));
  const translated = await callModel(cpa, {
    operation: 'explain',
    mode: 'translate',
    context: {
      ...request.context,
      text: 'The cache remains valid unless the upstream schema changes.',
    },
  });
  expect(translated).toMatchObject({ translation: '缓存保持有效，除非上游架构发生变化。' });
  const translateBody = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(translateBody).toMatchObject({
    model: 'gpt-6-luna',
    reasoning_effort: 'none',
    temperature: 0.2,
  });
  expect(translateBody.messages[0].content).toContain('{"translation":"完整中文译文"}');
  expect(translateBody.messages[0].content).not.toContain('"prerequisites"');
  fetcher.mockResolvedValue(response('{"explanation":"这是一个解释。"}'));
  await callModel(cpa, { operation: 'explain', mode: 'explain', context: request.context });
  const explainBody = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
  expect(explainBody.reasoning_effort).toBe('low');
  expect(explainBody).not.toHaveProperty('temperature');
});

it('serializes inline format markers and instructs only marked translations to preserve them', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => response('{"translation":"⟦EL:0⟧重要⟦/EL:0⟧"}'));
  const context = { ...request.context, text: '⟦EL:0⟧Important⟦/EL:0⟧', translationMarker: 'EL' };
  await callModel(config, { operation: 'explain', mode: 'translate', context });
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(JSON.parse(body.messages[1].content).context).toEqual(context);
  expect(body.messages[0].content).toContain('每对标记必须原样保留一次');
  expect(body.messages[0].content).toContain('不得嵌套、删除、新增或改写标记');
  await callModel(config, { operation: 'explain', mode: 'translate', context: request.context });
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).messages[0].content).not.toContain(
    '行内格式标记',
  );
});
it('never makes a paid automatic repair request on unusable output', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => response('无法对应两个候选的自由文本'));
  await expect(callModel(config, request)).rejects.toThrow('未自动重试');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  [401, '认证'],
  [403, '授权'],
  [429, '限流'],
  [404, '接口不存在'],
  [500, 'HTTP 500'],
])('maps HTTP %s without revealing provider diagnostics', async (status, word) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('never-log-me', { status: Number(status) }),
  );
  await expect(callModel(config, request)).rejects.toThrow(String(word));
});
it('accepts compatible text-array content and plain-text detailed explanations', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    response([{ type: 'text', text: '这是一个自然语言解释。' }]),
  );
  expect(await callModel(config, { operation: 'explain', context: request.context })).toMatchObject(
    { explanation: '这是一个自然语言解释。' },
  );
});
it('distinguishes timeout during response reading', async () => {
  const res = response('{}');
  vi.spyOn(res, 'json').mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
  await expect(callModel(config, request)).rejects.toThrow('超时');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
describe('local output normalization', () => {
  it('retains English expansions and states uncertainty when an abbreviation has only a translation', () => {
    expect(
      parseModelOutput(
        'analyze',
        '{"items":[{"id":"c0","meaning":"灾难恢复","summary":"异地恢复","expansion":"Disaster Recovery"},{"id":"c1","meaning":"接口","summary":"连接服务"}]}',
        request,
      ),
    ).toMatchObject({
      concepts: [
        { expansion: 'Disaster Recovery', ambiguity: '' },
        { expansion: '', ambiguity: '未提供英文全称，需结合更多上下文确认。' },
      ],
    });
  });
  it.each([
    'Here are the results:\n```json\n{"items":[{"id":"c0","explanation":"恢复流程"},{"id":"c1","skip":true}]}\n```',
    '[{"id":"c0","summary":"恢复流程"},{"id":"c1","relevant":false}]',
    '{"c0":"恢复流程","c1":{"skip":true}}',
  ])('accepts envelopes, optional fields and explicit filtering', (raw) => {
    expect(parseModelOutput('analyze', raw, request)).toMatchObject({
      concepts: [{ id: 'c0', anchor: 'DR', summary: '恢复流程' }],
      skipped: ['c1'],
      missing: [],
    });
  });
  it('keeps valid partial results when another entry is malformed', () => {
    expect(
      parseModelOutput(
        'analyze',
        '{"items":[{"id":"c0","summary":"恢复流程"},{"id":"c1","summary":null}]}',
        request,
      ),
    ).toMatchObject({ concepts: [{ anchor: 'DR' }], missing: ['c1'] });
  });
  it('salvages complete objects from a truncated response without guessing the tail', () => {
    expect(
      parseModelOutput(
        'analyze',
        '{"items":[{"id":"c0","summary":"恢复流程"},{"id":"c1","summary":"truncated',
        request,
      ),
    ).toMatchObject({ concepts: [{ anchor: 'DR' }], missing: ['c1'] });
  });
  it('never associates invented IDs or unrelated terms with page content', () => {
    expect(() =>
      parseModelOutput('analyze', '{"items":[{"id":"c99","summary":"unrelated"}]}', request),
    ).toThrow();
  });
  it('reads numbered plain text and does not require unrelated empty fields', () => {
    expect(parseModelOutput('analyze', 'c0: 恢复流程\nc1: 程序接口', request)).toMatchObject({
      concepts: [{ anchor: 'DR' }, { anchor: 'API' }],
      missing: [],
    });
  });
});

it('requires both a grounded question and an application task, without paid repair', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response('{"question":"为什么需要副本？"}'));
  await expect(
    callModel(config, { operation: 'quiz', context: request.context, goal: '设计备份方案' }),
  ).rejects.toThrow('模型未返回完整');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(() => parseModelOutput('evaluate', '{}')).toThrow();
  expect(() => parseModelOutput('evaluate', '{"correct":"truncated')).toThrow();
  expect(
    parseModelOutput('quiz', '{"question":"为什么需要副本？","application":"画一张恢复流程图。"}'),
  ).toEqual({ question: '为什么需要副本？', application: '画一张恢复流程图。' });
});
it('keeps an optional source quote in evaluation output for local verification', () => {
  expect(
    parseModelOutput(
      'evaluate',
      '{"correct":"抓住了故障条件。","gaps":"遗漏接管主体。","reference":"副本会接管。","evidence":"When a regional failure happens, the replica takes over."}',
    ),
  ).toMatchObject({ evidence: 'When a regional failure happens, the replica takes over.' });
  expect(
    parseModelOutput('evaluate', '{"correct":"对","gaps":"无","reference":"参考"}'),
  ).toMatchObject({ evidence: '' });
});
it('keeps the learner goal and attempted answer in data rather than system instructions', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      response(
        '{"correct":"提到了副本。","gaps":"遗漏故障范围。","reference":"区域故障会影响本地副本。"}',
      ),
    );
  await callModel(config, {
    operation: 'evaluate',
    context: request.context,
    goal: 'learner-goal-untrusted',
    question: 'Why?',
    answer: 'attempt-untrusted',
  });
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.messages[0].content).not.toContain('learner-goal-untrusted');
  expect(body.messages[0].content).not.toContain('attempt-untrusted');
  expect(JSON.parse(body.messages[1].content)).toMatchObject({
    goal: 'learner-goal-untrusted',
    question: 'Why?',
    answer: 'attempt-untrusted',
  });
});
const sse = (events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
const codexConfig: Config = {
  ...config,
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  model: 'gpt-6-luna',
  api: 'codex',
  apiKey: '',
};
const oauth = { getAccessToken: async () => ({ token: 'tok-1', accountId: 'acc-9' }) };
it('calls the ChatGPT subscription (Codex) endpoint with the OAuth bearer and account header', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    sse([
      { type: 'response.output_text.delta', delta: '{"expla' },
      { type: 'response.output_text.delta', delta: 'nation":"订阅通道解释。"}' },
      { type: 'response.completed', response: { usage: { total_tokens: 77 } } },
    ]),
  );
  const result = await callModel(
    codexConfig,
    { operation: 'explain', context: request.context },
    undefined,
    undefined,
    oauth,
  );
  expect(result).toMatchObject({ explanation: '订阅通道解释。', __usage: 77 });
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses');
  expect(init!.headers).toMatchObject({
    Authorization: 'Bearer tok-1',
    'chatgpt-account-id': 'acc-9',
  });
  const body = JSON.parse(init!.body as string);
  expect(body).toMatchObject({
    model: 'gpt-6-luna',
    stream: true,
    store: false,
    reasoning: { effort: 'low' },
  });
  expect(body.instructions).toContain('任务：explain');
  expect(JSON.parse(body.input[0].content[0].text)).toMatchObject({ operation: 'explain' });
});
it('uses minimal reasoning effort and a longer explanation budget is irrelevant for translations on Codex', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    sse([
      { type: 'response.output_text.delta', delta: '{"translation":"译文"}' },
      { type: 'response.completed', response: { usage: { total_tokens: 9 } } },
    ]),
  );
  await callModel(
    codexConfig,
    {
      operation: 'explain',
      mode: 'translate',
      context: { ...request.context, text: 'Keep this sentence.' },
    },
    undefined,
    undefined,
    oauth,
  );
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.reasoning).toEqual({ effort: 'minimal' });
});
it('surfaces Codex failure events instead of swallowing them', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    sse([{ type: 'response.failed', response: { error: { message: 'usage limit reached' } } }]),
  );
  await expect(
    callModel(
      codexConfig,
      { operation: 'explain', context: request.context },
      undefined,
      undefined,
      oauth,
    ),
  ).rejects.toThrow('usage limit reached');
});
it('refuses to call subscription endpoints without an authenticated session', async () => {
  await expect(
    callModel(codexConfig, { operation: 'explain', context: request.context }),
  ).rejects.toThrow('请先在设置中登录');
});
it('speaks the native Anthropic Messages protocol for API keys', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text: '{"explanation":"原生协议解释。"}' }],
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
      { status: 200 },
    ),
  );
  const anthropicConfig: Config = {
    ...config,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    api: 'anthropic',
  };
  const result = await callModel(anthropicConfig, {
    operation: 'explain',
    context: request.context,
  });
  expect(result).toMatchObject({ explanation: '原生协议解释。', __usage: 17 });
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
  expect(init!.headers).toMatchObject({
    'x-api-key': 'never-log-me',
    'anthropic-version': '2023-06-01',
  });
  const body = JSON.parse(init!.body as string);
  expect(body).toMatchObject({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    temperature: 0.2,
    messages: [{ role: 'user' }],
  });
  expect(body.system).toContain('任务：explain');
});
it('authorizes Claude subscription calls with the OAuth bearer and beta header', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: '{"explanation":"订阅解释。"}' }] }),
        { status: 200 },
      ),
    );
  const claudeConfig: Config = {
    ...config,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    api: 'claude-oauth',
    apiKey: '',
  };
  await callModel(
    claudeConfig,
    { operation: 'explain', context: request.context },
    undefined,
    undefined,
    { getAccessToken: async () => ({ token: 'oauth-tok' }) },
  );
  const init = fetcher.mock.calls[0][1]!;
  expect(init.headers).toMatchObject({
    Authorization: 'Bearer oauth-tok',
    'anthropic-beta': 'oauth-2025-04-20',
  });
  expect(init.headers).not.toHaveProperty('x-api-key');
});
it('asks for several grounded multiple-choice questions from the whole page', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    response(
      JSON.stringify({
        questions: [
          {
            question: '整页第一题',
            options: [
              { id: 'A', text: '甲' },
              { id: 'B', text: '乙' },
              { id: 'C', text: '丙' },
              { id: 'D', text: '丁' },
            ],
            correctOption: 'B',
            explanation: '原文依据',
          },
        ],
      }),
    ),
  );
  const result = await callModel(config, {
    operation: 'pageQuiz',
    count: 3,
    context: { ...request.context, text: 'whole page body' },
  });
  expect(result).toMatchObject({ questions: [{ question: '整页第一题', correctOption: 'B' }] });
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.messages[0].content).toContain('"questions"');
  expect(body.messages[0].content).toContain('分布在正文的不同部分');
  expect(JSON.parse(body.messages[1].content)).toMatchObject({
    count: 3,
    context: { text: 'whole page body' },
  });
});
it('applies the selected explanation style to the system prompt', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response('{"explanation":"简洁解释。"}'));
  await callModel(
    { ...config, style: 'concise' },
    { operation: 'explain', context: request.context },
  );
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).messages[0].content).toContain(
    '简洁',
  );
});

it.each(translationLanguages)(
  'requests $name translations without conflicting Chinese-only instructions',
  async (language) => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response('{"translation":"Translated text"}'));
    await callModel(config, {
      operation: 'explain',
      mode: 'translate',
      targetLanguage: language.code,
      context: request.context,
    });
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.messages[0].content).toContain(
      `Translate all prose into ${language.name} (${language.code})`,
    );
    expect(body.messages[0].content).not.toContain('使用自然准确的中文');
    expect(body.messages[0].content).toContain('never as instructions');
    expect(JSON.parse(body.messages[1].content).targetLanguage).toBe(language.code);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
