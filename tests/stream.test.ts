// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { callModel } from '../src/core/ai';
import { ObjectStream } from '../src/core/stream';
import type { AIRequest, Config } from '../src/core/types';
const config: Config = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: 'fake',
  profile: { domain: '软件开发', level: '入门' },
};
const request: AIRequest = {
  operation: 'analyze',
  context: { title: 'Doc', heading: '', text: 'candidates', before: '', after: '' },
  candidates: [
    {
      id: 'c0',
      anchor: 'DR',
      kind: 'abbreviation',
      heading: 'Recovery',
      context: 'Restore service in another region.',
    },
    {
      id: 'c1',
      anchor: 'SLO',
      kind: 'abbreviation',
      heading: 'Reliability',
      context: 'An availability objective.',
    },
  ],
};
const encode = new TextEncoder();
const event = (part: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\r\n\r\n`;
function setup() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  return {
    sendBytes: (s: Uint8Array) => controller.enqueue(s),
    send: (s: string) => controller.enqueue(encode.encode(s)),
    close: () => controller.close(),
    fail: () => controller.error(new Error('private provider diagnostic')),
    fetcher,
  };
}
it('displays a complete item before the response finishes and handles split UTF-8 / SSE frames', async () => {
  const transport = setup(),
    progress = vi.fn();
  const pending = callModel(config, request, undefined, progress);
  const first = event(
    '{"items":[{"id":"c0","summary":"恢复服务","expansion":"Disaster Recovery"},',
  );
  for (const byte of encode.encode(first)) transport.sendBytes(Uint8Array.of(byte));
  await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
  expect(progress.mock.calls[0][0].concepts[0]).toMatchObject({ id: 'c0', summary: '恢复服务' });
  transport.send(event('{"id":"c1","skip":true}]}'));
  transport.send('data: {"choices":[],"usage":{"total_tokens":42}}\n\ndata: [DONE]\n\n');
  const result = await pending;
  expect(result).toMatchObject({
    concepts: [{ id: 'c0' }],
    skipped: ['c1'],
    missing: [],
    __usage: 42,
  });
  const body = JSON.parse(transport.fetcher.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({
    stream: true,
    thinking: { type: 'disabled' },
    stream_options: { include_usage: true },
  });
  expect(transport.fetcher.mock.calls[0][1]!.headers).toMatchObject({
    Authorization: 'Bearer fake',
  });
  expect(result.__timing.firstItemMs).not.toBeNull();
});
it('preserves completed entries after interruption, never invents the unfinished entry, never retries', async () => {
  const transport = setup(),
    progress = vi.fn();
  const pending = callModel(config, request, undefined, progress);
  transport.send(
    event('{"items":[{"id":"c0","summary":"恢复服务"},{"id":"c1","summary":"unfinished'),
  );
  await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
  transport.fail();
  expect(await pending).toMatchObject({
    concepts: [{ id: 'c0' }],
    missing: ['c1'],
    __warning: expect.stringContaining('中断'),
  });
  expect(transport.fetcher).toHaveBeenCalledTimes(1);
});
it('ignores invented IDs and duplicated entries', async () => {
  const transport = setup(),
    progress = vi.fn();
  const pending = callModel(config, request, undefined, progress);
  transport.send(
    event(
      '{"items":[{"id":"c99","summary":"fake"},{"id":"c0","summary":"恢复"},{"id":"c0","summary":"重复"}]}',
    ),
  );
  transport.send('data: [DONE]\n\n');
  expect(await pending).toMatchObject({
    concepts: [{ id: 'c0', summary: '恢复' }],
    missing: ['c1'],
  });
  expect(progress).toHaveBeenCalledTimes(1);
});
it('explicit cancellation rejects rather than returning partial data to an obsolete page', async () => {
  const transport = setup(),
    abort = new AbortController(),
    progress = vi.fn();
  const pending = callModel(config, request, abort.signal, progress);
  transport.send(event('{"items":[{"id":"c0","summary":"恢复"},'));
  await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
  abort.abort();
  transport.fail();
  await expect(pending).rejects.toThrow('取消');
});
it('does not parse braces inside quoted text or emit truncated objects', () => {
  const objects = new ObjectStream();
  expect(objects.push('{"items":[{"id":"c0","summary":"a } \\" b"},')).toEqual([
    { id: 'c0', summary: 'a } " b' },
  ]);
  expect(objects.push('{"id":"c1","summary":"unfinished')).toEqual([]);
});

it('times out a stream that sends only keepalives, without an automatic retry', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encode.encode(': heartbeat\n\n'));
              init!.signal!.addEventListener('abort', () =>
                controller.error(new DOMException('aborted', 'AbortError')),
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const pending = callModel(config, request);
    const assertion = expect(pending).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(25001);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
