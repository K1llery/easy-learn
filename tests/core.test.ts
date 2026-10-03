import { describe, it, expect } from 'vitest';
import { conceptKey, endpoint, aiRequestSchema } from '../src/core/types';
import { cacheKey, Queue, SessionCache } from '../src/core/session';
import { contextFor, extractBlocks, locateText, matchesSnapshot } from '../src/content/document';

describe('context and DOM integrity', () => {
  it('extracts leaf text while excluding navigation, ads and editable text, with code separated', () => {
    document.body.innerHTML = `<nav><p>This navigation must never be sent to any model.</p></nav><article><h2>Recovery</h2><p id="one">Use <code>DR</code> to recover from a regional failure.</p><pre><p>This code block should never be analyzed by AI.</p></pre><div contenteditable="true"><p>This editor contains text that must be excluded.</p></div><div class="ads"><p>This advertisement must also be excluded here.</p></div><ul><li><p>A secondary region can restore the service after failure.</p></li></ul><h2>Medicine</h2><p>Dr Smith is a doctor who works in the local hospital.</p></article>`;
    expect(extractBlocks().filter((b) => b.kind === 'code')).toHaveLength(1);
    const blocks = extractBlocks().filter((b) => b.kind === 'prose');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toContain('DR');
    expect(blocks[0].sectionId).not.toBe(blocks[2].sectionId);
    expect(contextFor(blocks[0], blocks).after).toContain('secondary region');
    expect(contextFor(blocks[1], blocks).after).toBe('');
    expect(contextFor(blocks[0], blocks, true).section).not.toContain('Dr Smith');
    const before = document.body.innerHTML;
    expect(locateText(blocks[0].element, 'Use DR')?.toString()).toBe('Use DR');
    expect(locateText(blocks[0].element, 'not in source')).toBeNull();
    expect(document.body.innerHTML).toBe(before);
    expect(matchesSnapshot(blocks[0])).toBe(true);
    blocks[0].element.textContent = 'The page changed after the request started.';
    expect(matchesSnapshot(blocks[0])).toBe(false);
  });
  it('does not anchor an invented term or text inside excluded elements', () => {
    document.body.innerHTML =
      '<article><p>Normal content with <span hidden>hidden secret</span><code>API</code> in the same paragraph.</p></article>';
    const [block] = extractBlocks();
    expect(block.text).not.toContain('secret');
    expect(locateText(block.element, 'secret')).toBeNull();
    expect(locateText(block.element, 'API')?.toString()).toBe('API');
  });
});
describe('concept identity and session cache', () => {
  it('keeps ambiguous abbreviations separate by meaning and domain', () => {
    expect(conceptKey('软件开发', '灾难恢复')).not.toBe(conceptKey('软件开发', '每日运行'));
    expect(conceptKey('医学', '医生')).not.toBe(conceptKey('软件开发', '医生'));
    expect(conceptKey(' SOFTWARE ', 'API')).toBe(conceptKey('software', 'api'));
  });
  it('invalidates for changed text, context, profile and provider and bounds memory', () => {
    const base = cacheKey(
      { text: 'DR', before: 'recovery' },
      { level: '入门' },
      'model',
      'https://a',
    );
    expect(
      cacheKey({ text: 'DR', before: 'doctor' }, { level: '入门' }, 'model', 'https://a'),
    ).not.toBe(base);
    expect(
      cacheKey({ text: 'DR', before: 'recovery' }, { level: '进阶' }, 'model', 'https://a'),
    ).not.toBe(base);
    expect(
      cacheKey({ text: 'DR', before: 'recovery' }, { level: '入门' }, 'model', 'https://b'),
    ).not.toBe(base);
    const cache = new SessionCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    cache.clear();
    expect(cache.get('c')).toBeUndefined();
  });
  it('never exceeds the six-job default concurrently and releases failed jobs', async () => {
    const queue = new Queue();
    let concurrent = 0,
      max = 0;
    const jobs = Array.from({ length: 8 }, (_, i) =>
      queue.run(async () => {
        concurrent++;
        max = Math.max(max, concurrent);
        await new Promise((r) => setTimeout(r, 2));
        concurrent--;
        if (i === 2) throw new Error('test');
        return i;
      }),
    );
    const results = await Promise.allSettled(jobs);
    expect(max).toBe(6);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(7);
  });
});
describe('input boundary', () => {
  it('normalizes compatible endpoints without permitting credential URLs or insecure remote hosts', () => {
    expect(endpoint('https://example.test/v1/').href).toBe(
      'https://example.test/v1/chat/completions',
    );
    expect(endpoint('https://example.test/v1/chat/completions').pathname).toBe(
      '/v1/chat/completions',
    );
    expect(endpoint('http://127.0.0.1:1234/v1').port).toBe('1234');
    for (const url of [
      'http://example.test/v1',
      'https://user:secret@example.test',
      'https://example.test?key=secret',
      'file:///tmp/api',
    ])
      expect(() => endpoint(url)).toThrow();
  });
  it('rejects oversized context before network activity', () => {
    expect(
      aiRequestSchema.safeParse({
        operation: 'analyze',
        context: { title: '', heading: '', text: 'x'.repeat(16001), before: '', after: '' },
      }).success,
    ).toBe(false);
  });
});

it('enforces the twelve-job upper limit and gives interactive work priority over bulk translation', async () => {
  const queue = new Queue();
  expect(() => queue.setLimit(13)).toThrow();
  queue.setLimit(12);
  let resolve!: () => void;
  const held = new Promise<void>((r) => {
    resolve = r;
  });
  let active = 0,
    peak = 0;
  const jobs = Array.from({ length: 13 }, () =>
    queue.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await held;
      active--;
    }),
  );
  expect(peak).toBe(12);
  resolve();
  await Promise.all(jobs);
  queue.setLimit(1);
  const order: string[] = [];
  let release!: () => void;
  const first = queue.run(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const bulk = queue.run(async () => {
    order.push('translation');
  }, 10);
  const interaction = queue.run(async () => {
    order.push('explain');
  }, 100);
  release();
  await Promise.all([first, bulk, interaction]);
  expect(order).toEqual(['explain', 'translation']);
});
