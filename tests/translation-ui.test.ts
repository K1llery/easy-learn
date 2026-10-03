import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PdfPage } from '../src/ui/pdf-page';
import { TranslationLanguageSelect, useTranslationLanguage } from '../src/ui/translation-language';
import type { TranslationLanguage } from '../src/core/translation-languages';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/ui/rpc', () => ({ rpc }));
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  rpc.mockReset();
  vi.unstubAllGlobals();
});
it('waits for persisted language before enabling its selector', async () => {
  let resolve!: (settings: unknown) => void;
  rpc.mockImplementation(
    () =>
      new Promise((next) => {
        resolve = next;
      }),
  );
  function Surface() {
    const language = useTranslationLanguage();
    return React.createElement(TranslationLanguageSelect, {
      value: language.targetLanguage,
      onChange: language.setTargetLanguage,
      disabled: !language.ready,
    });
  }
  await act(async () => {
    root.render(React.createElement(Surface));
  });
  expect(document.querySelector('select')!.disabled).toBe(true);
  await act(async () => {
    resolve({ reading: { translationTargetLanguage: 'ko' } });
  });
  expect(document.querySelector('select')!.value).toBe('ko');
  expect(document.querySelector('select')!.disabled).toBe(false);
  expect(document.querySelectorAll('option')).toHaveLength(16);
});
it('gates PDF translation until preferences load and rejects a late result after changing language', async () => {
  let resolve!: (result: unknown) => void;
  rpc.mockImplementation(
    () =>
      new Promise((next) => {
        resolve = next;
      }),
  );
  const render = async (targetLanguage: TranslationLanguage, translationReady: boolean) =>
    act(async () => {
      root.render(
        React.createElement(PdfPage, {
          page: { page: 1, text: 'Public source text' },
          title: 'Public document',
          sourceUrl: '',
          targetLanguage,
          translationReady,
        }),
      );
    });
  await render('zh-CN', false);
  const translate = () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '翻译这一页')!;
  expect(translate().disabled).toBe(true);
  await act(async () => {
    translate().click();
  });
  expect(rpc).not.toHaveBeenCalled();
  await render('fr', true);
  await act(async () => {
    translate().click();
  });
  expect(rpc.mock.calls[0][1].request).toMatchObject({
    targetLanguage: 'fr',
    context: { text: 'Public source text' },
  });
  await render('ja', true);
  await act(async () => {
    resolve({ translation: 'Ancienne traduction française' });
  });
  expect(document.body.textContent).not.toContain('Ancienne traduction française');
  expect(document.querySelector('.source')?.textContent).toBe('Public source text');
});
