import {afterEach, expect, it, vi} from 'vitest';
import {PageTranslation, type TranslationStatus} from '../src/content/page-translation';
import {extractBlocks} from '../src/content/document';
import type {TextContext} from '../src/core/types';

let translator: PageTranslation;
afterEach(() => translator?.dispose());
function create(request: (context: any) => Promise<string>, concurrency = 6, cancel = vi.fn(async (): Promise<unknown> => undefined)) {
  let status: TranslationStatus;
  translator = new PageTranslation({request, cancel, concurrency: () => concurrency, changed: next => {status = next;}});
  return {cancel, status: () => status!};
}
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(r => {resolve = r;});
  return {promise, resolve};
}
it('translates headings, prose and div list content; preserves source links and excludes controls', async () => {
  document.body.innerHTML = '<style>.concealed{display:none}</style><nav><p>Navigation</p></nav><article><h1>Research title</h1><p>A <a href="/paper">public paper</a>.</p><div role="listitem"><span>Another research item</span></div><div><pre><code>rm -rf test</code></pre></div><div class="concealed"><p>Hidden draft</p></div><textarea>Private draft</textarea></article>';
  const source = document.querySelector('article p')!.innerHTML;
  const link = document.querySelector('a');
  const request = vi.fn(async (_context: TextContext) => '中文译文 <script>not executable</script>');
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  expect(request.mock.calls.map(([ctx]) => ctx.text)).toEqual(['Research title', 'A public paper.', 'Another research item']);
  expect(document.querySelector('article p')!.innerHTML).toBe(source);
  expect(document.querySelector('a')).toBe(link);
  expect(document.querySelectorAll('[data-easy-learn="translation"]')).toHaveLength(3);
  expect(document.querySelectorAll('script')).toHaveLength(0);
  expect(extractBlocks(document, 'translation').filter(b => b.kind === 'prose').map(b => b.text)).not.toContain('中文译文');
  translator.restore();
  expect(document.querySelectorAll('[data-easy-learn="translation"]')).toHaveLength(0);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  expect(request).toHaveBeenCalledTimes(3);
});
it('bounds parallel requests, discards changed-source results and picks up dynamically added prose', async () => {
  document.body.innerHTML = '<article><p>First source</p><p>Second source</p><p>Third source</p></article>';
  const pending = [deferred(), deferred(), deferred(), deferred()];
  let index = 0;
  const request = vi.fn(() => pending[index++].promise);
  create(request, 2); translator.start();
  expect(request).toHaveBeenCalledTimes(2);
  document.querySelector('p')!.textContent = 'Changed source';
  pending[0].resolve('stale translation'); pending[1].resolve('第二段');
  await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(2));
  pending[2].resolve('第三段'); pending[3].resolve('新文字');
  await vi.waitFor(() => expect(document.querySelector('article')!.textContent).toContain('新文字'));
  expect(document.body.textContent).not.toContain('stale translation');
  request.mockImplementation(async () => '动态段落');
  document.querySelector('article')!.insertAdjacentHTML('beforeend', '<p>Appended source</p>');
  await vi.waitFor(() => expect(document.body.textContent).toContain('动态段落'));
});
it('pauses on rate limits, keeps completed results, and only retries on explicit resume', async () => {
  document.body.innerHTML = '<article><p>First source</p><p>Second source</p><p>Third source</p></article>';
  const request = vi.fn().mockResolvedValueOnce('已完成的第一段').mockRejectedValueOnce(new Error('服务限流')).mockResolvedValue('剩余译文');
  const state = create(request, 1); translator.start();
  await vi.waitFor(() => expect(state.status().paused).toBe(true));
  expect(request).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('已完成的第一段');
  expect(state.cancel).toHaveBeenCalled();
  translator.resume();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  expect(request).toHaveBeenCalledTimes(4);
});
it('waits for cancellation before rapid resume, and preserves all long-paragraph text across chunks', async () => {
  const source = 'A long scientific sentence. '.repeat(800);
  document.body.innerHTML = '<article><p></p></article>';
  document.querySelector('p')!.textContent = source;
  const old = deferred(), cancellation = deferred();
  const request = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue('译文');
  create(request, 1, vi.fn(() => cancellation.promise));
  translator.start(); translator.pause(); translator.resume();
  old.resolve('stale'); await Promise.resolve(); await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  cancellation.resolve('done');
  await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(1));
  await vi.waitFor(() => expect(document.body.textContent).toContain('译文'));
  const sources = request.mock.calls.slice(1).map(([ctx]) => ctx.text);
  expect(sources.every(s => s.length <= 2000)).toBe(true);
  await vi.waitFor(() => expect(request.mock.calls.slice(1).map(([ctx]) => ctx.text).join(' ').replace(/\s+/g, ' ').trim()).toBe(source.trim()));
});

it('keeps cached translations attached to their original after reordering and external removal', async () => {
  document.body.innerHTML = '<article><p id="first">First source</p><p id="second">Second source</p><ul><li>List source</li></ul></article>';
  const request = vi.fn(async (context: TextContext) => `译文：${context.text}`);
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  const first = document.querySelector('#first')!;
  const article = document.querySelector('article')!;
  article.append(first);
  await vi.waitFor(() => expect(first.nextElementSibling?.textContent).toBe('译文：First source'));
  first.nextElementSibling!.remove();
  await vi.waitFor(() => expect(first.nextElementSibling?.textContent).toBe('译文：First source'));
  const list = document.querySelector('li')!;
  list.querySelector('[data-easy-learn]')!.remove();
  await vi.waitFor(() => expect(list.querySelector('[data-easy-learn]')?.textContent).toBe('译文：List source'));
  expect(request).toHaveBeenCalledTimes(3);
});
