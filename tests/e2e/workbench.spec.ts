import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createWorkbench } from '../../src/workbench/server';
import { paperPdf, pagedPdf } from './pdf-fixture';
let server: Server, model: Server, browser: Browser, base: string, modelBase: string, temp: string;
const calls: any[] = [];
let mode = 'stream';
const original =
  'The ephemeral lantern reveals a serendipitous discovery. The ephemeral glow fades.';
function epubFixture() {
  return Buffer.from(
    zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
      ),
      'book.opf': strToU8(
        '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Public story</dc:title><dc:language>en</dc:language></metadata><manifest><item id="a" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
      ),
      'chapter.xhtml': strToU8(
        `<html><body><h1>Public chapter</h1><p>${original}</p><script>fetch('https://example.test/leak')</script></body></html>`,
      ),
    }),
  );
}
test.beforeAll(async () => {
  temp = await mkdtemp(path.resolve('.cache/workbench-e2e-'));
  model = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    calls.push(payload);
    if (mode === 'error') {
      res.writeHead(429);
      res.end('{}');
      return;
    }
    const input = JSON.parse(payload.messages[1].content);
    if (input.operation !== 'analyze') {
      const output =
        input.operation === 'choice'
          ? {
              question: '原文描述了什么？',
              options: [
                { id: 'A', text: '保护示例' },
                { id: 'B', text: '删除示例' },
                { id: 'C', text: '拒绝示例' },
                { id: 'D', text: '忽略示例' },
              ],
              correctOption: 'A',
              explanation: '原文描述了保护作用。',
              evidence: input.context.text,
            }
          : input.mode === 'translate'
            ? { translation: '这段原文描述了保护公开示例的假设。' }
            : {
                meaning: '保护假设',
                expansion: '',
                evidence: input.context.text,
                ambiguity: '',
                explanation: '这是结合所选原文的解释。',
                example: '',
                prerequisites: [],
                translation: '',
              };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
      return;
    }
    const items = input.candidates.map((c: any) =>
      mode === 'skip' && c.anchor.toLowerCase() === 'attestation'
        ? { id: c.id, skip: true }
        : {
            id: c.id,
            meaning: c.anchor === 'ephemeral' ? '短暂的' : '语境含义',
            summary: '在这里描述稍纵即逝的事物。',
            expansion:
              mode === 'ambiguous'
                ? ''
                : c.anchor === 'LLM'
                  ? 'Large Language Model'
                  : c.anchor === 'TEE'
                    ? 'Trusted Execution Environment'
                    : '',
          },
    );
    if (mode === 'stream' || mode === 'skip') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = (content: string) =>
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
      event('{"items":[' + JSON.stringify(items[0]));
      await new Promise((r) => setTimeout(r, 600));
      event(
        items
          .slice(1)
          .map((c: any) => ',' + JSON.stringify(c))
          .join('') + ']}',
      );
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
    }
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  modelBase = `http://127.0.0.1:${(model.address() as any).port}`;
  server = createWorkbench(process.cwd(), temp);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const response = await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'SAVE_SETTINGS',
      config: {
        baseUrl: modelBase + '/v1',
        model: 'fixture-model',
        apiKey: 'fixture-key',
        profile: { domain: '外语阅读', level: '入门' },
        tuning: { fast: true, reasoningEffort: 'none' },
      },
    }),
  });
  expect((await response.json()).ok).toBe(true);
  browser = await chromium.launch({
    executablePath: process.env.EASY_LEARN_CHROMIUM,
    headless: true,
  });
});
test.beforeEach(async () => {
  mode = 'stream';
  await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'SET_READING_PREFS', prefs: { concurrency: 1, batchSize: 4 } }),
  });
});
test.afterAll(async () => {
  await browser?.close();
  await Promise.all([
    new Promise<void>((r) => server?.close(() => r())),
    new Promise<void>((r) => model?.close(() => r())),
  ]);
  await rm(temp, { recursive: true, force: true });
});
async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(base);
  return { context, page };
}
test('desktop exit guards unsaved PDF annotations and releases the reading interface after export', async () => {
  const data = await mkdtemp(path.join(temp, 'desktop-exit-'));
  let stopped = 0;
  const fresh = createWorkbench(process.cwd(), data, {
    version: 'fixture',
    token: 'a'.repeat(64),
    onQuit: () => {
      stopped++;
      fresh.close();
      fresh.closeAllConnections();
    },
  });
  await new Promise<void>((r) => fresh.listen(0, '127.0.0.1', r));
  const address = `http://127.0.0.1:${(fresh.address() as any).port}`;
  const context = await browser.newContext(),
    page = await context.newPage();
  try {
    await page.goto(address);
    await page
      .getByRole('region', { name: '工作台设置' })
      .getByRole('button', { name: '完成', exact: true })
      .click();
    await page
      .locator('#reader-file')
      .setInputFiles({ name: 'exit.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
    await page.getByRole('button', { name: '文字批注', exact: true }).click();
    await page
      .locator('.page[data-page-number="1"] .annotationEditorLayer')
      .click({ position: { x: 110, y: 330 } });
    await page.locator('.freeTextEditor [contenteditable="true"]').fill('Exit note');
    const dialog = page.waitForEvent('dialog'),
      click = page.getByRole('button', { name: '退出软件', exact: true }).click();
    await (await dialog).dismiss();
    await click;
    expect(stopped).toBe(0);
    await expect(page.locator('.freeTextEditor')).toContainText('Exit note');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出含批注 PDF', exact: true }).click();
    await download;
    await page.getByRole('button', { name: '退出软件', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '阅读服务已退出' })).toBeVisible();
    expect(stopped).toBe(1);
    await expect(page.locator('.pdfViewer')).toHaveCount(0);
  } finally {
    await context.close();
    await new Promise<void>((r) => fresh.close(() => r()));
  }
});
test('first-run connection needs only a provider and key, preserves session drafts and permits reading before AI setup', async () => {
  const data = await mkdtemp(path.join(temp, 'first-run-')),
    fresh = createWorkbench(process.cwd(), data);
  await new Promise<void>((r) => fresh.listen(0, '127.0.0.1', r));
  const address = `http://127.0.0.1:${(fresh.address() as any).port}`;
  const context = await browser.newContext(),
    page = await context.newPage();
  const before = calls.length;
  try {
    await page.goto(address);
    const setup = page.getByRole('region', { name: '工作台设置' });
    await expect(setup).toBeVisible();
    await expect(page.getByLabel('服务方案')).toHaveValue('deepseek');
    await expect(page.getByLabel('API Base URL')).not.toBeVisible();
    await page.getByLabel('API Key / CPA 访问密钥').fill('first-draft');
    await page.getByLabel('服务方案').selectOption('zhipu');
    await expect(page.getByLabel('API Key / CPA 访问密钥')).toHaveValue('');
    await page.getByLabel('API Key / CPA 访问密钥').fill('second-draft');
    await page.getByLabel('服务方案').selectOption('deepseek');
    await expect(page.getByLabel('API Key / CPA 访问密钥')).toHaveValue('first-draft');
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(setup.getByRole('status')).toContainText('连接已保存');
    const settings = await (
      await fetch(address + '/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'GET_SETTINGS' }),
      })
    ).json();
    expect(settings.data.config).toMatchObject({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'first-draft',
    });
    expect(calls.length).toBe(before);
    await setup.getByRole('button', { name: '完成', exact: true }).click();
    await page.locator('#reader-file').setInputFiles({
      name: 'offline.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(original),
    });
    await expect(page.getByTestId('reader-prose')).toHaveText(original);
    expect(calls.length).toBe(before);
  } finally {
    await context.close();
    await new Promise<void>((r) => fresh.close(() => r()));
  }
});
async function importText(page: Page) {
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'public.txt', mimeType: 'text/plain', buffer: Buffer.from(original) });
  await expect(page.getByTestId('reader-prose')).toHaveText(original);
}
test('imports text, streams meanings, preserves source and makes hover free; exports Anki and hides known words', async () => {
  const { context, page } = await open();
  await importText(page);
  const before = calls.length;
  await expect(page.locator('.reader-word')).not.toHaveCount(0);
  expect(calls.length).toBe(before);
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  const word = page.locator('.reader-word').filter({ hasText: 'ephemeral' }).first();
  await expect(word).toHaveClass(/is-ready/);
  await word.hover();
  await expect(page.getByRole('heading', { name: '短暂的' })).toBeVisible();
  await expect(page.getByTestId('reader-prose')).toHaveText(original);
  await expect.poll(() => page.locator('.reader-progress').innerText()).not.toContain('正在准备');
  const count = calls.length;
  await word.hover();
  await word.focus();
  await page.waitForTimeout(200);
  expect(calls.length).toBe(count);
  expect(calls[count - 1]).toMatchObject({ service_tier: 'priority', reasoning_effort: 'none' });
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出到 Anki（TSV）' }).click();
  expect((await download).suggestedFilename()).toBe('Easy-Learn-vocabulary.tsv');
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  await word.hover();
  await page.getByRole('button', { name: '已认识', exact: true }).click();
  await expect(page.locator('.reader-word').filter({ hasText: 'ephemeral' })).toHaveCount(0);
  await expect(page.getByTestId('reader-prose')).toHaveText(original);
  await page.screenshot({ path: '.cache/reader-reading.png', fullPage: true });
  await context.close();
});
test('opens EPUB and Markdown without requesting models or mounting scripts', async () => {
  const { context, page } = await open();
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const before = calls.length;
  await page.locator('#reader-file').setInputFiles({
    name: 'public.epub',
    mimeType: 'application/epub+zip',
    buffer: epubFixture(),
  });
  await expect(page.getByTestId('reader-prose')).toContainText(original);
  await expect(page.getByRole('heading', { name: 'Public chapter' })).toBeVisible();
  expect(requests.some((r) => r.includes('example.test'))).toBe(false);
  await page.locator('#reader-file').setInputFiles({
    name: 'public.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# First\n\n' + original + '\n\n## Second\n\nA luminous feather.'),
  });
  await expect(
    page.getByRole('navigation', { name: '章节目录' }).getByRole('button', { name: 'Second' }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: '章节目录' })
    .getByRole('button', { name: 'Second' })
    .click();
  await expect(page.getByTestId('reader-prose')).toContainText('A luminous feather.');
  expect(calls.length).toBe(before);
  await page.reload();
  await page.locator('#reader-file').setInputFiles({
    name: 'public.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# First\n\n' + original + '\n\n## Second\n\nA luminous feather.'),
  });
  await expect(page.getByTestId('reader-prose')).toContainText('A luminous feather.');
  await context.close();
});
test('extracts a local PDF without an extension or model request', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page.locator('#reader-file').setInputFiles({
    name: 'public.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile('tests/fixtures/sample.pdf'),
  });
  await expect(page.getByTestId('pdf-canvas')).toBeVisible();
  await page.getByRole('button', { name: '文字伴读', exact: true }).click();
  await expect(page.getByTestId('reader-prose')).not.toBeEmpty();
  await expect(page.getByRole('navigation', { name: '章节目录' })).not.toContainText('第 1 页');
  expect(calls.length).toBe(before);
  await context.close();
});
test('keeps PDF figures, nested bookmarks and cross-page sections, with hover-free original annotations', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'paper.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  const nav = page.getByRole('navigation', { name: '章节目录' });
  await expect(nav.getByRole('button', { name: '1.1 Threat Model', exact: true })).toHaveAttribute(
    'data-depth',
    '1',
  );
  await expect(nav).not.toContainText('第 1 页');
  const canvas = page.getByTestId('pdf-canvas').first();
  await expect
    .poll(() =>
      canvas.evaluate((el) => {
        const c = el as HTMLCanvasElement;
        if (!c.width) return false;
        const rgba = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < rgba.length; i += 4)
          if (rgba[i] > 240 && rgba[i + 1] < 20 && rgba[i + 2] < 20) return true;
        return false;
      }),
    )
    .toBe(true);
  expect(calls.length).toBe(before);
  await nav.getByRole('button', { name: '1 Introduction', exact: true }).click();
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  const word = page.locator('.pdf-word.is-ready').filter({ hasText: 'Cryptographic' }).first();
  await expect(word).toBeVisible();
  await expect(page.locator('.pdf-word.is-ready').filter({ hasText: 'veri-' })).toHaveAttribute(
    'aria-label',
    /^verifiable：/,
  );
  await expect(page.locator('.pdf-word.is-ready').filter({ hasText: 'fiable' })).toHaveAttribute(
    'aria-label',
    /^verifiable：/,
  );
  await expect.poll(() => page.locator('.reader-progress').innerText()).not.toContain('正在准备');
  const count = calls.length;
  await word.hover();
  await expect(page.getByRole('complementary', { name: '词语释义' })).toContainText(
    'Cryptographic',
  );
  expect(calls.length).toBe(count);
  await nav.getByRole('button', { name: '1.1 Threat Model', exact: true }).click();
  await page.getByRole('button', { name: '文字伴读', exact: true }).click();
  await expect(page.getByTestId('reader-prose')).toContainText('This paragraph continues');
  await page.getByRole('button', { name: '原版（含图表）', exact: true }).click();
  await nav.getByRole('button', { name: '2 Evaluation', exact: true }).click();
  await expect(page.locator('.page[data-page-number="2"] canvas').first()).toHaveAttribute(
    'data-rendered-page',
    '2',
  );
  await page.screenshot({ path: '.cache/pdf-structured-reader.png', fullPage: true });
  await context.close();
});
test('infers PDF headings without bookmarks and displays image-only files without pretending they have text', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page.locator('#reader-file').setInputFiles({
    name: 'unbookmarked.pdf',
    mimeType: 'application/pdf',
    buffer: paperPdf(false),
  });
  await expect(
    page
      .getByRole('navigation', { name: '章节目录' })
      .getByRole('button', { name: '1.1 Threat Model', exact: true }),
  ).toHaveAttribute('data-depth', '1');
  await page.locator('#reader-file').setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: paperPdf(false, true),
  });
  await expect(page.getByText(/此文件没有文字层/)).toBeVisible();
  await expect(page.locator('.pdfViewer .page')).toHaveCount(1);
  await expect(page.getByTestId('pdf-canvas')).toBeVisible();
  expect(calls.length).toBe(before);
  await context.close();
});
test('pauses on a rate limit and retries only when the user continues', async () => {
  const { context, page } = await open();
  await importText(page);
  mode = 'error';
  const before = calls.length;
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('限流');
  await page.waitForTimeout(300);
  expect(calls.length).toBe(before + 1);
  mode = 'json';
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  await expect(page.locator('.reader-word.is-ready').first()).toBeVisible();
  await context.close();
});
test('rejects other websites, forged hosts, and path traversal at the local service boundary', async () => {
  const post = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.test' },
    body: JSON.stringify({ type: 'GET_SETTINGS' }),
  };
  expect((await fetch(base + '/api/rpc', post)).status).toBe(403);
  const forged = await new Promise<number>((resolve) => {
    const request = httpRequest(
      base + '/api/rpc',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'attacker.test' } },
      (response) => {
        resolve(response.statusCode!);
        response.resume();
      },
    );
    request.end(JSON.stringify({ type: 'GET_SETTINGS' }));
  });
  expect(forged).toBe(403);
  expect((await fetch(base + '/%2e%2e%2fpackage.json')).status).toBe(403);
});
test('keeps the reading UI usable at phone width and in dark mode', async () => {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
    }),
    page = await context.newPage();
  await page.goto(base);
  await page.screenshot({ path: '.cache/reader-welcome-dark.png', fullPage: true });
  await importText(page);
  await expect(page.getByRole('button', { name: '开启伴读', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await context.close();
});

test('PDF supports continuous scrolling, actual size, fit modes, slider zoom and confirmed page jumps', async () => {
  const { context, page } = await open();
  const failures: string[] = [];
  page.on('pageerror', (e) => {
    failures.push(e.message);
  });
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'controls.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  const viewport = page.getByTestId('pdf-scroll-container'),
    mode = page.getByRole('combobox', { name: '缩放模式' }),
    input = page.getByRole('textbox', { name: '跳转页码' });
  const first = page.locator('.pdfViewer .page[data-page-number="1"]');
  await expect(first.locator('canvas').first()).toHaveAttribute('data-rendered-page', '1');
  await expect(page.getByRole('checkbox', { name: '连续阅读' })).toBeChecked();
  await expect(page.locator('.pdfViewer .page')).toHaveCount(2);
  await mode.selectOption('page-actual');
  await expect
    .poll(() => first.evaluate((el) => el.getBoundingClientRect().width))
    .toBeCloseTo(816, 0);
  await expect(page.locator('.pdf-zoom-slider output')).toHaveText('100%');
  expect(await viewport.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await mode.selectOption('page-fit');
  await expect
    .poll(() => first.evaluate((el) => el.getBoundingClientRect().height))
    .toBeLessThanOrEqual(await viewport.evaluate((el) => el.clientHeight));
  await mode.selectOption('page-width');
  await expect
    .poll(async () =>
      Math.abs(
        (await first.evaluate((el) => el.getBoundingClientRect().width)) -
          (await viewport.evaluate((el) => el.clientWidth - 40)),
      ),
    )
    .toBeLessThanOrEqual(2);
  const slider = page.getByRole('slider', { name: '缩放比例' });
  await slider.fill('150');
  await expect(mode).toHaveValue('custom');
  await expect(page.locator('.pdf-zoom-slider output')).toHaveText('150%');
  await expect
    .poll(() => first.evaluate((el) => el.getBoundingClientRect().width))
    .toBeCloseTo(1224, 0);
  await input.fill('2');
  await expect(viewport).toHaveAttribute('data-current-page', '1');
  await input.press('Enter');
  await expect(viewport).toHaveAttribute('data-current-page', '2');
  await expect(page.locator('.page[data-page-number="2"] canvas').first()).toHaveAttribute(
    'data-rendered-page',
    '2',
  );
  await input.fill('0');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1–2');
  await expect(viewport).toHaveAttribute('data-current-page', '2');
  await input.fill('1.5');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await input.fill('3');
  await input.press('Enter');
  await expect(viewport).toHaveAttribute('data-current-page', '2');
  await input.fill('1');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-current-page', '1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await mode.selectOption('page-width');
  await viewport.evaluate((el) => {
    el.scrollTop = el.querySelector<HTMLElement>('.page[data-page-number="2"]')!.offsetTop;
  });
  await expect(input).toHaveValue('2');
  await page.getByRole('checkbox', { name: '连续阅读' }).uncheck();
  await expect(page.locator('.pdfViewer .page')).toHaveCount(1);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(input).toHaveValue('1');
  await page.getByRole('checkbox', { name: '连续阅读' }).check();
  await expect(page.locator('.pdfViewer .page')).toHaveCount(2);
  await mode.selectOption('page-fit');
  const widthBefore = await first.evaluate((el) => el.getBoundingClientRect().width);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect
    .poll(() => first.evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThan(widthBefore);
  expect(calls.length).toBe(before);
  expect(failures).toEqual([]);
  await page.screenshot({ path: '.cache/pdf-controls.png', fullPage: true });
  await context.close();
});

test('PDF abbreviation annotations show English expansions and retain them in the vocabulary book', async () => {
  const { context, page } = await open();
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'acronyms.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page
    .getByRole('navigation', { name: '章节目录' })
    .getByRole('button', { name: '2 Evaluation', exact: true })
    .click();
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  const llm = page.locator('.pdf-word.is-ready').filter({ hasText: /^LLM$/ }),
    tee = page.locator('.pdf-word.is-ready').filter({ hasText: /^TEE$/ });
  await expect(llm).toBeVisible();
  await expect(tee).toBeVisible();
  await expect.poll(() => page.locator('.reader-progress').innerText()).not.toContain('正在准备');
  // Freeze preloading while measuring hover/zoom: layout changes can legitimately change the observed page and preload scope.
  await page.getByRole('button', { name: '暂停伴读', exact: true }).click();
  await expect.poll(() => page.locator('.reader-progress').innerText()).not.toContain('正在准备');
  const before = calls.length;
  await llm.hover();
  const inspector = page.getByRole('complementary', { name: '词语释义' });
  await expect(inspector.getByLabel('英文全称')).toHaveText('Large Language Model');
  await expect(llm).toHaveAttribute('title', /Large Language Model/);
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await tee.hover();
  await expect(inspector.getByLabel('英文全称')).toHaveText('Trusted Execution Environment');
  const relativePosition = () =>
    llm.evaluate((el) => {
      const word = el.getBoundingClientRect(),
        paper = el.closest('.page')!.getBoundingClientRect();
      return { left: (word.left - paper.left) / paper.width, width: word.width / paper.width };
    });
  const beforeZoom = await relativePosition();
  await page.getByRole('slider', { name: '缩放比例' }).fill('175');
  await expect(llm).toBeVisible();
  await llm.hover();
  await expect(inspector.getByLabel('英文全称')).toHaveText('Large Language Model');
  await expect
    .poll(async () => Math.abs((await relativePosition()).left - beforeZoom.left))
    .toBeLessThan(0.002);
  await expect
    .poll(async () => Math.abs((await relativePosition()).width - beforeZoom.width))
    .toBeLessThan(0.002);
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  await expect(page.getByRole('region', { name: '生词本' })).toContainText('Large Language Model');
  expect(calls.length).toBe(before);
  await context.close();
});

test('PDF fit width and enlarged pages stay inside the reader at phone width', async () => {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
    }),
    page = await context.newPage();
  await page.goto(base);
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'phone.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await expect(page.getByRole('combobox', { name: '缩放模式' })).toBeEnabled();
  await expect(page.getByTestId('pdf-canvas').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('slider', { name: '缩放比例' }).fill('200');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page
      .getByTestId('pdf-scroll-container')
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  await page.getByRole('textbox', { name: '跳转页码' }).fill('2');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.getByTestId('pdf-scroll-container')).toHaveAttribute('data-current-page', '2');
  expect(calls.length).toBe(before);
  await page.screenshot({ path: '.cache/pdf-controls-phone.png', fullPage: true });
  await context.close();
});

test('long PDFs render lazily, jump directly to the last page and discard the previous document', async () => {
  const { context, page } = await open();
  const failures: string[] = [];
  page.on('pageerror', (e) => {
    failures.push(e.message);
  });
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: pagedPdf() });
  await expect(page.locator('.pdfViewer .page')).toHaveCount(24);
  await expect(page.getByTestId('pdf-canvas').first()).toBeVisible();
  expect(await page.getByTestId('pdf-canvas').count()).toBeLessThan(24);
  await page.getByRole('textbox', { name: '跳转页码' }).fill('24');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.getByTestId('pdf-scroll-container')).toHaveAttribute('data-current-page', '24');
  await expect(page.locator('.page[data-page-number="24"] canvas').first()).toHaveAttribute(
    'data-rendered-page',
    '24',
  );
  expect(await page.getByTestId('pdf-canvas').count()).toBeLessThan(24);
  await page.getByRole('slider', { name: '缩放比例' }).fill('400');
  await page.getByRole('slider', { name: '缩放比例' }).fill('75');
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await expect(page.getByRole('heading', { name: 'replacement.pdf', exact: true })).toBeVisible();
  await expect(page.locator('.pdfViewer .page')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: '跳转页码' })).toHaveValue('1');
  await expect(page.locator('.page[data-page-number="1"] canvas').first()).toHaveAttribute(
    'data-rendered-page',
    '1',
  );
  expect(calls.length).toBe(before);
  expect(failures).toEqual([]);
  await context.close();
});

test('unresolved abbreviation full names remain uncertain after saving, reload and Anki export', async () => {
  const { context, page } = await open();
  mode = 'ambiguous';
  await page.locator('#reader-file').setInputFiles({
    name: 'unknown.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('An LLM processes text in this model. The original has no definition.'),
  });
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  const word = page.locator('.reader-word.is-ready').filter({ hasText: /^LLM$/ });
  await expect(word).toBeVisible();
  await word.hover();
  const notice = '未提供英文全称，需结合更多上下文确认。';
  await expect(page.getByRole('complementary', { name: '词语释义' })).toContainText(notice);
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  await expect(page.getByRole('region', { name: '生词本' })).toContainText(notice);
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  await expect(page.getByRole('region', { name: '生词本' })).toContainText(notice);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出到 Anki（TSV）' }).click();
  const download = await waiting,
    file = await download.path();
  const tsv = (await readFile(file!, 'utf8')).replace(/^\uFEFF/, '');
  expect(tsv.split('\t')).toHaveLength(4);
  expect(tsv).toContain(notice);
  await context.close();
});

async function selectPdfLine(page: Page, text: string) {
  const line = page
    .locator('.page[data-page-number="1"] .textLayer span[role="presentation"]')
    .filter({ hasText: text })
    .first();
  await line.scrollIntoViewIfNeeded();
  const box = await line.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 1, box!.y + box!.height / 2, { steps: 12 });
  await page.mouse.up();
}
test('PDF hand tool pans enlarged pages and directory navigation blinks the original heading twice', async () => {
  const { context, page } = await open();
  const failures: string[] = [];
  page.on('pageerror', (e) => {
    failures.push(e.message);
  });
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'interaction.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  const viewport = page.getByTestId('pdf-scroll-container');
  await expect(page.getByRole('button', { name: '拖动', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('slider', { name: '缩放比例' }).fill('200');
  await viewport.scrollIntoViewIfNeeded();
  await viewport.evaluate((el) => {
    el.scrollLeft = 200;
    el.scrollTop = 200;
  });
  const bounds = await viewport.boundingBox();
  const start = await viewport.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
  await page.mouse.move(bounds!.x + 220, bounds!.y + 230);
  expect(await viewport.evaluate((el) => getComputedStyle(el).cursor)).toBe('grab');
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 120, bounds!.y + 130, { steps: 8 });
  await expect(viewport).toHaveClass(/is-grabbing/);
  await page.mouse.up();
  await expect(viewport).not.toHaveClass(/is-grabbing/);
  const end = await viewport.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
  expect(end.x - start.x).toBeCloseTo(100, 0);
  expect(end.y - start.y).toBeCloseTo(100, 0);
  await page.getByRole('combobox', { name: '缩放模式' }).selectOption('page-width');
  const nav = page.getByRole('navigation', { name: '章节目录' });
  await nav.getByRole('button', { name: '1.1 Threat Model', exact: true }).click();
  const target = page.locator('.textLayer [data-navigation-target="1.1 Threat Model"]');
  await expect(target).toContainText('Threat Model');
  await expect
    .poll(() =>
      target.evaluate((el) =>
        el.getAnimations().some((a) => a.effect?.getTiming().iterations === 2),
      ),
    )
    .toBe(true);
  const position = await target.boundingBox(),
    frame = await viewport.boundingBox();
  expect(position!.y).toBeGreaterThanOrEqual(frame!.y);
  expect(position!.y + position!.height).toBeLessThan(frame!.y + frame!.height);
  await nav.getByRole('button', { name: '2 Evaluation', exact: true }).click();
  await expect(
    page.locator('.page[data-page-number="2"] .textLayer [data-navigation-target="2 Evaluation"]'),
  ).toContainText('Evaluation');
  expect(calls.length).toBe(before);
  expect(failures).toEqual([]);
  await context.close();
});
test('PDF selected text reuses explanation, translation and quiz without sending the full paper', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'study.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await expect(page.getByRole('button', { name: '解释', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '选择文字', exact: true }).click();
  await selectPdfLine(page, 'The ephemeral assumption');
  await expect(page.getByRole('button', { name: '解释', exact: true })).toBeEnabled();
  expect(calls.length).toBe(before);
  await page.getByRole('button', { name: '解释', exact: true }).click();
  const study = page.getByRole('region', { name: '选段学习' });
  await expect(study).toContainText('这是结合所选原文的解释。');
  const input = JSON.parse(calls.at(-1).messages[1].content);
  expect(input.context.text).toContain('ephemeral assumption');
  expect(input.context.text).not.toContain('Cryptographic');
  expect(input.mode).toBe('explain');
  await page.getByRole('button', { name: '关闭选段学习' }).click();
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  await expect(study).toContainText('这段原文描述了保护公开示例的假设。');
  await page.getByRole('button', { name: '关闭选段学习' }).click();
  await page.getByRole('button', { name: '考考我', exact: true }).click();
  await expect(study.getByRole('radiogroup')).toBeVisible();
  await expect(study.getByText('正确答案 · A')).toHaveCount(0);
  await study.getByRole('radio').first().check();
  await expect(study).toContainText('答对了');
  expect(JSON.parse(calls.at(-1).messages[1].content).operation).toBe('choice');
  await context.close();
});
test('native PDF highlights, arbitrary notes and ink export into a reopenable PDF and survive view changes', async () => {
  const { context, page } = await open();
  const failures: string[] = [];
  page.on('pageerror', (e) => {
    failures.push(e.message);
  });
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'edit.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page.getByRole('button', { name: '高亮文字', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择文字', exact: true })).toBeEnabled();
  await selectPdfLine(page, 'The ephemeral assumption');
  await expect(page.locator('.highlightEditor')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.highlightEditor')).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.highlightEditor')).toHaveCount(1);
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  const layer = page.locator('.page[data-page-number="1"] .annotationEditorLayer');
  await expect(page.getByRole('button', { name: '选择文字', exact: true })).toBeEnabled();
  await layer.click({ position: { x: 100, y: 350 } });
  const note = page.locator('.freeTextEditor [contenteditable="true"]');
  await expect(note).toBeVisible();
  await note.fill('复核笔记 Review note');
  await page.getByRole('button', { name: '画笔标记', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择文字', exact: true })).toBeEnabled();
  const box = await layer.boundingBox();
  await page.mouse.move(box!.x + 200, box!.y + 380);
  await page.mouse.down();
  await page.mouse.move(box!.x + 240, box!.y + 390, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '选择文字', exact: true }).click();
  await expect(page.locator('.inkEditor')).toHaveCount(1);
  await page.getByRole('button', { name: '文字伴读', exact: true }).click();
  await page.getByRole('button', { name: '原版（含图表）', exact: true }).click();
  await expect(page.locator('.freeTextEditor')).toContainText('Review note');
  await expect(page.locator('.highlightEditor')).toHaveCount(1);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出含批注 PDF', exact: true }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('edit-批注.pdf');
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByRole('heading', { name: 'saved.pdf', exact: true })).toBeVisible();
  await expect(page.getByTestId('pdf-canvas').first()).toBeVisible();
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  await expect(page.locator('.freeTextEditor')).toContainText('Review note');
  await expect(page.locator('.highlightEditor')).toHaveCount(1);
  await expect(page.locator('.inkEditor')).toHaveCount(1);
  expect(calls.length).toBe(before);
  expect(failures).toEqual([]);
  await page.screenshot({ path: '.cache/pdf-editing.png', fullPage: true });
  await context.close();
});

test('PDF selection survives streamed word meanings and text view provides the same study actions', async () => {
  const { context, page } = await open();
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'stream-study.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page
    .getByRole('navigation', { name: '章节目录' })
    .getByRole('button', { name: '1 Introduction', exact: true })
    .click();
  await page.getByRole('button', { name: '选择文字', exact: true }).click();
  const started = page.waitForResponse((r) => r.url().endsWith('/api/analyze'));
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  await started;
  await selectPdfLine(page, 'Cryptographic attestation');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain('attestation');
  await expect.poll(() => page.locator('.reader-progress').innerText()).not.toContain('正在准备');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await page.getByRole('button', { name: '文字伴读', exact: true }).click();
  await page.getByTestId('reader-prose').evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  });
  await page.getByRole('button', { name: '解释', exact: true }).click();
  await expect(page.getByRole('region', { name: '选段学习' })).toContainText(
    '这是结合所选原文的解释。',
  );
  await context.close();
});
test('PDF rejects replacement of unsaved notes when the reader cancels and exports active text before closing it', async () => {
  const { context, page } = await open();
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'unsaved.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  const layer = page.locator('.page[data-page-number="1"] .annotationEditorLayer');
  await layer.click({ position: { x: 110, y: 330 } });
  const note = page.locator('.freeTextEditor [contenteditable="true"]');
  await note.fill('Keep this note');
  const dialog = page.waitForEvent('dialog');
  const replacement = page
    .locator('#reader-file')
    .setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await (await dialog).dismiss();
  await replacement;
  await expect(page.getByRole('heading', { name: 'unsaved.pdf', exact: true })).toBeVisible();
  await expect(note).toContainText('Keep this note');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出含批注 PDF', exact: true }).click();
  const bytes = await readFile((await (await waiting).path())!);
  expect(bytes.toString()).toContain('/Contents (Keep this note)');
  await expect(page.getByRole('button', { name: '导出含批注 PDF', exact: true })).toBeEnabled();
  await context.close();
});

test('PDF protects post-export undo mutations from unsaved replacement', async () => {
  const { context, page } = await open();
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'saved-session.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  await page
    .locator('.page[data-page-number="1"] .annotationEditorLayer')
    .click({ position: { x: 110, y: 330 } });
  await page.locator('.freeTextEditor [contenteditable="true"]').fill('Saved note');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出含批注 PDF', exact: true }).click();
  await waiting;
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.freeTextEditor')).toHaveCount(0);
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await expect.poll(() => messages.length).toBe(1);
  await expect(page.getByRole('heading', { name: 'saved-session.pdf', exact: true })).toBeVisible();
  await context.close();
});
test('PDF prevents old-document edits during delayed replacement import', async () => {
  const { context, page } = await open();
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'old.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择文字', exact: true })).toBeEnabled();
  const layer = page.locator('.page[data-page-number="1"] .annotationEditorLayer');
  await layer.click({ position: { x: 110, y: 330 } });
  await page.locator('.freeTextEditor [contenteditable="true"]').fill('Saved before import');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出含批注 PDF', exact: true }).click();
  await waiting;
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择文字', exact: true })).toBeEnabled();
  const box = await layer.boundingBox();
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'delayed.pdf')
        await new Promise<void>((resolve) => {
          (window as any).finishImport = resolve;
        });
      return read.call(this);
    };
  });
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'delayed.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await expect(page.getByText('正在读取文件', { exact: true })).toBeVisible();
  await page.mouse.click(box!.x + 210, box!.y + 330);
  await page.keyboard.type('Late note');
  await expect(page.locator('.freeTextEditor')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.freeTextEditor')).toHaveCount(1);
  await expect(page.locator('.freeTextEditor')).toContainText('Saved before import');
  await page.evaluate(() => (window as any).finishImport());
  await expect(page.getByRole('heading', { name: 'delayed.pdf', exact: true })).toBeVisible();
  await context.close();
});
test('PDF selection survives a streamed skip that removes a selected candidate', async () => {
  const { context, page } = await open();
  mode = 'skip';
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'skip-study.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page
    .getByRole('navigation', { name: '章节目录' })
    .getByRole('button', { name: '1 Introduction', exact: true })
    .click();
  await page.getByRole('button', { name: '选择文字', exact: true }).click();
  const started = page.waitForResponse((r) => r.url().endsWith('/api/analyze'));
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  await started;
  await selectPdfLine(page, 'Cryptographic attestation');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain('attestation');
  await expect.poll(() => page.locator('.reader-progress').innerText()).not.toContain('正在准备');
  await expect(page.locator('.pdf-word').filter({ hasText: /^attestation$/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await context.close();
});
