// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Config, Mastered, ReadingPrefs, AnnotationType } from '../src/core/types';
import type { LearningCard } from '../src/core/learning';
import type { ProviderSettings } from '../src/core/provider-settings';
import type { SettingsResponse, PublicSettings } from '../src/ui/rpc';
type TestSender = Omit<chrome.runtime.MessageSender, 'tab'> & { tab?: Partial<chrome.tabs.Tab> };
type PdfSelection = { id: string; mode: string; text: string; title: string; truncated: boolean };
type TestStorage = Record<string, unknown> & {
  config: Config;
  reading: ReadingPrefs & { localOnly?: boolean; codeAnnotations?: boolean };
  mastered: Mastered[];
  providerSettingsV1: ProviderSettings;
  learningCardsV1: LearningCard[];
};
type ReplyData<T extends string> = T extends 'GET_SETTINGS'
  ? SettingsResponse
  : T extends 'PUBLIC_SETTINGS'
    ? PublicSettings & {
        codeAnnotations: boolean;
        annotationTypes: AnnotationType[];
        learningCardsV1?: never;
      }
    : unknown;
type MockStorage = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  [key: string]: ReturnType<typeof vi.fn>;
};
const model = vi.hoisted(() => vi.fn());
vi.mock('../src/core/ai', () => ({ callModel: model }));
function event() {
  const listeners: ((...args: unknown[]) => unknown)[] = [];
  return {
    addListener: (listener: (...args: unknown[]) => unknown) => listeners.push(listener),
    emit: (...args: unknown[]) => listeners.forEach((listener) => listener(...args)),
    listeners,
  };
}
const cfg: Config = {
  baseUrl: 'https://model.example/v1',
  model: 'test',
  apiKey: 'secret',
  profile: { domain: '软件开发', level: '入门' },
};
const extensionUrl = 'chrome-extension://test-id/';
const pageSender = {
  id: 'test-id',
  url: 'https://article.example/',
  tab: { id: 3 },
  documentId: 'article-3',
};
const panelSender = {
  id: 'test-id',
  url: extensionUrl + 'panel.html',
  tab: { id: 3 },
  documentId: 'panel-3',
};
const optionSender = { id: 'test-id', url: extensionUrl + 'options.html', documentId: 'options' };
const context = {
  title: 'Recovery',
  heading: 'DR',
  text: 'DR restores service after a regional failure.',
  before: '',
  after: '',
};
const concept = {
  anchor: 'DR',
  category: '缩写',
  meaning: '灾难恢复',
  expansion: 'Disaster Recovery',
  evidence: 'regional failure',
  ambiguity: '',
};
let api: ReturnType<typeof makeApi>, data: TestStorage, sessionData: Record<string, PdfSelection>;
async function send<T extends string>(
  type: T,
  fields: Record<string, unknown> = {},
  sender: TestSender = optionSender,
): Promise<{ ok: boolean; data: ReplyData<T>; error?: string }> {
  return new Promise((resolve) =>
    api.runtime.onMessage.listeners[0]({ type, ...fields }, sender, resolve),
  );
}
function port(sender: TestSender, name: string) {
  return { sender, name, onMessage: event(), onDisconnect: event(), postMessage: vi.fn() };
}
function makeApi(storage: MockStorage, sessionStorage: MockStorage) {
  return {
    storage: { local: storage, session: sessionStorage },
    permissions: { contains: vi.fn().mockResolvedValue(true) },
    runtime: {
      id: 'test-id',
      getURL: (p: string) => extensionUrl + p,
      openOptionsPage: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onInstalled: event(),
      onMessage: event(),
      onConnect: event(),
    },
    tabs: { onRemoved: event(), onUpdated: event(), create: vi.fn().mockResolvedValue({ id: 99 }) },
    contextMenus: {
      removeAll: vi.fn((callback: () => void) => callback()),
      create: vi.fn(),
      onClicked: event(),
    },
    sidePanel: { open: vi.fn().mockResolvedValue(undefined) },
  };
}
beforeEach(async () => {
  vi.resetModules();
  model.mockReset().mockResolvedValue({ concepts: [concept] });
  data = { config: structuredClone(cfg) } as TestStorage;
  sessionData = {};
  const storage = {
    setAccessLevel: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(async (keys: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k) => [k, structuredClone(data[k])]),
      ),
    ),
    set: vi.fn(async (next: Record<string, unknown>) => {
      await Promise.resolve();
      Object.assign(data, structuredClone(next));
    }),
    clear: vi.fn(async () => {
      data = {} as TestStorage;
    }),
  };
  const sessionStorage = {
    setAccessLevel: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(async (keys: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k) => [k, structuredClone(sessionData[k])]),
      ),
    ),
    set: vi.fn(async (next: Record<string, unknown>) => {
      await Promise.resolve();
      Object.assign(sessionData, structuredClone(next));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionData[key];
    }),
  };
  api = makeApi(storage, sessionStorage);
  vi.stubGlobal('chrome', api);
  await import('../src/background');
});
afterEach(() => vi.unstubAllGlobals());

it('adds selection actions and passes only the chosen PDF text through a trusted panel', async () => {
  api.runtime.onInstalled.listeners[0]();
  expect(api.contextMenus.removeAll).toHaveBeenCalledOnce();
  expect(api.contextMenus.create).toHaveBeenCalledWith({
    id: 'easy-learn-explain-selection',
    title: '用 Easy Learn 解释选中文字',
    contexts: ['selection'],
  });
  expect(api.contextMenus.create).toHaveBeenCalledWith({
    id: 'easy-learn-translate-selection',
    title: '用 Easy Learn 翻译选中文字',
    contexts: ['selection'],
  });

  api.contextMenus.onClicked.listeners[0](
    {
      menuItemId: 'easy-learn-translate-selection',
      selectionText: '  Explain this selected paragraph.  ',
    },
    { id: 3, title: 'Research Paper' },
  );
  expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 3 });
  await vi.waitFor(() => expect(sessionData['pdfSelection:3']).toBeDefined());
  expect(sessionData['pdfSelection:3']).toMatchObject({
    mode: 'translate',
    text: 'Explain this selected paragraph.',
    title: 'Research Paper',
    truncated: false,
  });
  expect(Object.keys(sessionData['pdfSelection:3'])).toEqual([
    'id',
    'mode',
    'text',
    'title',
    'truncated',
  ]);

  expect((await send('TAKE_PDF_SELECTION', { tabId: 3 }, pageSender)).ok).toBe(false);
  const taken = await send('TAKE_PDF_SELECTION', { tabId: 3 }, panelSender);
  expect(taken.data).toMatchObject({ mode: 'translate', text: 'Explain this selected paragraph.' });
  expect(sessionData['pdfSelection:3']).toBeUndefined();
  expect((await send('TAKE_PDF_SELECTION', { tabId: 3 }, panelSender)).data).toBeNull();
});
it('ignores empty text selections instead of opening the panel', async () => {
  api.contextMenus.onClicked.listeners[0](
    { menuItemId: 'easy-learn-explain-selection', selectionText: '   ' },
    { id: 5, title: 'Scanned PDF' },
  );
  expect(api.sidePanel.open).not.toHaveBeenCalled();
  expect(sessionData['pdfSelection:5']).toBeUndefined();
});
it('caps selected PDF text to the existing context limit and records truncation', async () => {
  const longSelection = 'x'.repeat(16020);
  api.contextMenus.onClicked.listeners[0](
    { menuItemId: 'easy-learn-explain-selection', selectionText: longSelection },
    { id: 4, title: 'Paper' },
  );
  await vi.waitFor(() => expect(sessionData['pdfSelection:4']).toBeDefined());
  expect(sessionData['pdfSelection:4'].text).toHaveLength(16000);
  expect(sessionData['pdfSelection:4'].truncated).toBe(true);
});
it('keeps credentials out of public settings and rejects untrusted privileged messages', async () => {
  const result = await send('PUBLIC_SETTINGS', {}, pageSender);
  expect(result.data).toEqual({
    translationTargetLanguage: 'zh-CN',
    profile: cfg.profile,
    mastered: [],
    codeAnnotations: false,
    annotationTypes: ['abbreviation', 'term', 'command'],
    localOnly: false,
    quizCount: 5,
    maxPerBlock: 6,
    batchSize: 8,
    concurrency: 6,
    vocabularyBaseline: 10000,
    vocabularyPerBlock: 1,
  });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect((await send('GET_SETTINGS', {}, pageSender)).ok).toBe(false);
  expect(
    (await send('GET_SETTINGS', {}, { ...optionSender, url: extensionUrl + 'panel.html-forged' }))
      .ok,
  ).toBe(false);
  expect((await send('GET_SETTINGS', {}, { ...optionSender, id: 'other-extension' })).ok).toBe(
    false,
  );
  expect(api.storage.local.setAccessLevel).toHaveBeenCalledWith({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
});
it('upgrades a saved local CPA preset to GPT-6 Luna while retaining its access key', async () => {
  data.config = { ...cfg, baseUrl: 'http://127.0.0.1:8317/v1', model: 'gpt-5.6-luna' };
  const settings = await send('GET_SETTINGS');
  expect(settings.data.config).toMatchObject({ model: 'gpt-6-luna', apiKey: 'secret' });
  expect(data.config.model).toBe('gpt-6-luna');
  await send('TEST');
  expect(model).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'gpt-6-luna' }),
    expect.anything(),
    undefined,
    undefined,
    undefined,
  );
});
it('denied host permission never saves configuration or calls the model', async () => {
  api.permissions.contains.mockResolvedValue(false);
  expect((await send('SAVE_SETTINGS', { config: { ...cfg, model: 'changed' } })).ok).toBe(false);
  expect(data.config.model).toBe('test');
  expect((await send('AI', { request: { operation: 'analyze', context } }, pageSender)).ok).toBe(
    false,
  );
  expect((await send('TEST')).ok).toBe(false);
  expect(model).not.toHaveBeenCalled();
});
it('retains the existing provider when saving a different connection and migrates old settings', async () => {
  const initial = await send('GET_SETTINGS');
  expect(initial.data.providerSettings).toMatchObject({
    activeProviderId: 'custom',
    drafts: { custom: cfg },
  });
  const next = {
    ...cfg,
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: 'deepseek-test-key',
  };
  expect((await send('SAVE_SETTINGS', { config: next, providerId: 'deepseek' })).ok).toBe(true);
  const settings = (await send('GET_SETTINGS')).data;
  expect(settings.config).toEqual(next);
  expect(settings.providerSettings).toMatchObject({
    activeProviderId: 'deepseek',
    drafts: { custom: cfg, deepseek: next },
  });
});
it('stores incomplete provider drafts without changing or authorizing the active connection', async () => {
  api.permissions.contains.mockResolvedValue(false);
  const draft = {
    ...cfg,
    baseUrl: '',
    model: '',
    apiKey: 'unfinished-key',
    profile: { ...cfg.profile, domain: '' },
  };
  expect((await send('SAVE_PROVIDER_DRAFT', { providerId: 'groq', config: draft })).ok).toBe(true);
  expect(data.config).toEqual(cfg);
  expect(data.providerSettingsV1.drafts.groq).toEqual(draft);
  expect(api.permissions.contains).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
  expect((await send('SAVE_PROVIDER_DRAFT', { providerId: 'unknown', config: draft })).ok).toBe(
    false,
  );
  expect(
    (
      await send('SAVE_PROVIDER_DRAFT', {
        providerId: 'groq',
        config: { ...draft, apiKey: 'x'.repeat(2001) },
      })
    ).ok,
  ).toBe(false);
});
it('serializes provider drafts, keeps them private, and removes them when clearing local data', async () => {
  const results = await Promise.all(
    ['groq', 'deepseek'].map((providerId) =>
      send('SAVE_PROVIDER_DRAFT', {
        providerId,
        config: { ...cfg, apiKey: providerId + '-private-key' },
      }),
    ),
  );
  expect(results.every((result) => result.ok)).toBe(true);
  expect(Object.keys(data.providerSettingsV1.drafts).sort()).toEqual([
    'custom',
    'deepseek',
    'groq',
  ]);
  expect(JSON.stringify((await send('PUBLIC_SETTINGS', {}, pageSender)).data)).not.toContain(
    'private-key',
  );
  expect(
    (await send('SAVE_PROVIDER_DRAFT', { providerId: 'groq', config: cfg }, pageSender)).ok,
  ).toBe(false);
  await send('CLEAR_SETTINGS');
  expect(data.providerSettingsV1).toBeUndefined();
});
it('does not preserve an API key in subscription login drafts', async () => {
  await send('SAVE_PROVIDER_DRAFT', {
    providerId: 'chatgpt-oauth',
    config: { ...cfg, api: 'codex' },
  });
  expect(data.providerSettingsV1.drafts['chatgpt-oauth'].apiKey).toBe('');
});
it('serializes simultaneous mastery updates and retains distinct meanings', async () => {
  const results = await Promise.all([
    send('MASTER', { concept }),
    send('MASTER', { concept: { ...concept, meaning: '每日运行', expansion: 'Daily Run' } }),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(data.mastered).toHaveLength(2);
  await send('UNMASTER', { key: data.mastered[0].key });
  expect(data.mastered.map((x) => x.meaning)).toEqual(['每日运行']);
});
it('caches per document and clears standalone panel data when its port closes', async () => {
  const sender = { ...panelSender, tab: undefined, documentId: 'standalone-1' };
  const p = port(sender, 'panel');
  api.runtime.onConnect.emit(p);
  const fields = { request: { operation: 'explain', context } };
  await send('AI', fields, sender);
  await send('AI', fields, sender);
  expect(model).toHaveBeenCalledTimes(1);
  await send('AI', fields, { ...sender, documentId: 'standalone-2' });
  expect(model).toHaveBeenCalledTimes(2);
  p.onDisconnect.emit();
  await send('AI', fields, sender);
  expect(model).toHaveBeenCalledTimes(3);
});
it('closing a panel does not discard the article analysis cache', async () => {
  const c = port(pageSender, 'content'),
    p = port(panelSender, 'panel');
  api.runtime.onConnect.emit(c);
  api.runtime.onConnect.emit(p);
  const analysis = { request: { operation: 'analyze', context } };
  await send('AI', analysis, pageSender);
  await send('AI', { request: { operation: 'quiz', context } }, panelSender);
  p.onDisconnect.emit();
  await send('AI', analysis, pageSender);
  expect(model).toHaveBeenCalledTimes(2);
  api.tabs.onRemoved.emit(3);
  await send('AI', analysis, pageSender);
  expect(model).toHaveBeenCalledTimes(3);
});
it('keeps a side panel request alive when the article reader closes', async () => {
  const c = port(pageSender, 'content'),
    p = port(panelSender, 'panel');
  api.runtime.onConnect.emit(c);
  api.runtime.onConnect.emit(p);
  let resolve: (value: unknown) => void = () => {};
  model.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = send('AI', { request: { operation: 'explain', context } }, panelSender);
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
  const signal = model.mock.calls[0][2] as AbortSignal;
  c.onMessage.emit({ type: 'STOP' });
  c.onDisconnect.emit();
  expect(signal.aborted).toBe(false);
  resolve({ explanation: 'Regional recovery.' });
  expect(await pending).toMatchObject({ ok: true });
});
it('cancels requests on tab closure and rejects results returned after cancellation', async () => {
  let resolve: (value: unknown) => void = () => {};
  model.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = send('AI', { request: { operation: 'analyze', context } }, pageSender);
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
  const signal = model.mock.calls[0][2] as AbortSignal;
  api.tabs.onRemoved.emit(3);
  expect(signal.aborted).toBe(true);
  resolve({ concepts: [concept] });
  expect(await pending).toMatchObject({ ok: false, error: '请求已取消。' });
});
it('routes contexts only to the panel in the same tab', () => {
  const c = port(pageSender, 'content'),
    p = port(panelSender, 'panel'),
    other = port({ ...panelSender, documentId: 'panel-4', tab: { id: 4 } }, 'panel');
  api.runtime.onConnect.emit(c);
  api.runtime.onConnect.emit(p);
  api.runtime.onConnect.emit(other);
  expect(c.postMessage).toHaveBeenCalledWith({ type: 'PANEL_READY' });
  c.onMessage.emit({ type: 'CONTEXT', payload: { context } });
  expect(p.postMessage).toHaveBeenCalledWith({ type: 'CONTEXT', payload: { context } });
  expect(other.postMessage).not.toHaveBeenCalled();
});

it('does not cancel live requests on same-document loading/status changes', async () => {
  let resolve: (value: unknown) => void = () => {};
  model.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = send('AI', { request: { operation: 'analyze', context } }, pageSender);
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
  const signal = model.mock.calls[0][2] as AbortSignal;
  api.tabs.onUpdated.emit(3, { status: 'loading', url: 'https://article.example/#install' });
  expect(signal.aborted).toBe(false);
  resolve({ concepts: [concept] });
  expect((await pending).ok).toBe(true);
});

it('persists the selected annotation types and leaves command/code preferences independent', async () => {
  const settingsPage = optionSender;
  expect((await send('GET_SETTINGS', {}, settingsPage)).ok).toBe(true);
  expect(
    (
      await send(
        'SET_ANNOTATION_TYPES',
        { types: ['abbreviation', 'command', 'vocabulary'] },
        settingsPage,
      )
    ).ok,
  ).toBe(true);
  expect((await send('PUBLIC_SETTINGS', {}, pageSender)).data.annotationTypes).toEqual([
    'abbreviation',
    'command',
    'vocabulary',
  ]);
  await send('SET_CODE_ANNOTATIONS', { enabled: true }, pageSender);
  expect(data.reading).toEqual({
    annotationTypes: ['abbreviation', 'command', 'vocabulary'],
    codeAnnotations: true,
  });
  expect((await send('SET_ANNOTATION_TYPES', { types: ['not-a-type'] }, settingsPage)).ok).toBe(
    false,
  );
  expect(
    (await send('GET_SETTINGS', {}, { ...settingsPage, url: extensionUrl + 'options.html-forged' }))
      .ok,
  ).toBe(false);
  expect((await send('PUBLIC_SETTINGS', {}, pageSender)).data.annotationTypes).toEqual([
    'abbreviation',
    'command',
    'vocabulary',
  ]);
});

it('persists a safe code switch without exposing credentials or clearing the model cache', async () => {
  expect((await send('SET_CODE_ANNOTATIONS', { enabled: true }, pageSender)).ok).toBe(true);
  expect((await send('PUBLIC_SETTINGS', {}, pageSender)).data.codeAnnotations).toBe(true);
  expect(data.config.apiKey).toBe(cfg.apiKey);
  expect((await send('SET_CODE_ANNOTATIONS', { enabled: 'yes' }, pageSender)).ok).toBe(false);
  expect((await send('MASTER', { concept }, pageSender)).ok).toBe(true);
  expect((await send('PUBLIC_SETTINGS', {}, pageSender)).data.mastered).toHaveLength(1);
});

it('offline mode blocks model requests while preserving other reading preferences', async () => {
  await send('SET_LOCAL_ONLY', { enabled: true }, pageSender);
  await send('SET_CODE_ANNOTATIONS', { enabled: true }, pageSender);
  expect(data.reading).toEqual({ localOnly: true, codeAnnotations: true });
  expect((await send('AI', { request: { operation: 'analyze', context } }, pageSender)).ok).toBe(
    false,
  );
  expect((await send('TEST')).ok).toBe(false);
  expect(model).not.toHaveBeenCalled();
});

it('routes incremental results only to the requesting document and ignores obsolete progress', async () => {
  const c = port(pageSender, 'content'),
    p = port(panelSender, 'panel');
  api.runtime.onConnect.emit(c);
  api.runtime.onConnect.emit(p);
  let resolve!: (v: unknown) => void;
  model.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = send(
    'AI',
    { requestId: 'batch-1', request: { operation: 'analyze', context } },
    pageSender,
  );
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
  const progress = model.mock.calls[0][3];
  progress({ concepts: [concept], skipped: [] });
  expect(c.postMessage).toHaveBeenCalledWith({
    type: 'AI_PROGRESS',
    requestId: 'batch-1',
    concepts: [concept],
    skipped: [],
  });
  expect(p.postMessage).not.toHaveBeenCalled();
  c.onDisconnect.emit();
  c.postMessage.mockClear();
  progress({ concepts: [concept], skipped: [] });
  expect(c.postMessage).not.toHaveBeenCalled();
  resolve({ concepts: [concept] });
  expect((await pending).ok).toBe(false);
});

it('reuses persistent terms after a document reload, remaps IDs, and clears them on opt out', async () => {
  const candidates = [
    {
      id: 'c0',
      anchor: 'DR',
      kind: 'abbreviation',
      heading: 'Recovery',
      context: 'Recover from a regional failure.',
    },
  ];
  model.mockResolvedValue({
    concepts: [{ ...concept, id: 'c0', summary: '恢复服务' }],
    missing: [],
  });
  await send('AI', { request: { operation: 'analyze', context, candidates } }, pageSender);
  const reload = { ...pageSender, documentId: 'reloaded' };
  const result = await send(
    'AI',
    { request: { operation: 'analyze', context, candidates: [{ ...candidates[0], id: 'c8' }] } },
    reload,
  );
  expect(result).toMatchObject({
    ok: true,
    data: { __cached: true, concepts: [{ id: 'c8', summary: '恢复服务' }] },
  });
  expect(model).toHaveBeenCalledTimes(1);
  expect((await send('CLEAR_ANNOTATION_CACHE', {}, pageSender)).ok).toBe(false);
  await send('SET_REMEMBER_ANNOTATIONS', { enabled: false });
  await send(
    'AI',
    { request: { operation: 'analyze', context, candidates } },
    { ...reload, documentId: 'after-clear' },
  );
  expect(model).toHaveBeenCalledTimes(2);
  expect(data.annotationCacheV1).toEqual([]);
});

const learningDraft = () => ({
  id: crypto.randomUUID(),
  title: 'Recovery',
  sourceText: context.text,
  goal: '设计恢复方案',
  question: '为什么需要异地副本？',
  application: '画一张恢复流程图。',
  answer: '为了恢复服务。',
  feedback: {
    correct: '理解了恢复。',
    gaps: '需要说明故障范围。',
    reference: '在另一地区保留可用副本。',
  },
});
it('keeps saved learning private and supports offline records without model configuration', async () => {
  const draft = learningDraft();
  delete (data as Partial<TestStorage>).config;
  data.reading = { localOnly: true };
  for (const type of [
    'LEARNING_LIST',
    'LEARNING_SAVE',
    'LEARNING_REVIEW',
    'LEARNING_NOTE',
    'LEARNING_DELETE',
  ])
    expect((await send(type, { draft, id: draft.id }, pageSender)).ok).toBe(false);
  const result = await send(
    'LEARNING_SAVE',
    { draft: { ...draft, apiKey: 'do-not-persist', before: 'unselected-neighbor' } },
    panelSender,
  );
  expect(result.ok).toBe(true);
  expect(data.learningCardsV1).toHaveLength(1);
  expect(JSON.stringify(data.learningCardsV1)).not.toMatch(/do-not-persist|unselected-neighbor/);
  expect((await send('PUBLIC_SETTINGS', {}, pageSender)).data.learningCardsV1).toBeUndefined();
  expect((await send('LEARNING_LIST', {}, panelSender)).data).toHaveLength(1);
  expect(model).not.toHaveBeenCalled();
});
it('serializes concurrent learning saves and rejects stale review updates', async () => {
  const first = learningDraft(),
    second = learningDraft();
  const saved = await Promise.all([
    send('LEARNING_SAVE', { draft: first }),
    send('LEARNING_SAVE', { draft: second }),
    send('LEARNING_SAVE', { draft: first }),
  ]);
  expect(saved.every((result) => result.ok)).toBe(true);
  expect(data.learningCardsV1).toHaveLength(2);
  const input = {
    id: first.id,
    revision: 0,
    rating: 'remembered',
    answer: '整个区域出故障时，本地副本也可能不可用。',
  };
  const reviewed = await Promise.all([
    send('LEARNING_REVIEW', input),
    send('LEARNING_REVIEW', input),
  ]);
  expect(reviewed.filter((result) => result.ok)).toHaveLength(1);
  expect(data.learningCardsV1[0]).toMatchObject({
    revision: 1,
    reviewCount: 1,
    lastAnswer: input.answer,
  });
  expect((await send('LEARNING_NOTE', { id: first.id, revision: 0, note: '旧记录' })).ok).toBe(
    false,
  );
  expect(
    (await send('LEARNING_NOTE', { id: first.id, revision: 1, note: '画了流程图。' })).ok,
  ).toBe(true);
  expect(data.learningCardsV1[0]).toMatchObject({ revision: 2, actionNote: '画了流程图。' });
  await send('LEARNING_DELETE', { id: first.id });
  expect(data.learningCardsV1.map((card) => card.id)).toEqual([second.id]);
  await send('CLEAR_SETTINGS');
  expect((await send('LEARNING_LIST')).data).toEqual([]);
});
it('retains existing records when storage fails, allowing an explicit save retry', async () => {
  const draft = learningDraft();
  api.storage.local.set.mockRejectedValueOnce(new Error('Storage quota exceeded'));
  expect((await send('LEARNING_SAVE', { draft })).ok).toBe(false);
  expect(data.learningCardsV1).toBeUndefined();
  expect((await send('LEARNING_SAVE', { draft })).ok).toBe(true);
  expect(data.learningCardsV1).toHaveLength(1);
});

it('allows only explicit paragraph translation from content scripts and respects offline mode', async () => {
  model.mockResolvedValue({ translation: '中文段落' });
  const request = { operation: 'explain', mode: 'translate', context };
  expect((await send('AI', { request }, pageSender)).ok).toBe(false);
  expect(
    (
      await send(
        'AI',
        { pageTranslation: true, request: { ...request, mode: 'followup' } },
        pageSender,
      )
    ).ok,
  ).toBe(false);
  expect(
    (await send('AI', { pageTranslation: true, request: { ...request, concept } }, pageSender)).ok,
  ).toBe(false);
  expect(model).not.toHaveBeenCalled();
  expect(await send('AI', { pageTranslation: true, request }, pageSender)).toMatchObject({
    ok: true,
    data: { translation: '中文段落' },
  });
  await send('SET_LOCAL_ONLY', { enabled: true });
  expect((await send('AI', { pageTranslation: true, request }, pageSender)).ok).toBe(false);
  expect(model).toHaveBeenCalledTimes(1);
});

it('cancels only the requesting document translations while preserving analysis and other tabs', async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  model.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  const request = { operation: 'explain', mode: 'translate', context };
  const local = send('AI', { pageTranslation: true, request }, pageSender);
  const analysis = send('AI', { request: { operation: 'analyze', context } }, pageSender);
  const other = send(
    'AI',
    { pageTranslation: true, request },
    { ...pageSender, tab: { id: 4 }, documentId: 'article-4' },
  );
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(3));
  await send('CANCEL_TRANSLATION', {}, pageSender);
  const signals = model.mock.calls.map((call) => call[2] as AbortSignal);
  expect(signals.map((signal) => signal.aborted)).toEqual([true, false, false]);
  resolvers.forEach((resolve) => resolve({ translation: '中文段落', concepts: [concept] }));
  expect((await local).ok).toBe(false);
  expect((await analysis).ok).toBe(true);
  expect((await other).ok).toBe(true);
});

it('retains saved request limits, accepts twelve concurrent requests and rejects larger values', async () => {
  data.reading = { concurrency: 2, batchSize: 4 };
  expect((await send('PUBLIC_SETTINGS', {}, pageSender)).data).toMatchObject({
    concurrency: 2,
    batchSize: 4,
  });
  expect((await send('SET_READING_PREFS', { prefs: { concurrency: 12, batchSize: 8 } })).ok).toBe(
    true,
  );
  expect((await send('PUBLIC_SETTINGS', {}, pageSender)).data).toMatchObject({
    concurrency: 12,
    batchSize: 8,
  });
  expect((await send('SET_READING_PREFS', { prefs: { concurrency: 13 } })).ok).toBe(false);
  expect(data.reading.concurrency).toBe(12);
});

it('cancels a translation during asynchronous settings lookup before it can reach the model', async () => {
  let release!: (value: unknown) => void;
  api.storage.local.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = send(
    'AI',
    { pageTranslation: true, request: { operation: 'explain', mode: 'translate', context } },
    pageSender,
  );
  await vi.waitFor(() => expect(release).toBeDefined());
  expect((await send('CANCEL_TRANSLATION', {}, pageSender)).ok).toBe(true);
  release({ reading: {} });
  expect((await pending).ok).toBe(false);
  expect(model).not.toHaveBeenCalled();
});

it('applies the saved translation language and isolates cached results by target language', async () => {
  data.reading = { translationTargetLanguage: 'fr' };
  const request = { operation: 'explain', mode: 'translate', context };
  model.mockResolvedValue({ translation: 'Traduction française' });
  expect((await send('AI', { request }, panelSender)).ok).toBe(true);
  expect(model.mock.calls[0][1]).toMatchObject({ targetLanguage: 'fr', context });
  expect(
    (await send('AI', { request: { ...request, targetLanguage: 'fr' } }, panelSender)).ok,
  ).toBe(true);
  expect(model).toHaveBeenCalledTimes(1);
  model.mockResolvedValue({ translation: '日本語訳' });
  expect(
    (await send('AI', { request: { ...request, targetLanguage: 'ja' } }, panelSender)).ok,
  ).toBe(true);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][1]).toMatchObject({ targetLanguage: 'ja' });
  expect((await send('SET_READING_PREFS', { prefs: { translationTargetLanguage: 'ko' } })).ok).toBe(
    true,
  );
  expect(data.reading.translationTargetLanguage).toBe('ko');
  expect(
    (await send('SET_READING_PREFS', { prefs: { translationTargetLanguage: 'invented' } })).ok,
  ).toBe(false);
  expect(data.reading.translationTargetLanguage).toBe('ko');
});
