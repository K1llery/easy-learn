import { afterEach, expect, it, vi } from 'vitest';
import { PageTranslation, type TranslationStatus } from '../src/content/page-translation';
import { extractBlocks } from '../src/content/document';
import type { TextContext } from '../src/core/types';
import type { TranslationLanguage } from '../src/core/translation-languages';
import { translatedRuns, translationParts } from '../src/content/translation-format';

let translator: PageTranslation;
afterEach(() => translator?.dispose());
function create(
  request: (context: TextContext, language: TranslationLanguage) => Promise<string>,
  concurrency = 6,
  cancel = vi.fn(async (): Promise<unknown> => undefined),
) {
  let status: TranslationStatus;
  translator = new PageTranslation({
    request,
    cancel,
    concurrency: () => concurrency,
    changed: (next) => {
      status = next;
    },
  });
  return { cancel, status: () => status! };
}
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it('translates headings, prose and div list content; preserves source links and excludes controls', async () => {
  document.body.innerHTML =
    '<style>.concealed{display:none}</style><nav><p>Navigation</p></nav><article><h1>Research title</h1><p>A <a href="/paper">public paper</a>.</p><div role="listitem"><span>Another research item</span></div><div><pre><code>rm -rf test</code></pre></div><div class="concealed"><p>Hidden draft</p></div><textarea>Private draft</textarea></article>';
  const source = document.querySelector('article p')!.innerHTML;
  const link = document.querySelector('a');
  const request = vi.fn(
    async (_context: TextContext) => '中文译文 <script>not executable</script>',
  );
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  expect(request.mock.calls.map(([ctx]) => ctx.text.replace(/⟦\/?EL\d*:\d+⟧/g, ''))).toEqual([
    'Research title',
    'A public paper.',
    'Another research item',
  ]);
  expect(document.querySelector('article p')!.innerHTML).toBe(source);
  expect(document.querySelector('a')).toBe(link);
  expect(document.querySelectorAll('[data-easy-learn="translation"]')).toHaveLength(3);
  expect(document.querySelectorAll('script')).toHaveLength(0);
  expect(
    extractBlocks(document, 'translation')
      .filter((b) => b.kind === 'prose')
      .map((b) => b.text),
  ).not.toContain('中文译文');
  translator.restore();
  expect(document.querySelectorAll('[data-easy-learn="translation"]')).toHaveLength(0);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  expect(request).toHaveBeenCalledTimes(3);
});
it('bounds parallel requests, discards changed-source results and picks up dynamically added prose', async () => {
  document.body.innerHTML =
    '<article><p>First source</p><p>Second source</p><p>Third source</p></article>';
  const pending = [deferred(), deferred(), deferred(), deferred()];
  let index = 0;
  const request = vi.fn(() => pending[index++].promise);
  create(request, 2);
  translator.start();
  expect(request).toHaveBeenCalledTimes(2);
  document.querySelector('p')!.textContent = 'Changed source';
  pending[0].resolve('stale translation');
  pending[1].resolve('第二段');
  await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(2));
  pending[2].resolve('第三段');
  pending[3].resolve('新文字');
  await vi.waitFor(() =>
    expect(document.querySelector('article')!.textContent).toContain('新文字'),
  );
  expect(document.body.textContent).not.toContain('stale translation');
  request.mockImplementation(async () => '动态段落');
  document.querySelector('article')!.insertAdjacentHTML('beforeend', '<p>Appended source</p>');
  await vi.waitFor(() => expect(document.body.textContent).toContain('动态段落'));
});
it('pauses on rate limits, keeps completed results, and only retries on explicit resume', async () => {
  document.body.innerHTML =
    '<article><p>First source</p><p>Second source</p><p>Third source</p></article>';
  const request = vi
    .fn()
    .mockResolvedValueOnce('已完成的第一段')
    .mockRejectedValueOnce(new Error('服务限流'))
    .mockResolvedValue('剩余译文');
  const state = create(request, 1);
  translator.start();
  await vi.waitFor(() => expect(state.status().paused).toBe(true));
  expect(request).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('已完成的第一段');
  expect(state.cancel).toHaveBeenCalled();
  translator.resume();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  expect(request).toHaveBeenCalledTimes(4);
});
it('retries failed paragraphs after restoring and explicitly restarting while reusing completed translations', async () => {
  document.body.innerHTML =
    '<article><p>First source</p><p>Second source</p><p>Third source</p></article>';
  const request = vi
    .fn(async (_context: TextContext) => '剩余译文')
    .mockResolvedValueOnce('已完成的第一段')
    .mockRejectedValueOnce(new Error('服务限流'));
  const state = create(request, 1);
  translator.toggle();
  await vi.waitFor(() => expect(state.status().paused).toBe(true));
  expect(state.status().ready).toBe(1);
  expect(request).toHaveBeenCalledTimes(2);
  translator.toggle();
  expect(state.status().visible).toBe(false);
  expect(document.querySelectorAll('[data-easy-learn="translation"]')).toHaveLength(0);
  translator.toggle();
  await vi.waitFor(() => expect(state.status().ready).toBe(3));
  expect(state.status()).toMatchObject({ visible: true, paused: false, error: '' });
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.filter(([context]) => context.text === 'First source')).toHaveLength(1);
  expect(document.body.textContent).toContain('已完成的第一段');
});
it('waits for cancellation before rapid resume, and preserves all long-paragraph text across chunks', async () => {
  const source = 'A long scientific sentence. '.repeat(800);
  document.body.innerHTML = '<article><p></p></article>';
  document.querySelector('p')!.textContent = source;
  const old = deferred(),
    cancellation = deferred();
  const request = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValue('译文');
  create(
    request,
    1,
    vi.fn(() => cancellation.promise),
  );
  translator.start();
  translator.pause();
  translator.resume();
  old.resolve('stale');
  await Promise.resolve();
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  cancellation.resolve('done');
  await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(1));
  await vi.waitFor(() => expect(document.body.textContent).toContain('译文'));
  const sources = request.mock.calls.slice(1).map(([ctx]) => ctx.text);
  expect(sources.every((s) => s.length <= 2000)).toBe(true);
  await vi.waitFor(() =>
    expect(
      request.mock.calls
        .slice(1)
        .map(([ctx]) => ctx.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe(source.trim()),
  );
});

it('keeps cached translations attached to their original after reordering and external removal', async () => {
  document.body.innerHTML =
    '<article><p id="first">First source</p><p id="second">Second source</p><ul><li>List source</li></ul></article>';
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
  await vi.waitFor(() =>
    expect(list.querySelector('[data-easy-learn]')?.textContent).toBe('译文：List source'),
  );
  expect(request).toHaveBeenCalledTimes(3);
});

it('keeps translated emphasis attached to its text when Chinese word order changes', async () => {
  document.body.innerHTML =
    '<article><p style="font-size:22px">Read <strong style="font-weight:750">carefully</strong> today.</p></article>';
  const request = vi.fn(async () => '今天⟦EL:1⟧仔细⟦/EL:1⟧⟦EL:0⟧阅读⟦/EL:0⟧⟦EL:2⟧。⟦/EL:2⟧');
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(1));
  const target = document.querySelector<HTMLElement>('[data-easy-learn="translation"]')!;
  expect(target.textContent).toBe('今天仔细阅读。');
  expect(target.style.fontSize).toBe('22px');
  expect(
    [...target.querySelectorAll('span')].find((el) => el.textContent === '仔细')?.style.fontWeight,
  ).toBe('750');
  expect(request.mock.calls[0]).toMatchObject([
    {
      text: '⟦EL:0⟧Read ⟦/EL:0⟧⟦EL:1⟧carefully⟦/EL:1⟧⟦EL:2⟧ today.⟦/EL:2⟧',
      translationMarker: 'EL',
    },
    'zh-CN',
  ]);
});

it.each([
  '⟦EL:0⟧普通⟦/EL:0⟧强调',
  '⟦EL:0⟧普通⟦EL:1⟧强调⟦/EL:1⟧⟦/EL:0⟧',
  '⟦EL:0⟧普通⟦/EL:0⟧⟦EL:0⟧重复⟦/EL:0⟧⟦EL:1⟧强调⟦/EL:1⟧',
  '⟦EL:0⟧普通⟦/EL:0⟧⟦EL:99⟧未知⟦/EL:99⟧⟦EL:1⟧强调⟦/EL:1⟧',
])('shows all returned text safely when format markers are invalid: %s', async (translation) => {
  document.body.innerHTML = '<article><p>Normal <strong>emphasis</strong></p></article>';
  const request = vi.fn(async () => `${translation}<img src=x onerror=alert(1)>`);
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(1));
  const target = document.querySelector('[data-easy-learn="translation"]')!;
  expect(target.textContent).toBe(
    `${translation.replace(/⟦\/?EL:\d+⟧/g, '')}<img src=x onerror=alert(1)>`,
  );
  expect(target.querySelectorAll('span,img')).toHaveLength(0);
  expect(state.status().error).toContain('未保留格式标记');
  expect(request).toHaveBeenCalledTimes(1);
});

it('bounds rich text requests including marker overhead without losing any text or splitting surrogate pairs', () => {
  document.body.innerHTML = `<article><p>${Array.from({ length: 2000 }, (_, i) => `<strong>${i % 2 ? '😀' : 'x'}</strong>`).join('')}</p></article>`;
  const block = extractBlocks(document, 'translation')[0];
  const parts = translationParts(block);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every((part) => part.source.length <= 4000)).toBe(true);
  expect(parts.map((part) => part.source.replace(/⟦\/?EL:\d+⟧/g, '')).join('')).toBe(block.text);
  for (const part of parts) {
    const text = part.source.replace(/⟦\/?EL:\d+⟧/g, '');
    expect(text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    expect(translatedRuns({ ...part, translation: part.source }).valid).toBe(true);
  }
});

it('does not interpret marker-like source text as format metadata', () => {
  document.body.innerHTML = '<article><p>Literal ⟦EL:0⟧ <b>source</b></p></article>';
  const part = translationParts(extractBlocks(document, 'translation')[0])[0];
  expect(part.marker).toBe('EL1');
  const parsed = translatedRuns({ ...part, translation: part.source });
  expect(parsed.valid).toBe(true);
  expect(parsed.pieces.map((piece) => piece.text).join('')).toBe('Literal ⟦EL:0⟧ source');
});

it('rejects an in-flight result after inline structure changes without changing plain text', async () => {
  document.body.innerHTML = '<article><p>Read carefully.</p></article>';
  const pending = deferred();
  const request = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockImplementation(async (context: TextContext) => context.text);
  const state = create(request);
  translator.start();
  document.querySelector('p')!.innerHTML = 'Read <strong>carefully.</strong>';
  pending.resolve('stale unformatted result');
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(state.status().ready).toBe(1));
  expect(document.body.textContent).not.toContain('stale unformatted result');
  expect(document.querySelector('[data-easy-learn="translation"]')?.textContent).toBe(
    'Read carefully.',
  );
});

it('rejects marker-only output instead of reporting an empty paragraph as translated', async () => {
  document.body.innerHTML = '<article><p><strong>Important</strong></p></article>';
  const request = vi.fn(async () => '⟦EL:0⟧⟦/EL:0⟧');
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().paused).toBe(true));
  expect(state.status().ready).toBe(0);
  expect(state.status().error).toContain('未收到有效译文');
  expect(document.querySelector('[data-easy-learn="translation"]')).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

it('retains consecutive line breaks and refreshes them after source structure changes', async () => {
  document.body.innerHTML = '<article><p>First<br><br>Second</p></article>';
  const request = vi.fn(async (context: TextContext) => context.text);
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(1));
  expect(document.querySelectorAll('[data-easy-learn="translation"] br')).toHaveLength(2);
  document.querySelector('p br')!.remove();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-easy-learn="translation"] br')).toHaveLength(1),
  );
});

it('updates cached line breaks for CSS visibility changes, including hidden ancestors, without model requests', async () => {
  document.body.innerHTML =
    '<article><p>First<br id="visible-break"><span style="display:none"><br id="nested-break"></span>Second</p></article>';
  const request = vi.fn(async (context: TextContext) => context.text);
  const state = create(request);
  translator.start();
  await vi.waitFor(() => expect(state.status().ready).toBe(1));
  expect(document.querySelectorAll('[data-easy-learn="translation"] br')).toHaveLength(1);
  (document.querySelector('#visible-break') as HTMLElement).style.display = 'none';
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-easy-learn="translation"] br')).toHaveLength(0),
  );
  (document.querySelector('#nested-break')!.parentElement as HTMLElement).style.display = 'inline';
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-easy-learn="translation"] br')).toHaveLength(1),
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it('switches languages only on explicit continuation, discards old responses and preserves original nodes', async () => {
  document.body.innerHTML =
    '<article><p id="source">Keep the original <a href="/reference">link</a>.</p></article>';
  const source = document.querySelector('#source')!,
    link = document.querySelector('a');
  const original = source.innerHTML;
  const pending = deferred();
  const request = vi.fn((_context: TextContext, language: TranslationLanguage) =>
    language === 'zh-CN'
      ? pending.promise
      : Promise.resolve(language === 'fr' ? 'Gardez le lien original.' : 'احتفظ بالرابط الأصلي.'),
  );
  const state = create(request);
  translator.start();
  expect(request).toHaveBeenCalledTimes(1);
  translator.setTargetLanguage('fr');
  expect(state.status().paused).toBe(true);
  pending.resolve('旧中文结果');
  await vi.waitFor(() => expect(state.cancel).toHaveBeenCalled());
  expect(document.querySelector('[data-easy-learn="translation"]')).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  translator.resume();
  await vi.waitFor(() => expect(state.status().ready).toBe(1));
  expect(document.querySelector('[data-easy-learn="translation"]')).toMatchObject({
    lang: 'fr',
    textContent: 'Gardez le lien original.',
  });
  translator.setTargetLanguage('ar');
  expect(document.querySelector('[data-easy-learn="translation"]')).toBeNull();
  translator.resume();
  await vi.waitFor(() => expect(state.status().ready).toBe(1));
  const translated = document.querySelector<HTMLElement>('[data-easy-learn="translation"]')!;
  expect(translated.lang).toBe('ar');
  expect(translated.dir).toBe('rtl');
  expect(translated.style.direction).toBe('rtl');
  expect(source.innerHTML).toBe(original);
  expect(document.querySelector('a')).toBe(link);
  expect(request.mock.calls.map((call) => call[1])).toEqual(['zh-CN', 'fr', 'ar']);
});
