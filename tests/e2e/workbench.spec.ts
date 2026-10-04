import type { AddressInfo } from 'node:net';
import type { AIRequest } from '../../src/core/types';
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createWorkbench } from '../../src/workbench/server';
import { paperPdf, pagedPdf } from './pdf-fixture';
let server: Server, model: Server, browser: Browser, base: string, modelBase: string, temp: string;
const calls: { messages: { content: string }[]; [key: string]: unknown }[] = [];
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
    const input = JSON.parse(payload.messages[1].content) as AIRequest;
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
            ? {
                translation:
                  input.targetLanguage && input.targetLanguage !== 'zh-CN'
                    ? `${input.targetLanguage}：Translated public text.`
                    : '这段原文描述了保护公开示例的假设。',
              }
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
    const items = input.candidates!.map((c) =>
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
          .map((c) => ',' + JSON.stringify(c))
          .join('') + ']}',
      );
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
    }
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  modelBase = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
  server = createWorkbench(process.cwd(), temp);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
  const address = `http://127.0.0.1:${(fresh.address() as AddressInfo).port}`;
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
  const address = `http://127.0.0.1:${(fresh.address() as AddressInfo).port}`;
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
test('directory search retains original indices and locates the active chapter only on request', async () => {
  const { context, page } = await open();
  const before = calls.length;
  const chapters = Array.from(
    { length: 30 },
    (_, i) => `## Section ${String(i + 1).padStart(2, '0')}\n\nOriginal passage ${i + 1}.`,
  ).join('\n\n');
  const file = { name: 'navigation.md', mimeType: 'text/markdown', buffer: Buffer.from(chapters) };
  await page.locator('#reader-file').setInputFiles(file);
  const search = page.getByRole('searchbox', { name: '搜索章节标题' }),
    nav = page.getByRole('navigation', { name: '章节目录' });
  await expect(page.getByRole('button', { name: '前一章节', exact: true })).toBeDisabled();
  await search.fill('  SECTION 20  ');
  await expect(nav.getByRole('button')).toHaveCount(1);
  await nav.getByRole('button', { name: 'Section 20', exact: true }).click();
  await expect(page.getByTestId('reader-prose')).toContainText('Original passage 20.');
  await expect(page.getByRole('progressbar', { name: '章节位置' })).toHaveAttribute('value', '20');
  await search.fill('absent');
  await expect(nav.getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('reader-prose')).toContainText('Original passage 20.');
  await page.getByRole('button', { name: '定位当前章节', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(nav.getByRole('button', { name: 'Section 20', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '后一章节', exact: true }).click();
  await expect(page.getByTestId('reader-prose')).toContainText('Original passage 21.');
  await page.reload();
  await page.locator('#reader-file').setInputFiles(file);
  await expect(page.getByTestId('reader-prose')).toContainText('Original passage 21.');
  await search.fill('Section 30');
  await nav.getByRole('button', { name: 'Section 30', exact: true }).click();
  await expect(page.getByRole('button', { name: '后一章节', exact: true })).toBeDisabled();
  await page.locator('#reader-file').setInputFiles({
    name: 'replacement.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('## New title\n\nNew passage.'),
  });
  await expect(search).toHaveValue('');
  await expect(nav.getByRole('button', { name: 'New title', exact: true })).toBeVisible();
  expect(calls.length).toBe(before);
  await context.close();
});
test('focus mode keeps source nodes and learning controls, respects panels and exits with keyboard focus', async () => {
  const { context, page } = await open();
  await importText(page);
  const before = calls.length;
  const prose = page.getByTestId('reader-prose');
  await prose.evaluate((el) => {
    (window as Window & { readingNode?: Element }).readingNode = el;
  });
  await page.getByRole('button', { name: '专注阅读', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出专注', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('navigation', { name: '章节目录' })).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: '阅读字号' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '开启伴读', exact: true })).toBeVisible();
  await expect(prose).toHaveText(original);
  expect(
    await prose.evaluate((el) => el === (window as Window & { readingNode?: Element }).readingNode),
  ).toBe(true);
  await page.locator('.reader-word').first().focus();
  await expect(page.getByRole('complementary', { name: '词语释义' })).toBeVisible();
  await page.getByRole('button', { name: '粘贴文本', exact: true }).click();
  await page.getByRole('textbox', { name: '粘贴要读的外语原文' }).fill('Keep this draft');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '退出专注', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await prose.click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '专注阅读', exact: true })).toBeFocused();
  await expect(page.getByRole('navigation', { name: '章节目录' })).toBeVisible();
  expect(calls.length).toBe(before);
  await page.getByRole('button', { name: '专注阅读', exact: true }).click();
  await page.locator('#reader-file').setInputFiles({
    name: 'next.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A new reading session.'),
  });
  await expect(page.getByRole('button', { name: '专注阅读', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await context.close();
});
test('vocabulary search combines language and status filters and exports all learning words', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page.evaluate(() =>
    localStorage.setItem(
      'easy-learn-reader-words-v1',
      JSON.stringify({
        'en:ephemeral': {
          word: 'ephemeral',
          language: 'en',
          status: 'learning',
          meaning: '短暂的',
          summary: 'A fleeting glow',
        },
        'en:llm': {
          word: 'LLM',
          language: 'en',
          status: 'known',
          meaning: '语言模型',
          expansion: 'Large Language Model',
        },
        'fr:lumière': { word: 'lumière', language: 'fr', status: 'learning', meaning: '光线' },
      }),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 2', exact: true }).click();
  const vocabulary = page.getByRole('region', { name: '生词本' }),
    search = page.getByRole('searchbox', { name: '搜索生词和释义' });
  await expect(vocabulary.locator('.learned')).toHaveCount(3);
  await search.fill('  LARGE LANGUAGE  ');
  await expect(vocabulary.locator('.learned')).toHaveCount(1);
  await expect(vocabulary.locator('.learned')).toContainText('LLM');
  await vocabulary.getByRole('button', { name: '学习中 · 2', exact: true }).click();
  await expect(vocabulary.locator('.learned')).toHaveCount(0);
  await expect(vocabulary.getByText('没有匹配的词汇。')).toBeVisible();
  await vocabulary.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByRole('combobox', { name: '筛选词汇语言' }).selectOption('fr');
  await expect(vocabulary.locator('.learned')).toHaveCount(1);
  await search.fill('光线');
  await expect(vocabulary.locator('.learned')).toContainText('lumière');
  const waiting = page.waitForEvent('download');
  await vocabulary.getByRole('button', { name: '导出到 Anki（TSV）', exact: true }).click();
  const exported = await readFile((await (await waiting).path())!, 'utf8');
  expect(exported).toContain('ephemeral');
  expect(exported).toContain('lumière');
  expect(exported).not.toContain('LLM');
  await vocabulary.getByRole('button', { name: '移除 lumière', exact: true }).click();
  await expect(vocabulary.locator('.learned')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '筛选词汇语言' })).toHaveValue('fr');
  await vocabulary.getByRole('button', { name: '清除筛选', exact: true }).click();
  await search.fill('短暂');
  await expect(vocabulary.locator('.learned')).toContainText('ephemeral');
  await vocabulary.getByRole('button', { name: '移除 ephemeral', exact: true }).click();
  await vocabulary.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByRole('combobox', { name: '筛选词汇语言' }).selectOption('en');
  await vocabulary.getByRole('button', { name: '已认识 · 1', exact: true }).click();
  await search.fill('model');
  await vocabulary.getByRole('button', { name: '移除 LLM', exact: true }).click();
  await expect(vocabulary.getByText('在原文中点击一个标注的单词，就能收进生词本。')).toBeVisible();
  await vocabulary.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('combobox', { name: '筛选词汇语言' })).toHaveValue('all');
  await expect(vocabulary.getByRole('button', { name: '全部 · 0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await vocabulary.getByRole('button', { name: '关闭生词本', exact: true }).click();
  await expect(vocabulary).toHaveCount(0);
  expect(calls.length).toBe(before);
  await context.close();
});
test('vocabulary recall filters due words, hides references, persists progress and retries forgotten words offline', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page.evaluate(() =>
    localStorage.setItem(
      'easy-learn-reader-words-v1',
      JSON.stringify({
        'en:ephemeral': {
          word: 'ephemeral',
          language: 'en',
          status: 'learning',
          meaning: '短暂的',
          context: 'The ephemeral glow fades.',
        },
        'en:provenance': {
          word: 'provenance',
          language: 'en',
          status: 'learning',
          meaning: '来源',
          review: { dueAt: Date.now() + 86400000, step: 1, count: 2, lastReviewedAt: Date.now() },
        },
        'en:missing': { word: 'missing', language: 'en', status: 'learning' },
        'en:llm': { word: 'LLM', language: 'en', status: 'known', meaning: '大语言模型' },
        'fr:lumière': { word: 'lumière', language: 'fr', status: 'learning', meaning: '光线' },
      }),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 4', exact: true }).click();
  const vocabulary = page.getByRole('region', { name: '生词本' });
  await vocabulary.getByRole('combobox', { name: '筛选词汇语言' }).selectOption('en');
  await expect(
    vocabulary.getByRole('button', { name: '练习当前筛选 · 2', exact: true }),
  ).toBeEnabled();
  await expect(
    vocabulary.getByText('1 个学习中的词尚无释义，请先编辑补充，再开始回忆。'),
  ).toBeVisible();
  await vocabulary.getByRole('button', { name: '回忆到期生词 · 1', exact: true }).click();
  const review = vocabulary.getByRole('region', { name: '生词回忆' });
  await expect(review.getByRole('heading', { name: 'ephemeral', exact: true })).toBeVisible();
  await expect(review.getByText('短暂的', { exact: true })).toHaveCount(0);
  await expect(review.getByText('The ephemeral glow fades.', { exact: true })).toHaveCount(0);
  await review.getByRole('button', { name: '显示释义', exact: true }).click();
  await expect(review.getByText('短暂的', { exact: true })).toBeVisible();
  await expect(review.getByText('The ephemeral glow fades.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/vocabulary-review.png' });
  await review.getByRole('button', { name: '还没想起 · 1 天后', exact: true }).click();
  await expect(review.getByText('已记录 1 次回忆，1 个词还需练习。')).toBeVisible();
  await review.getByRole('button', { name: '重练未想起的词 · 1', exact: true }).click();
  await expect(review.getByText('短暂的', { exact: true })).toHaveCount(0);
  await review.getByRole('button', { name: '显示释义', exact: true }).click();
  await review.getByRole('button', { name: '能回忆 · 3 天后', exact: true }).click();
  await review.getByRole('button', { name: '返回生词本', exact: true }).click();
  await expect(
    vocabulary.getByRole('button', { name: '回忆到期生词 · 0', exact: true }),
  ).toBeDisabled();
  await page.reload();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('easy-learn-reader-words-v1')!)['en:ephemeral'],
  );
  expect(saved.review.count).toBe(2);
  expect(saved.review.step).toBe(1);
  expect(saved.review.dueAt - saved.review.lastReviewedAt).toBe(3 * 86400000);
  expect(saved.status).toBe('learning');
  expect(saved.context).toBe('The ephemeral glow fades.');
  expect(calls.length).toBe(before);
  await context.close();
});

test('vocabulary meaning and knowledge status can be corrected without AI', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page.evaluate(() =>
    localStorage.setItem(
      'easy-learn-reader-words-v1',
      JSON.stringify({
        'en:ephemeral': { word: 'ephemeral', language: 'en', status: 'learning' },
      }),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  const vocabulary = page.getByRole('region', { name: '生词本' });
  await expect(
    vocabulary.getByRole('button', { name: '回忆到期生词 · 0', exact: true }),
  ).toBeDisabled();
  await vocabulary.getByRole('button', { name: '编辑 ephemeral 的释义', exact: true }).click();
  await vocabulary.getByRole('textbox', { name: 'ephemeral 的释义', exact: true }).fill('短暂的');
  await vocabulary.getByRole('button', { name: '保存释义', exact: true }).click();
  await expect(
    vocabulary.getByRole('button', { name: '回忆到期生词 · 1', exact: true }),
  ).toBeEnabled();
  await vocabulary.getByRole('button', { name: '标为已认识 ephemeral', exact: true }).click();
  await expect(
    vocabulary.getByRole('button', { name: '回忆到期生词 · 0', exact: true }),
  ).toBeDisabled();
  await vocabulary.getByRole('button', { name: '重新学习 ephemeral', exact: true }).click();
  await expect(
    vocabulary.getByRole('button', { name: '回忆到期生词 · 1', exact: true }),
  ).toBeEnabled();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('easy-learn-reader-words-v1')!)['en:ephemeral'],
  );
  expect(saved.meaning).toBe('短暂的');
  expect(saved.status).toBe('learning');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    vocabulary.getByRole('button', { name: '回忆到期生词 · 1', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/vocabulary-mobile.png' });
  expect(calls.length).toBe(before);
  await context.close();
});

test('vocabulary review skips records changed in another tab and keeps failed saves retryable', async () => {
  const { context, page } = await open();
  await page.evaluate(() =>
    localStorage.setItem(
      'easy-learn-reader-words-v1',
      JSON.stringify({
        'en:ephemeral': {
          word: 'ephemeral',
          language: 'en',
          status: 'learning',
          meaning: '短暂的',
        },
      }),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  await page.getByRole('button', { name: '回忆到期生词 · 1', exact: true }).click();
  const review = page.getByRole('region', { name: '生词回忆' });
  await review.getByRole('button', { name: '显示释义', exact: true }).click();
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'easy-learn-reader-words-v1') throw new Error('模拟存储空间不足');
      return originalSetItem.call(this, key, value);
    };
  });
  await review.getByRole('button', { name: '能回忆 · 1 天后', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('模拟存储空间不足');
  await expect(review.getByRole('button', { name: '能回忆 · 1 天后', exact: true })).toBeEnabled();
  const other = await context.newPage();
  await other.goto(base);
  await other.evaluate(() => localStorage.setItem('easy-learn-reader-words-v1', '{}'));
  await expect(review.getByText('这条词汇已更新或移除，本次跳过。')).toBeVisible();
  await review.getByRole('button', { name: '跳过此词', exact: true }).click();
  await expect(review.getByText('已记录 0 次回忆，0 个词还需练习。')).toBeVisible();
  await context.close();
});

test('recollecting a reviewed legacy word preserves progress without false update conflicts', async () => {
  const { context, page } = await open();
  await page.evaluate(() =>
    localStorage.setItem(
      'easy-learn-reader-words-v1',
      JSON.stringify({
        'en:ephemeral': {
          word: 'ephemeral',
          language: 'en',
          status: 'learning',
          meaning: '短暂的',
          review: { dueAt: 0, step: 1, count: 2, lastReviewedAt: 0 },
        },
      }),
    ),
  );
  await page.reload();
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'legacy.txt', mimeType: 'text/plain', buffer: Buffer.from(original) });
  await page.getByRole('button', { name: '开启伴读', exact: true }).click();
  const token = page
    .locator('.reader-word.is-ready')
    .filter({ hasText: /^ephemeral$/ })
    .first();
  await expect(token).toBeVisible();
  await token.click();
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  const vocabulary = page.getByRole('region', { name: '生词本' });
  await vocabulary.getByRole('button', { name: '编辑 ephemeral 的释义', exact: true }).click();
  await vocabulary
    .getByRole('textbox', { name: 'ephemeral 的释义', exact: true })
    .fill('稍纵即逝的');
  await vocabulary.getByRole('button', { name: '保存释义', exact: true }).click();
  await expect(vocabulary.getByRole('alert')).toHaveCount(0);
  await vocabulary.getByRole('button', { name: '回忆到期生词 · 1', exact: true }).click();
  const review = vocabulary.getByRole('region', { name: '生词回忆' });
  await review.getByRole('button', { name: '显示释义', exact: true }).click();
  await review.getByRole('button', { name: '能回忆 · 7 天后', exact: true }).click();
  await expect(review.getByText('已记录 1 次回忆，0 个词还需练习。')).toBeVisible();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('easy-learn-reader-words-v1')!)['en:ephemeral'],
  );
  expect(saved.review.count).toBe(3);
  expect(saved.meaning).toBe('稍纵即逝的');
  expect(saved.context).toContain('ephemeral');
  await context.close();
});

test('focus mode preserves native PDF notes, viewer identity and page position through resizing', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'focus.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  const layer = page.locator('.page[data-page-number="1"] .annotationEditorLayer');
  await layer.click({ position: { x: 110, y: 330 } });
  await page.locator('.freeTextEditor [contenteditable="true"]').fill('Preserve focus note');
  await page.getByRole('button', { name: '选择文字', exact: true }).click();
  const input = page.getByRole('textbox', { name: '跳转页码' });
  await input.fill('2');
  await input.press('Enter');
  await expect(input).toHaveValue('2');
  const viewer = page.locator('.pdfViewer');
  await viewer.evaluate((el) => {
    (window as Window & { originalViewer?: Element }).originalViewer = el;
  });
  await page.getByRole('button', { name: '专注阅读', exact: true }).click();
  await expect(input).toHaveValue('2');
  expect(
    await viewer.evaluate(
      (el) => el === (window as Window & { originalViewer?: Element }).originalViewer,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '退出专注', exact: true }).click();
  await input.fill('1');
  await input.press('Enter');
  await page.getByRole('button', { name: '文字批注', exact: true }).click();
  await expect(page.locator('.freeTextEditor')).toContainText('Preserve focus note');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出含批注 PDF', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.toString()).toContain('/Contents (Preserve focus note)');
  expect(calls.length).toBe(before);
  await context.close();
});
test('reading tools fit narrow dark screens and disable motion when requested', async () => {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    }),
    page = await context.newPage();
  await page.goto(base);
  expect(
    await page.locator('.reader-welcome').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await importText(page);
  await page.getByRole('button', { name: '专注阅读', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出专注', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '生词本', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜索生词和释义' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.cache/reader-tools-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '关闭生词本', exact: true }).click();
  await page
    .locator('#reader-file')
    .setInputFiles({ name: 'motion.pdf', mimeType: 'application/pdf', buffer: paperPdf() });
  await page
    .getByRole('navigation', { name: '章节目录' })
    .getByRole('button', { name: '1.1 Threat Model', exact: true })
    .click();
  const heading = page.locator('[data-navigation-target="1.1 Threat Model"]').first();
  await expect(heading).toHaveCount(1);
  expect(await heading.evaluate((el) => el.getAnimations().length)).toBe(0);
  await context.close();
});
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
  const input = JSON.parse(calls.at(-1)!.messages[1].content);
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
  expect(JSON.parse(calls.at(-1)!.messages[1].content).operation).toBe('choice');
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
  await page.getByTestId('pdf-scroll-container').scrollIntoViewIfNeeded();
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
          (window as typeof window & { finishImport: () => void }).finishImport = resolve;
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
  await page.evaluate(() =>
    (window as typeof window & { finishImport: () => void }).finishImport(),
  );
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

test('workbench saves a translation default, supports local overrides and separates language caches', async () => {
  const { context, page } = await open();
  const before = calls.length;
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .getByRole('combobox', { name: '默认译文语言 / Default translation language' })
    .selectOption('ko');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByText('连接已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('#reader-file').setInputFiles({
    name: 'public-study.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(original),
  });
  await page.locator('.reader-prose').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  const study = page.getByRole('region', { name: '选段学习' });
  await expect(study.locator('.reader-study-result')).toContainText('ko：');
  await expect(study.locator('.reader-study-result')).toHaveAttribute('lang', 'ko');
  expect(JSON.parse(calls.at(-1)!.messages[1].content).targetLanguage).toBe('ko');
  await study.getByRole('combobox', { name: '译文语言 / Translate to' }).selectOption('en');
  await expect(study.locator('.reader-study-result')).toContainText('en：');
  expect(calls.length - before).toBe(2);
  await study.getByRole('combobox', { name: '译文语言 / Translate to' }).selectOption('ko');
  await expect(study.locator('.reader-study-result')).toContainText('ko：');
  expect(calls.length - before).toBe(2);
  await context.close();
  await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'SET_READING_PREFS',
      prefs: { translationTargetLanguage: 'zh-CN' },
    }),
  });
});
