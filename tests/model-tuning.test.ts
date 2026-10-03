// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { callModel } from '../src/core/ai';
import { providerOptions } from '../src/core/providers';
import { configSchema } from '../src/core/types';
import { providerDraftSchema } from '../src/core/provider-settings';
import { Queue } from '../src/core/session';
const config = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: 'fixture-key',
  profile: { domain: '外语阅读', level: '入门' as const },
};
const request = {
  operation: 'analyze' as const,
  context: { title: 'Story', heading: '', text: 'unused', before: '', after: '' },
  candidates: [
    {
      id: 'c0',
      anchor: 'ephemeral',
      kind: 'vocabulary' as const,
      heading: 'Story',
      context: 'The ephemeral lantern glows.',
    },
  ],
};
it('preserves user tuning in saved connections and incomplete provider drafts', () => {
  const tuning = {
    thinking: 'enabled',
    reasoningEffort: 'max',
    fast: true,
    temperature: 0.5,
    maxOutputTokens: 16000,
  };
  expect(configSchema.parse({ ...config, tuning }).tuning).toEqual(tuning);
  expect(providerDraftSchema.parse({ ...config, tuning }).tuning).toEqual(tuning);
  expect(configSchema.safeParse({ ...config, tuning: { maxOutputTokens: 0 } }).success).toBe(false);
});
it('sends DeepSeek thinking effort and output budget, and omits ignored temperature', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"items":[{"id":"c0","meaning":"短暂的","summary":"持续时间很短"}]}',
            },
          },
        ],
      }),
    ),
  );
  await callModel(
    {
      ...config,
      tuning: {
        thinking: 'enabled',
        reasoningEffort: 'max',
        maxOutputTokens: 16000,
        temperature: 0.7,
      },
    },
    request,
  );
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
    max_tokens: 16000,
  });
  expect(body).not.toHaveProperty('temperature');
});
it('turns DeepSeek thinking off without sending an incompatible effort', () => {
  expect(
    providerOptions(config.baseUrl, config.model, undefined, {
      thinking: 'disabled',
      reasoningEffort: 'max',
    }),
  ).toEqual({ thinking: { type: 'disabled' } });
});
it('lets CPA Fast and reasoning be controlled independently on custom localhost ports', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"items":[{"id":"c0","summary":"短暂的"}]}' } }],
      }),
    ),
  );
  await callModel(
    {
      ...config,
      baseUrl: 'http://localhost:9876/v1',
      model: 'chosen-model',
      tuning: { fast: true, reasoningEffort: 'none' },
    },
    request,
  );
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({
    service_tier: 'priority',
    reasoning_effort: 'none',
    temperature: 0.2,
  });
  expect(
    providerOptions('http://localhost:9876/v1', 'chosen-model', undefined, { fast: false }),
  ).toMatchObject({ service_tier: 'default' });
});
it('changes concurrency without canceling active work or exceeding the lower limit', async () => {
  const queue = new Queue();
  queue.setLimit(3);
  const release: (() => void)[] = [];
  const running = [0, 1, 2].map(() => queue.run(() => new Promise<void>((r) => release.push(r))));
  queue.setLimit(1);
  let started = false;
  const next = queue.run(async () => {
    started = true;
  });
  release[0]();
  await running[0];
  expect(started).toBe(false);
  release[1]();
  await running[1];
  expect(started).toBe(false);
  release[2]();
  await Promise.all([...running, next]);
  expect(started).toBe(true);
});
it('uses the official OpenAI completion budget and omits sampling parameters for reasoning models', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"items":[{"id":"c0","summary":"短暂的"}]}' } }],
        }),
      ),
  );
  await callModel(
    {
      ...config,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6.1-sol',
      tuning: { fast: true, reasoningEffort: 'low', maxOutputTokens: 9000 },
    },
    request,
  );
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({
    service_tier: 'priority',
    max_completion_tokens: 9000,
    reasoning_effort: 'low',
  });
  expect(body).not.toHaveProperty('max_tokens');
  expect(body).not.toHaveProperty('temperature');
  await callModel(
    { ...config, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol' },
    request,
  );
  const automatic = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
  expect(automatic.max_completion_tokens).toBe(8192);
  expect(automatic).not.toHaveProperty('temperature');
});
it('reserves output for default DeepSeek thinking and never sends a stale Fast flag to DeepSeek', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"items":[{"id":"c0","summary":"短暂的"}]}' } }],
      }),
    ),
  );
  await callModel({ ...config, model: 'deepseek-reasoner', tuning: { fast: true } }, request);
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.max_tokens).toBe(8192);
  expect(body).not.toHaveProperty('service_tier');
  expect(body).not.toHaveProperty('temperature');
});
