import { defaultConcurrency, defaultBatchSize } from './core/reading-defaults';
import {
  aiRequestSchema,
  configSchema,
  conceptSchema,
  conceptKey,
  defaultProfile,
  normalizeAnnotationTypes,
  profileSchema,
  endpoint,
  requestTarget,
  apiKindOf,
  readingPrefsSchema,
  explanationStyles,
  type Config,
  type Mastered,
} from './core/types';
import { callModel, type AnalysisProgress } from './core/ai';
import {
  PROVIDER_SETTINGS_KEY,
  providerDraftSchema,
  providerId,
  readProviderSettings,
} from './core/provider-settings';
import {
  getAccessToken,
  oauthStatus,
  signOut,
  importChatgptCredentials,
  MODEL_ORIGINS,
  type OAuthKind,
} from './core/oauth';
import { AnnotationCache } from './core/annotation-cache';
import { cacheKey, Queue, SessionCache } from './core/session';
import {
  LEARNING_KEY,
  learningDraftSchema,
  learningIdSchema,
  reviewInputSchema,
  actionInputSchema,
  readLearningCards,
  saveLearningCard,
  findLearningCard,
  reviewLearningCard,
  assertLearningCapacity,
} from './core/learning';
const initialized = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
const queue = new Queue();
const annotationCache = new AnnotationCache(chrome.storage.local);
let cacheEpoch = 0;
const caches = new Map<string, SessionCache<unknown>>();
const controllers = new Map<string, Set<AbortController>>();
const translationControllers = new Map<string, Set<AbortController>>();
const contentPorts = new Map<number, chrome.runtime.Port>();
const panelPorts = new Map<number, chrome.runtime.Port>();
const extensionRoot = chrome.runtime.getURL('');
const tabScopes = new Map<number, Set<string>>();
const documentPorts = new Map<string, chrome.runtime.Port>();
let mutationTail: Promise<unknown> = Promise.resolve();
const pdfSelectionKey = (tabId: number) => `pdfSelection:${tabId}`;
const PDF_SELECTION_LIMIT = 16000;
function scopeFor(sender: chrome.runtime.MessageSender) {
  if (!sender.documentId) throw new Error('无法识别页面会话，请刷新后重试。');
  const scope = sender.documentId;
  if (sender.tab?.id !== undefined) {
    const scopes = tabScopes.get(sender.tab.id) ?? new Set<string>();
    scopes.add(scope);
    tabScopes.set(sender.tab.id, scopes);
  }
  return scope;
}
function trusted(sender: chrome.runtime.MessageSender) {
  return (
    !!sender.url &&
    [
      extensionRoot + 'options.html',
      extensionRoot + 'panel.html',
      extensionRoot + 'sidepanel.html',
      extensionRoot + 'pdf.html',
      extensionRoot + 'reader.html',
    ].includes(sender.url.split(/[?#]/)[0])
  );
}
function upgradeLocalCpaModel(cfg: Config): Config {
  return cfg.baseUrl.replace(/\/+$/, '') === 'http://127.0.0.1:8317/v1' &&
    cfg.model === 'gpt-5.6-luna'
    ? { ...cfg, model: 'gpt-6-luna' }
    : cfg;
}
function oauthKindOf(cfg: Config): OAuthKind | null {
  const kind = apiKindOf(cfg);
  return kind === 'codex' ? 'chatgpt' : kind === 'claude-oauth' ? 'claude' : null;
}
function oauthKindInput(value: unknown): OAuthKind {
  if (value === 'chatgpt' || value === 'claude') return value;
  throw new Error('未知的订阅服务类型。');
}
// Verifies the extension may reach the configured model endpoint (API key or subscription OAuth).
async function assertModelAccess(cfg: Config) {
  const kind = oauthKindOf(cfg);
  if (kind) {
    if (!(await chrome.permissions.contains({ origins: MODEL_ORIGINS[kind] })))
      throw new Error('尚未授权订阅账户接口的访问权限，请在设置中重新登录或保存。');
    return;
  }
  if (
    !(await chrome.permissions.contains({
      origins: [requestTarget(cfg.baseUrl, apiKindOf(cfg)).origin + '/*'],
    }))
  )
    throw new Error('尚未授权访问模型服务器，请在设置中重新保存并授权。');
}
async function config(): Promise<Config> {
  await initialized;
  const data = await chrome.storage.local.get('config');
  const parsed = configSchema.safeParse(data.config);
  if (!parsed.success) throw new Error('请先打开设置，填写模型地址、模型名称和 API Key。');
  const upgraded = upgradeLocalCpaModel(parsed.data);
  if (upgraded !== parsed.data) await chrome.storage.local.set({ config: upgraded });
  return upgraded;
}
function clearScope(scope: string) {
  caches.delete(scope);
  for (const controller of controllers.get(scope) ?? []) controller.abort();
  controllers.delete(scope);
  translationControllers.delete(scope);
  for (const [tab, scopes] of tabScopes) {
    scopes.delete(scope);
    if (!scopes.size) tabScopes.delete(tab);
  }
}
function clearTab(id: number) {
  for (const scope of [...(tabScopes.get(id) ?? [])]) clearScope(scope);
  tabScopes.delete(id);
}
function safePost(port: chrome.runtime.Port | undefined, message: unknown) {
  try {
    port?.postMessage(message);
  } catch {
    /* disconnected */
  }
}
function refresh(invalidate = true) {
  if (invalidate) cacheEpoch++;
  if (invalidate) for (const scope of [...caches.keys()]) clearScope(scope);
  for (const p of contentPorts.values()) safePost(p, { type: 'REFRESH', invalidate });
  for (const p of documentPorts.values())
    if (p.name === 'reader') safePost(p, { type: 'REFRESH', invalidate });
}
chrome.runtime.onConnect.addListener((port) => {
  const id = port.sender?.tab?.id;
  if (port.sender?.id !== chrome.runtime.id || !port.sender.documentId) return;
  const scope = scopeFor(port.sender);
  documentPorts.set(scope, port);
  port.onMessage.addListener(() => {
    /* PING keeps active surfaces connected. */
  });
  port.onDisconnect.addListener(() => {
    if (documentPorts.get(scope) === port) {
      documentPorts.delete(scope);
      clearScope(scope);
    }
  });
  if (id === undefined) return;
  if (port.name === 'content' && !trusted(port.sender!)) {
    contentPorts.set(id, port);
    port.onMessage.addListener((msg) => {
      if (msg?.type === 'CONTEXT') safePost(panelPorts.get(id), msg);
      if (msg?.type === 'STOP') clearScope(scope);
    });
    port.onDisconnect.addListener(() => {
      if (contentPorts.get(id) === port) {
        contentPorts.delete(id);
        clearScope(scope);
      }
    });
  } else if (port.name === 'panel' && trusted(port.sender!)) {
    panelPorts.set(id, port);
    safePost(contentPorts.get(id), { type: 'PANEL_READY' });
    port.onMessage.addListener((msg) => {
      if (msg?.type === 'CLOSE') safePost(contentPorts.get(id), msg);
    });
    port.onDisconnect.addListener(() => {
      if (panelPorts.get(id) === port) panelPorts.delete(id);
    });
  }
});
chrome.runtime.onInstalled.addListener((details) => {
  if (details?.reason === 'install') void chrome.runtime.openOptionsPage().catch(() => undefined);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'easy-learn-explain-selection',
      title: '用 Easy Learn 解释选中文字',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'easy-learn-translate-selection',
      title: '用 Easy Learn 翻译选中文字',
      contexts: ['selection'],
    });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode =
    info.menuItemId === 'easy-learn-explain-selection'
      ? 'explain'
      : info.menuItemId === 'easy-learn-translate-selection'
        ? 'translate'
        : null;
  const tabId = tab?.id;
  const selectedText = info.selectionText?.trim();
  if (!mode || tabId === undefined || !selectedText) return;

  const selection = {
    id: crypto.randomUUID(),
    mode,
    text: selectedText.slice(0, PDF_SELECTION_LIMIT),
    title: (tab?.title || '选中的英文内容').slice(0, 500),
    truncated: selectedText.length > PDF_SELECTION_LIMIT,
  };
  // Open synchronously in the context-menu click handler so Chrome retains the user gesture.
  const opening = chrome.sidePanel.open({ tabId }).then(
    () => true,
    () => false,
  );
  void chrome.storage.session
    .set({ [pdfSelectionKey(tabId)]: selection })
    .then(async () => {
      if (await opening) {
        void chrome.runtime
          .sendMessage({ type: 'PDF_SELECTION_READY', tabId })
          .catch(() => undefined);
        return;
      }
      // Keep the selected document open if a browser does not expose the side panel API.
      await chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?sourceTab=${tabId}`) });
    })
    .catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((id) => {
  clearTab(id);
  void chrome.storage.session.remove(pdfSelectionKey(id));
});
// Navigation/scroll tracking may report loading without replacing the document.
// Content-port disconnection and tab closure own cancellation, not tab status.
async function handle(
  msg: Record<string, unknown> & {
    type: string;
    tabId: number;
    style: (typeof explanationStyles)[number];
  },
  sender: chrome.runtime.MessageSender,
) {
  await initialized;
  if (sender.id !== chrome.runtime.id) throw new Error('不允许的消息来源。');
  const isTrusted = trusted(sender);
  if (msg.type === 'OPEN_OPTIONS') {
    await chrome.runtime.openOptionsPage();
    return null;
  }
  if (msg.type === 'TAKE_PDF_SELECTION') {
    if (!isTrusted) throw new Error('该操作仅限扩展界面。');
    if (!Number.isInteger(msg.tabId) || msg.tabId < 0) throw new Error('无法识别当前 PDF 页面。');
    const key = pdfSelectionKey(msg.tabId);
    const saved = await chrome.storage.session.get(key);
    const selection = saved[key];
    if (!selection) return null;
    await chrome.storage.session.remove(key);
    return selection;
  }
  if (msg.type === 'CANCEL_TRANSLATION') {
    for (const controller of translationControllers.get(scopeFor(sender)) ?? []) controller.abort();
    return null;
  }
  if (msg.type === 'PUBLIC_SETTINGS') {
    const data = await chrome.storage.local.get(['config', 'mastered', 'reading']);
    return {
      localOnly: data.reading?.localOnly === true,
      codeAnnotations: data.reading?.codeAnnotations === true,
      annotationTypes: normalizeAnnotationTypes(data.reading?.annotationTypes),
      profile: data.config?.profile ?? defaultProfile,
      mastered: data.mastered ?? [],
      quizCount: Number.isInteger(data.reading?.quizCount) ? data.reading.quizCount : 5,
      vocabularyBaseline: data.reading?.vocabularyBaseline ?? 10000,
      vocabularyPerBlock: data.reading?.vocabularyPerBlock ?? 1,
      batchSize: data.reading?.batchSize ?? defaultBatchSize,
      concurrency: data.reading?.concurrency ?? defaultConcurrency,
      maxPerBlock: Number.isInteger(data.reading?.maxPerBlock) ? data.reading.maxPerBlock : 6,
    };
  }
  if (msg.type === 'TEST' && (await chrome.storage.local.get('reading')).reading?.localOnly)
    throw new Error('当前为离线模式。需要 AI 时，请在设置中关闭离线模式。');
  if (msg.type === 'AI') {
    const request = aiRequestSchema.parse(msg.request);
    const pageTranslation =
      msg.pageTranslation === true &&
      request.operation === 'explain' &&
      request.mode === 'translate' &&
      !request.concept &&
      !request.history &&
      !request.question &&
      !request.answer &&
      !request.goal;
    if (
      !isTrusted &&
      request.operation !== 'analyze' &&
      request.operation !== 'pageQuiz' &&
      !pageTranslation
    )
      throw new Error('当前页面只能发起正文难点分析、整页测验和全文翻译。');
    const scope = scopeFor(sender);
    const controller = new AbortController();
    const group = controllers.get(scope) ?? new Set();
    group.add(controller);
    controllers.set(scope, group);
    const translationGroup = translationControllers.get(scope) ?? new Set<AbortController>();
    if (pageTranslation) {
      translationGroup.add(controller);
      translationControllers.set(scope, translationGroup);
    }
    const epoch = cacheEpoch;
    const started = performance.now();
    const requestId =
      typeof msg.requestId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(msg.requestId)
        ? msg.requestId
        : undefined;
    const progress = (partial: AnalysisProgress) => {
      if (requestId && !controller.signal.aborted && epoch === cacheEpoch)
        safePost(documentPorts.get(scope), { type: 'AI_PROGRESS', requestId, ...partial });
    };
    try {
      if ((await chrome.storage.local.get('reading')).reading?.localOnly)
        throw new Error('当前为离线模式。需要 AI 时，请在设置中关闭离线模式。');
      const cfg = await config();
      await assertModelAccess(cfg);
      if (controller.signal.aborted) throw new Error('请求已取消。');
      const subscription = oauthKindOf(cfg);
      const auth = subscription
        ? { getAccessToken: () => getAccessToken(subscription) }
        : undefined;
      const key = cacheKey(
        request,
        { profile: cfg.profile, style: cfg.style, tuning: cfg.tuning },
        cfg.model,
        cfg.baseUrl,
      );
      const cache = caches.get(scope) ?? new SessionCache();
      caches.set(scope, cache);
      const cached = cache.get(key);
      if (cached) return { ...(cached as object), __cached: true };
      const settings = await chrome.storage.local.get('reading');
      queue.setLimit(settings.reading?.concurrency ?? defaultConcurrency);
      const remember = settings.reading?.rememberAnnotations !== false;
      const candidates = request.operation === 'analyze' ? request.candidates : undefined;
      const keys =
        remember && candidates
          ? await Promise.all(
              candidates.map((c) => annotationCache.key(cfg, request.context.title, c)),
            )
          : [];
      const stored = keys.length ? await annotationCache.get(keys).catch(() => []) : [];
      const hits =
        candidates?.flatMap((c, i) =>
          stored[i] ? [{ ...stored[i]!, id: c.id, anchor: c.anchor }] : [],
        ) ?? [];
      if (controller.signal.aborted) throw new Error('请求已取消。');
      if (hits.length) progress({ concepts: hits, skipped: [] });
      const missing = candidates?.filter((c) => !hits.some((h) => h.id === c.id));
      if (candidates && !missing?.length)
        return {
          concepts: hits,
          skipped: [],
          missing: [],
          __cached: true,
          __cacheHits: hits.length,
          __usage: 0,
        };
      const result = await queue.run(
        async () => {
          if (controller.signal.aborted) throw new Error('请求已取消。');
          if ((await chrome.storage.local.get('reading')).reading?.localOnly)
            throw new Error('当前为离线模式。');
          if (controller.signal.aborted) throw new Error('请求已取消。');
          const queueMs = performance.now() - started;
          const value = await callModel(
            cfg,
            missing ? { ...request, candidates: missing } : request,
            controller.signal,
            progress,
            auth,
          );
          return { ...value, __timing: { ...value.__timing, queueMs } };
        },
        request.operation === 'analyze' ? 0 : pageTranslation ? 10 : 100,
      );
      if (controller.signal.aborted) throw new Error('请求已取消。');
      if (remember && candidates && 'concepts' in result) {
        const entries = (result.concepts as typeof hits).flatMap((concept) => {
          const index = candidates.findIndex((c) => c.id === concept.id);
          const key = keys[index];
          return key ? [{ key, concept }] : [];
        });
        await annotationCache
          .put(entries, () => !controller.signal.aborted && epoch === cacheEpoch)
          .catch(() => undefined);
      }
      const merged =
        'concepts' in result
          ? { ...result, concepts: [...hits, ...(result.concepts ?? [])], __cacheHits: hits.length }
          : result;
      // An incomplete batch must remain retryable; completed terms have their own cache.
      if (!('missing' in merged) || !merged.missing?.length) cache.set(key, merged);
      return merged;
    } finally {
      group.delete(controller);
      translationGroup.delete(controller);
    }
  }
  if (msg.type === 'SET_CODE_ANNOTATIONS' || msg.type === 'SET_LOCAL_ONLY') {
    if (typeof msg.enabled !== 'boolean') throw new Error('开关值无效。');
    const data = await chrome.storage.local.get('reading');
    await chrome.storage.local.set({
      reading: {
        ...data.reading,
        [msg.type === 'SET_LOCAL_ONLY' ? 'localOnly' : 'codeAnnotations']: msg.enabled,
      },
    });
    refresh(false);
    return null;
  }
  if (msg.type === 'SET_ANNOTATION_TYPES') {
    if (
      !Array.isArray(msg.types) ||
      msg.types.length > 8 ||
      msg.types.some((item: unknown) => typeof item !== 'string')
    )
      throw new Error('注释类型设置无效。');
    const types = normalizeAnnotationTypes(msg.types);
    if (types.length !== new Set(msg.types).size) throw new Error('注释类型设置包含未知选项。');
    const data = await chrome.storage.local.get('reading');
    await chrome.storage.local.set({ reading: { ...data.reading, annotationTypes: types } });
    refresh(false);
    return null;
  }
  if (msg.type === 'SET_PROFILE') {
    const profile = profileSchema.parse(msg.profile);
    const cfg = await config();
    await chrome.storage.local.set({ config: { ...cfg, profile } });
    refresh();
    return null;
  }
  if (!isTrusted && msg.type !== 'MASTER') throw new Error('该操作仅限扩展界面。');
  if (msg.type === 'OAUTH_STATUS') return oauthStatus(oauthKindInput(msg.kind));
  if (msg.type === 'OAUTH_IMPORT')
    return importChatgptCredentials(String(msg.text ?? '').slice(0, 200000));
  if (msg.type === 'OAUTH_SIGNOUT') return signOut(oauthKindInput(msg.kind));
  if (msg.type === 'SET_READING_PREFS') {
    const prefs = readingPrefsSchema.parse(msg.prefs ?? {});
    const data = await chrome.storage.local.get('reading');
    await chrome.storage.local.set({ reading: { ...data.reading, ...prefs } });
    refresh(false);
    return null;
  }
  if (msg.type === 'SET_STYLE') {
    if (!explanationStyles.includes(msg.style)) throw new Error('解释风格设置无效。');
    const cfg = await config();
    await chrome.storage.local.set({ config: { ...cfg, style: msg.style } });
    refresh();
    return null;
  }
  if (msg.type === 'LEARNING_LIST')
    return readLearningCards((await chrome.storage.local.get(LEARNING_KEY))[LEARNING_KEY]);
  if (['LEARNING_SAVE', 'LEARNING_REVIEW', 'LEARNING_NOTE', 'LEARNING_DELETE'].includes(msg.type)) {
    const cards = readLearningCards((await chrome.storage.local.get(LEARNING_KEY))[LEARNING_KEY]);
    if (msg.type === 'LEARNING_SAVE') {
      const saved = saveLearningCard(cards, learningDraftSchema.parse(msg.draft));
      await chrome.storage.local.set({ [LEARNING_KEY]: saved.cards });
      return saved.card;
    }
    if (msg.type === 'LEARNING_DELETE') {
      const id = learningIdSchema.parse(msg.id);
      await chrome.storage.local.set({ [LEARNING_KEY]: cards.filter((card) => card.id !== id) });
      return null;
    }
    const input =
      msg.type === 'LEARNING_REVIEW' ? reviewInputSchema.parse(msg) : actionInputSchema.parse(msg);
    const card = findLearningCard(cards, input.id, input.revision);
    const updated =
      'rating' in input
        ? reviewLearningCard(card, input)
        : {
            ...card,
            actionNote: input.note,
            actionRecordedAt: input.note ? Date.now() : null,
            revision: card.revision + 1,
          };
    const next = cards.map((item) => (item.id === updated.id ? updated : item));
    assertLearningCapacity(next);
    await chrome.storage.local.set({ [LEARNING_KEY]: next });
    return updated;
  }
  if (msg.type === 'GET_SETTINGS') {
    const data = await chrome.storage.local.get([
      'config',
      'mastered',
      'reading',
      PROVIDER_SETTINGS_KEY,
    ]);
    const parsed = configSchema.safeParse(data.config);
    if (parsed.success) {
      const upgraded = upgradeLocalCpaModel(parsed.data);
      if (upgraded !== parsed.data) {
        await chrome.storage.local.set({ config: upgraded });
        data.config = upgraded;
      }
    }
    return {
      config: data.config,
      mastered: data.mastered,
      reading: data.reading,
      providerSettings: readProviderSettings(
        data[PROVIDER_SETTINGS_KEY],
        parsed.success ? upgradeLocalCpaModel(parsed.data) : undefined,
      ),
    };
  }
  if (msg.type === 'SAVE_PROVIDER_DRAFT') {
    const id = providerId(msg.providerId);
    const draft = providerDraftSchema.parse(msg.config);
    const data = await chrome.storage.local.get(['config', PROVIDER_SETTINGS_KEY]);
    const cfg = configSchema.safeParse(data.config);
    const settings = readProviderSettings(
      data[PROVIDER_SETTINGS_KEY],
      cfg.success ? cfg.data : undefined,
    );
    settings.drafts[id] = draft;
    await chrome.storage.local.set({ [PROVIDER_SETTINGS_KEY]: settings });
    return null;
  }
  if (msg.type === 'SAVE_SETTINGS') {
    const cfg = configSchema.parse(msg.config);
    const subscription = oauthKindOf(cfg);
    if (subscription) {
      if (!(await chrome.permissions.contains({ origins: MODEL_ORIGINS[subscription] })))
        throw new Error('未获得订阅账户接口权限，请先完成登录或重新保存授权。设置没有保存。');
    } else {
      endpoint(cfg.baseUrl);
      if (!(await chrome.permissions.contains({ origins: [endpoint(cfg.baseUrl).origin + '/*'] })))
        throw new Error('未获得模型服务器权限，设置没有保存。');
    }
    const id = providerId(msg.providerId, cfg);
    const data = await chrome.storage.local.get(['config', PROVIDER_SETTINGS_KEY]);
    const previous = configSchema.safeParse(data.config);
    const settings = readProviderSettings(
      data[PROVIDER_SETTINGS_KEY],
      previous.success ? previous.data : undefined,
    );
    settings.activeProviderId = id;
    settings.drafts[id] = providerDraftSchema.parse(cfg);
    await chrome.storage.local.set({ config: cfg, [PROVIDER_SETTINGS_KEY]: settings });
    refresh();
    return null;
  }
  if (msg.type === 'SET_REMEMBER_ANNOTATIONS') {
    if (typeof msg.enabled !== 'boolean') throw new Error('开关值无效。');
    cacheEpoch++;
    const data = await chrome.storage.local.get('reading');
    await chrome.storage.local.set({
      reading: { ...data.reading, rememberAnnotations: msg.enabled },
    });
    if (!msg.enabled) await annotationCache.clear();
    return null;
  }
  if (msg.type === 'CLEAR_ANNOTATION_CACHE') {
    cacheEpoch++;
    await annotationCache.clear();
    return null;
  }
  if (msg.type === 'TEST') {
    const cfg = await config();
    await assertModelAccess(cfg);
    const subscription = oauthKindOf(cfg);
    await queue.run(
      () =>
        callModel(
          cfg,
          {
            operation: 'explain',
            context: {
              title: '连接测试',
              heading: '',
              text: 'An API is an application programming interface.',
              before: '',
              after: '',
            },
          },
          undefined,
          undefined,
          subscription ? { getAccessToken: () => getAccessToken(subscription) } : undefined,
        ),
      100,
    );
    return '连接成功，模型能返回有效的结构化结果。';
  }
  if (msg.type === 'MASTER') {
    const concept = conceptSchema.parse(msg.concept);
    const cfg = await config();
    const data = await chrome.storage.local.get('mastered');
    const entries: Mastered[] = data.mastered ?? [];
    const key = conceptKey(cfg.profile.domain, concept.meaning);
    const entry = {
      key,
      domain: cfg.profile.domain,
      meaning: concept.meaning,
      anchor: concept.anchor,
      createdAt: Date.now(),
    };
    await chrome.storage.local.set({
      mastered: [...entries.filter((item) => item.key !== key), entry],
    });
    refresh(false);
    return entry;
  }
  if (msg.type === 'UNMASTER' && typeof msg.key === 'string') {
    const data = await chrome.storage.local.get('mastered');
    await chrome.storage.local.set({
      mastered: (data.mastered ?? []).filter((item: Mastered) => item.key !== msg.key),
    });
    refresh(false);
    return null;
  }
  if (msg.type === 'CLEAR_SETTINGS') {
    cacheEpoch++;
    await annotationCache.clear();
    await chrome.storage.local.clear();
    refresh();
    return null;
  }
  throw new Error('未知操作。');
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Serialize read/modify/write settings operations across tabs.
  const mutate = [
    'LEARNING_SAVE',
    'LEARNING_REVIEW',
    'LEARNING_NOTE',
    'LEARNING_DELETE',
    'SAVE_SETTINGS',
    'SAVE_PROVIDER_DRAFT',
    'SET_CODE_ANNOTATIONS',
    'SET_LOCAL_ONLY',
    'SET_ANNOTATION_TYPES',
    'SET_PROFILE',
    'SET_READING_PREFS',
    'SET_STYLE',
    'OAUTH_IMPORT',
    'OAUTH_SIGNOUT',
    'MASTER',
    'UNMASTER',
    'CLEAR_SETTINGS',
    'SET_REMEMBER_ANNOTATIONS',
    'CLEAR_ANNOTATION_CACHE',
  ].includes(msg?.type);
  const task = mutate ? mutationTail.then(() => handle(msg, sender)) : handle(msg, sender);
  if (mutate) mutationTail = task.catch(() => undefined);
  task.then(
    (data) => sendResponse({ ok: true, data }),
    (error) =>
      sendResponse({
        ok: false,
        error:
          error?.name === 'ZodError'
            ? '输入或模型配置格式不正确，请检查后重试。'
            : error instanceof Error
              ? error.message
              : '发生未知错误。',
      }),
  );
  return true;
});
