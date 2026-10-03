import {
  defaultTranslationLanguage,
  translationLanguageInfo,
  type TranslationLanguage,
} from '../core/translation-languages';
import { TranslationLanguageSelect } from './translation-language';
import { defaultConcurrency, defaultBatchSize, concurrencyChoices } from '../core/reading-defaults';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  annotationTypeValues,
  configSchema,
  defaultAnnotationTypes,
  defaultProfile,
  endpoint,
  type AnnotationType,
  type Config,
  type Mastered,
} from '../core/types';
import { providers, providerFor } from '../core/providers';
import type { ProviderSettings } from '../core/provider-settings';
import { LOGIN_ORIGINS, KIND_LABELS, startOAuth, type OAuthKind } from '../core/oauth';
import { rpc, type SettingsResponse } from './rpc';
import './style.css';
import { ModelControls } from './model-controls';
type OAuthState = { signedIn: boolean; email?: string; expiresAt?: number };
type Prefs = {
  translationTargetLanguage: TranslationLanguage;
  quizCount: number;
  maxPerBlock: number;
  batchSize: number;
  concurrency: number;
  vocabularyBaseline: number;
  vocabularyPerBlock: number;
};
const defaultPrefs: Prefs = {
  translationTargetLanguage: defaultTranslationLanguage,
  quizCount: 5,
  maxPerBlock: 6,
  batchSize: defaultBatchSize,
  concurrency: defaultConcurrency,
  vocabularyBaseline: 10000,
  vocabularyPerBlock: 1,
};
function Options() {
  const initialProvider = providers.find((p) => p.id === 'deepseek')!;
  const [form, setForm] = useState<Config>({
    baseUrl: initialProvider.baseUrl,
    model: initialProvider.model,
    api: initialProvider.api,
    apiKey: '',
    profile: defaultProfile,
  });
  const [preset, setPreset] = useState('deepseek'),
    [localOnly, setLocalOnly] = useState(false),
    [advancedConnection, setAdvancedConnection] = useState(false);
  const selected = providers.find((p) => p.id === preset);
  const [hasConfig, setHasConfig] = useState(false);
  const [codeAnnotations, setCodeAnnotations] = useState(false);
  const [annotationTypes, setAnnotationTypes] = useState<AnnotationType[]>(defaultAnnotationTypes);
  const [rememberAnnotations, setRememberAnnotations] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [oauth, setOauth] = useState<Partial<Record<OAuthKind, OAuthState>>>({});
  const [oauthBusy, setOauthBusy] = useState<OAuthKind | ''>('');
  const importInput = useRef<HTMLInputElement>(null);
  const providerDrafts = useRef<ProviderSettings['drafts']>({});
  const [mastered, setMastered] = useState<Mastered[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const subscriptionKind: OAuthKind | null = selected?.oauth ?? null;
  async function load() {
    const data = await rpc<SettingsResponse>('GET_SETTINGS');
    if (data.config) {
      setHasConfig(true);
      setForm(data.config);
      setPreset(
        data.providerSettings?.activeProviderId ??
          providerFor(data.config.baseUrl, data.config.model)?.id ??
          'custom',
      );
      setAdvancedConnection(
        (data.providerSettings?.activeProviderId ??
          providerFor(data.config.baseUrl, data.config.model)?.id ??
          'custom') === 'custom',
      );
    }
    providerDrafts.current = data.providerSettings?.drafts ?? {};
    setPrefs({
      translationTargetLanguage: translationLanguageInfo(data.reading?.translationTargetLanguage)
        .code,
      quizCount: data.reading?.quizCount ?? 5,
      maxPerBlock: data.reading?.maxPerBlock ?? 6,
      batchSize: data.reading?.batchSize ?? defaultBatchSize,
      concurrency: data.reading?.concurrency ?? defaultConcurrency,
      vocabularyBaseline: data.reading?.vocabularyBaseline ?? 10000,
      vocabularyPerBlock: data.reading?.vocabularyPerBlock ?? 1,
    });
    setRememberAnnotations(data.reading?.rememberAnnotations !== false);
    setLocalOnly(data.reading?.localOnly === true);
    setMastered(data.mastered ?? []);
    setCodeAnnotations(data.reading?.codeAnnotations === true);
    setAnnotationTypes(data.reading?.annotationTypes ?? defaultAnnotationTypes);
    for (const kind of ['chatgpt', 'claude'] as OAuthKind[])
      try {
        const status = await rpc<OAuthState>('OAUTH_STATUS', { kind });
        setOauth((prev) => ({ ...prev, [kind]: status }));
      } catch {
        /* keep unknown state blank. */
      }
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const change = (key: 'baseUrl' | 'model' | 'apiKey', value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage('');
  };
  function applyPreset(id: string) {
    providerDrafts.current[preset] = form;
    void rpc('SAVE_PROVIDER_DRAFT', { providerId: preset, config: form }).catch((e) =>
      setError(`未能暂存上一方案：${e.message}`),
    );
    setPreset(id);
    setMessage('');
    setError('');
    const p = providers.find((p) => p.id === id);
    if (id === 'custom' || p?.requiresWorkspaceId) setAdvancedConnection(true);
    setForm(
      providerDrafts.current[id] ??
        (p
          ? {
              ...form,
              baseUrl: p.baseUrl,
              model: p.model,
              api: p.api,
              apiKey: '',
              tuning: undefined,
            }
          : { ...form, baseUrl: '', model: '', api: 'openai', apiKey: '', tuning: undefined }),
    );
  }
  async function persist(cfg: Config, origins: string[]) {
    const granted = await chrome.permissions.request({ origins });
    if (!granted) throw new Error('未授权访问模型服务器，设置没有保存。可以再次点击保存并授权。');
    await rpc('SAVE_SETTINGS', { config: cfg, providerId: preset });
    setHasConfig(true);
    providerDrafts.current[preset] = cfg;
    setMessage('设置已保存，已开启的页面将按新设置重新分析。');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const api = form.api ?? selected?.api ?? 'openai';
      const cfg = configSchema.parse({ ...form, api });
      if (/YOUR_WORKSPACE_ID/i.test(cfg.baseUrl))
        throw new Error(
          '请先将 API Base URL 中的 YOUR_WORKSPACE_ID 替换为百炼控制台里的 API Host，再保存。',
        );
      setBusy(true);
      const kind = selected?.oauth;
      await persist(cfg, kind ? LOGIN_ORIGINS[kind] : [endpoint(cfg.baseUrl).origin + '/*']);
    } catch (e) {
      setError(
        (e as Error).name === 'ZodError'
          ? '请填写模型地址、模型名称、API Key 和学习领域。'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function login(kind: OAuthKind) {
    setOauthBusy(kind);
    setError('');
    setMessage('');
    try {
      const granted = await chrome.permissions.request({ origins: LOGIN_ORIGINS[kind] });
      if (!granted) throw new Error('未授权登录所需的网站权限，登录没有完成。');
      const result = await startOAuth(kind);
      const status = await rpc<OAuthState>('OAUTH_STATUS', { kind });
      setOauth((prev) => ({ ...prev, [kind]: status }));
      setMessage(
        `${KIND_LABELS[kind]} 登录成功${result.email ? `（${result.email}）` : ''}。点击“保存并授权”完成切换。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOauthBusy('');
    }
  }
  async function signOut(kind: OAuthKind) {
    try {
      await rpc('OAUTH_SIGNOUT', { kind });
      setOauth((prev) => ({ ...prev, [kind]: { signedIn: false } }));
      setMessage(`${KIND_LABELS[kind]} 登录信息已从本机删除。`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function importCredentials(file: File) {
    setOauthBusy('chatgpt');
    setError('');
    setMessage('');
    try {
      const result = await rpc<{ email?: string }>('OAUTH_IMPORT', {
        kind: 'chatgpt',
        text: await file.text(),
      });
      const status = await rpc<OAuthState>('OAUTH_STATUS', { kind: 'chatgpt' });
      setOauth((prev) => ({ ...prev, chatgpt: status }));
      setMessage(
        `Codex 凭据已导入本机${result.email ? `（${result.email}）` : ''}。点击“保存并授权”完成切换。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOauthBusy('');
    }
  }
  async function test() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await rpc<string>('TEST'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeAnnotationType(type: AnnotationType, enabled: boolean) {
    const next = enabled
      ? [...new Set([...annotationTypes, type])]
      : annotationTypes.filter((item) => item !== type);
    setAnnotationTypes(next);
    try {
      await rpc('SET_ANNOTATION_TYPES', { types: next });
      setMessage('注释类型已保存，已开启的页面会立即更新。');
    } catch (e) {
      setAnnotationTypes(annotationTypes);
      setError((e as Error).message);
    }
  }
  async function changePrefs(patch: Partial<Prefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      await rpc('SET_READING_PREFS', { prefs: next });
      setMessage('学习偏好已保存，已开启的页面会立即更新。');
    } catch (e) {
      setPrefs(prefs);
      setError((e as Error).message);
    }
  }
  function changeStyle(style: Config['style']) {
    setForm({ ...form, style });
    setMessage('');
  }
  const annotationLabels: Record<AnnotationType, string> = {
    abbreviation: '英文缩写',
    term: '专有名词与技术术语',
    command: 'CLI 命令',
    vocabulary: '扩展词汇（常用词表外，试验）',
  };
  const marketGroups: [string, string][] = [
    ['oauth', '订阅账户登录'],
    ['local', '本机与局域网'],
    ['cn', '中国大陆服务'],
    ['global', '海外 / 国际服务'],
  ];
  return (
    <div className="settings-page">
      <div className="brand">
        <span className="brandmark">E</span>Easy Learn <span className="muted">/ 阅读偏好</span>
      </div>
      <nav className="workspace-nav">
        <a href="reader.html">阅读工作台</a>
        <span>设置</span>
      </nav>
      <header className="settings-heading">
        <div className="eyebrow">阅读偏好</div>
        <h1>阅读设置</h1>
        <p>选择阅读辅助的方式，以及适合自己的模型与速度。</p>
      </header>
      <section className="card">
        <details open={hasConfig}>
          <summary>注释与学习偏好</summary>
          <span className="tag">01 · 注释类型</span>
          <h2 style={{ marginTop: 12 }}>选择需要的注释</h2>
          <p className="muted">点击工具栏图标立即开启；网页浮窗里也能调整这些类型。</p>
          <div className="annotation-options">
            {annotationTypeValues.map((type) => (
              <label className="check-row" key={type}>
                <input
                  type="checkbox"
                  checked={annotationTypes.includes(type)}
                  onChange={(e) => void changeAnnotationType(type, e.target.checked)}
                />
                <span>{annotationLabels[type]}</span>
              </label>
            ))}
            <label className="check-row">
              <input
                type="checkbox"
                checked={codeAnnotations}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setCodeAnnotations(enabled);
                  try {
                    await rpc('SET_CODE_ANNOTATIONS', { enabled });
                  } catch (e) {
                    setCodeAnnotations(!enabled);
                    setError((e as Error).message);
                  }
                }}
              />
              <span>代码注释（不含命令行）</span>
            </label>
          </div>
          <h2 style={{ marginTop: 18 }}>注释密度与节奏</h2>
          <TranslationLanguageSelect
            label="默认译文语言 / Default translation language"
            value={prefs.translationTargetLanguage}
            onChange={(translationTargetLanguage) =>
              void changePrefs({ translationTargetLanguage })
            }
          />
          <div className="prefs-grid">
            <label htmlFor="concurrency">同时请求数</label>
            <select
              id="concurrency"
              value={prefs.concurrency}
              onChange={(e) => void changePrefs({ concurrency: Number(e.target.value) })}
            >
              {concurrencyChoices.map((n) => (
                <option key={n} value={n}>
                  {n} 路{n === defaultConcurrency ? '（默认）' : ''}
                </option>
              ))}
            </select>
            <label htmlFor="max-per-block">每段最多候选</label>
            <select
              id="max-per-block"
              value={prefs.maxPerBlock}
              onChange={(e) => void changePrefs({ maxPerBlock: Number(e.target.value) })}
            >
              <option value={2}>2 个（最克制）</option>
              <option value={4}>4 个</option>
              <option value={6}>6 个（默认）</option>
            </select>
            <label htmlFor="batch-size">每批请求候选数</label>
            <select
              id="batch-size"
              value={prefs.batchSize}
              onChange={(e) => void changePrefs({ batchSize: Number(e.target.value) })}
            >
              <option value={2}>2 个（更平滑）</option>
              <option value={4}>4 个</option>
              <option value={6}>6 个</option>
              <option value={8}>8 个（默认 · 更少批次）</option>
            </select>
            <label htmlFor="vocabulary-baseline">英语常用词基础</label>
            <select
              id="vocabulary-baseline"
              value={prefs.vocabularyBaseline}
              onChange={(e) => void changePrefs({ vocabularyBaseline: Number(e.target.value) })}
            >
              <option value={2000}>前 2000 词</option>
              <option value={5000}>前 5000 词</option>
              <option value={10000}>前 10000 词（默认）</option>
            </select>
            <label htmlFor="vocabulary-per-block">每段生词候选上限</label>
            <select
              id="vocabulary-per-block"
              value={prefs.vocabularyPerBlock}
              onChange={(e) => void changePrefs({ vocabularyPerBlock: Number(e.target.value) })}
            >
              {[1, 2, 4, 6].map((n) => (
                <option key={n} value={n}>
                  {n} 个
                </option>
              ))}
            </select>
            <label htmlFor="quiz-count">整页测验题数</label>
            <select
              id="quiz-count"
              value={prefs.quizCount}
              onChange={(e) => void changePrefs({ quizCount: Number(e.target.value) })}
            >
              <option value={3}>3 道</option>
              <option value={5}>5 道</option>
              <option value={8}>8 道</option>
            </select>
          </div>
          <p className="form-help">
            候选越少，注释越安静、API
            用量越低；批越大，请求轮次越少；并发越高，用量增长越快，也可能触发限流。题数在网页右下角“整页测验”和
            PDF 阅读页生效。
          </p>
          <p className="form-help">
            代码注释默认关闭，命令行有独立开关。开启代码注释会增加候选和 API 用量。
          </p>
          <p className="form-help">
            “扩展词汇”是可选试验功能：依据公开的英语词频表近似筛选，不等同于官方四级词表；可按词频基础和每段上限调整候选，适用于一般英语文章；词频不代表你一定认识，仍可能增加
            API 用量。默认关闭。
          </p>
        </details>
      </section>
      <section className="card">
        <h2>先用免费的本地释义</h2>
        <p>
          常见技术词和已支持的命令即时注释，不等待 AI、不消耗额度。歧义缩写和未知概念才需要模型。
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={localOnly}
            onChange={async (e) => {
              const enabled = e.target.checked;
              setLocalOnly(enabled);
              try {
                await rpc('SET_LOCAL_ONLY', { enabled });
              } catch (e) {
                setLocalOnly(!enabled);
                setError((e as Error).message);
              }
            }}
          />
          <span>离线模式（不调用 AI）</span>
        </label>
      </section>
      <div className="settings-grid">
        <main>
          <form className="card" onSubmit={save}>
            <span className="tag">02 · 模型连接</span>
            <h2 style={{ marginTop: 12 }}>使用自己的 AI 服务</h2>
            <label htmlFor="provider">服务方案</label>
            <select id="provider" value={preset} onChange={(e) => applyPreset(e.target.value)}>
              <option value="custom">自定义服务</option>
              {marketGroups.map(([market, label]) => (
                <optgroup key={market} label={label}>
                  {providers
                    .filter((p) => p.market === market)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <p className="form-help">
              切换时会在本机暂存上一方案的地址、模型和密钥，切换回来即可恢复。点击“保存并授权”才会改变实际连接；“清除本机数据”会删除全部暂存方案。
            </p>
            {subscriptionKind ? (
              <div className="notice">
                <p>{selected!.note}</p>
                <p style={{ marginTop: 10 }}>
                  <b>账户状态：</b>
                  {oauth[subscriptionKind]?.signedIn
                    ? `已登录${oauth[subscriptionKind]?.email ? ` · ${oauth[subscriptionKind].email}` : ''}${oauth[subscriptionKind]?.expiresAt ? ` · 令牌有效期至 ${new Date(oauth[subscriptionKind].expiresAt).toLocaleString('zh-CN')}` : ''}`
                    : '未登录'}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={oauthBusy !== ''}
                    onClick={() => void login(subscriptionKind)}
                  >
                    {oauthBusy === subscriptionKind
                      ? '正在打开登录窗口…'
                      : oauth[subscriptionKind]?.signedIn
                        ? `重新登录 ${KIND_LABELS[subscriptionKind]}`
                        : `登录 ${KIND_LABELS[subscriptionKind]} 账户`}
                  </button>
                  {subscriptionKind === 'chatgpt' && (
                    <>
                      <button
                        type="button"
                        disabled={oauthBusy !== ''}
                        onClick={() => importInput.current?.click()}
                      >
                        导入 Codex auth.json
                      </button>
                      <input
                        ref={importInput}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void importCredentials(file);
                          e.target.value = '';
                        }}
                      />
                    </>
                  )}
                  {oauth[subscriptionKind]?.signedIn && (
                    <button type="button" onClick={() => void signOut(subscriptionKind)}>
                      退出登录
                    </button>
                  )}
                </div>
                <p className="muted">
                  登录窗口由官方站点提供，扩展只拿到令牌并存放在本机浏览器；也可用 Codex CLI 的
                  auth.json 导入。完成后点击下方“保存并授权”即切换到该账户。
                </p>
              </div>
            ) : (
              <div className="notice">
                <p>
                  {selected?.note ??
                    '任意兼容 OpenAI Chat Completions 的服务都可以；保存前需要授予该站点权限。'}
                </p>
                {selected && selected.market !== 'local' && (
                  <>
                    <a href={selected.signup} target="_blank" rel="noreferrer">
                      注册 / 获取 API Key ↗
                    </a>
                    {' · '}
                    {selected.api === 'anthropic' ? (
                      <a href={selected.docs} target="_blank" rel="noreferrer">
                        官方接口说明 ↗
                      </a>
                    ) : (
                      <a href={selected.docs} target="_blank" rel="noreferrer">
                        官方模型 / 接口说明 ↗
                      </a>
                    )}
                    <p className="muted">
                      预设按官方文档于 2026-09-29
                      核对；账户地区、价格与免费额度可能变化，请以官方页面为准。这里只预填接口信息，不含共享密钥。选择后仍需保存授权。
                    </p>
                  </>
                )}
                {selected && selected.market === 'local' && (
                  <p className="muted">
                    本机服务需要先启动；此处仅预填地址与模型。选择后仍需填写访问密钥并保存授权。
                  </p>
                )}
              </div>
            )}
            {!subscriptionKind && (
              <>
                <p>选服务、填密钥、保存授权，然后点击工具栏图标开始伴读。地址和模型已预填。</p>
                <label htmlFor="key">API Key</label>
                <input
                  id="key"
                  required
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => change('apiKey', e.target.value)}
                  autoComplete="off"
                  placeholder="仅保存在当前浏览器"
                />
                <details
                  open={advancedConnection}
                  onToggle={(e) => setAdvancedConnection(e.currentTarget.open)}
                >
                  <summary>高级连接与速度设置</summary>
                  <label htmlFor="base">API Base URL</label>
                  <input
                    id="base"
                    type="url"
                    required
                    placeholder="https://your-provider.example/v1"
                    value={form.baseUrl}
                    onChange={(e) => change('baseUrl', e.target.value)}
                    autoComplete="off"
                  />
                  <p className="form-help">
                    兼容 Chat Completions 的接口；Anthropic 官方 API
                    由扩展自动使用原生协议。部分服务要求使用地域或业务空间专属 API
                    Host，请按预设说明填写。
                  </p>
                  <label htmlFor="model">模型名称</label>
                  <input
                    id="model"
                    required
                    placeholder="填写服务商提供的模型 ID"
                    value={form.model}
                    onChange={(e) => change('model', e.target.value)}
                    autoComplete="off"
                  />
                  <ModelControls
                    config={form}
                    onChange={(tuning) => {
                      setForm({ ...form, tuning });
                      setMessage('');
                    }}
                  />
                </details>
              </>
            )}
            {subscriptionKind && (
              <>
                <label htmlFor="base-ro">API Base URL</label>
                <input
                  id="base-ro"
                  type="url"
                  required
                  value={form.baseUrl}
                  onChange={(e) => change('baseUrl', e.target.value)}
                  autoComplete="off"
                />
                <label htmlFor="model-ro">模型名称</label>
                <input
                  id="model-ro"
                  required
                  value={form.model}
                  onChange={(e) => change('model', e.target.value)}
                  autoComplete="off"
                />
                <p className="form-help">
                  订阅账户登录后无需 API Key；模型名可换成订阅可用的其他模型（如 GPT-6 系列或 Claude
                  系列）。
                </p>
              </>
            )}
            {subscriptionKind && (
              <ModelControls
                config={form}
                onChange={(tuning) => {
                  setForm({ ...form, tuning });
                  setMessage('');
                }}
              />
            )}
            <details className="section-line">
              <summary>解释偏好（高级）</summary>
              <label htmlFor="domain">学习领域</label>
              <input
                id="domain"
                required
                maxLength={80}
                value={form.profile.domain}
                onChange={(e) =>
                  setForm({ ...form, profile: { ...form.profile, domain: e.target.value } })
                }
              />
              <label htmlFor="level">熟悉程度</label>
              <select
                id="level"
                value={form.profile.level}
                onChange={(e) =>
                  setForm({
                    ...form,
                    profile: {
                      ...form.profile,
                      level: e.target.value as Config['profile']['level'],
                    },
                  })
                }
              >
                <option>入门</option>
                <option>熟悉</option>
                <option>进阶</option>
              </select>
              <label htmlFor="style">解释风格</label>
              <select
                id="style"
                value={form.style ?? 'balanced'}
                onChange={(e) => void changeStyle(e.target.value as Config['style'])}
              >
                <option value="concise">简洁 · 一句话结论</option>
                <option value="balanced">平衡（默认）</option>
                <option value="deep">深入 · 补充背景与对比</option>
              </select>
            </details>
            <div className="notice">
              开启伴读后，相关网页正文会发送给你指定的模型服务。
              {subscriptionKind === 'chatgpt'
                ? 'ChatGPT 扩展内 OAuth 尚未完成真实登录验收；若登录成功，会使用账户对应的 Codex 用量，令牌仅存本机。'
                : subscriptionKind
                  ? `订阅登录使用 ${KIND_LABELS[subscriptionKind]} 账户的对应用量，令牌只保存在本机。`
                  : selected?.market === 'local'
                    ? '本机 CPA 会使用已登录账户的 Codex 用量。'
                    : '其他服务可能产生 API 费用。'}
              密钥仅存本机；正文和问答默认不保存；主动保存的练习会在本机保留选段、目标、回答、反馈和实践记录，可在“我的复习”导出或删除。默认在本机保留术语释义
              30 天以加速重复阅读，可在下方关闭或清除。请只在你愿意交给该服务处理的页面开启。
            </div>
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                保存并授权
              </button>
              <button type="button" onClick={test} disabled={busy}>
                测试已保存的连接
              </button>
            </div>
            {busy && (
              <div className="busy" role="status">
                <span className="dot" />
                正在处理…
              </div>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {message && (
              <div className="success" role="status">
                {message}
              </div>
            )}
          </form>
          <section className="card">
            <h2>重复阅读更快</h2>
            <label>
              <input
                type="checkbox"
                style={{ display: 'inline', width: 'auto' }}
                checked={rememberAnnotations}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  try {
                    await rpc('SET_REMEMBER_ANNOTATIONS', { enabled });
                    setRememberAnnotations(enabled);
                    setMessage(enabled ? '已开启术语缓存。' : '已关闭并清除术语缓存。');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />{' '}
              在本机保留术语释义
            </label>
            <p className="muted">
              最多 500 条、保留 30
              天。保存术语与解释，不保存整段正文、代码或问答；解释本身可能包含原文短语。只在语境、模型与学习偏好一致时复用，不混用缩写含义。
            </p>
            <button
              onClick={async () => {
                try {
                  await rpc('CLEAR_ANNOTATION_CACHE');
                  setMessage('术语缓存已清除；当前页面已显示的注释仍可阅读。');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              清除术语缓存
            </button>
          </section>
          <section className="card">
            <span className="tag">03 · 不再显示</span>
            <h2 style={{ marginTop: 12 }}>不再显示的注解</h2>
            <p className="muted">按领域与概念含义区分。恢复后，伴读会重新标注。</p>
            {mastered.length === 0 && (
              <p className="notice">列表为空。在注解里点击“我懂了，不再显示”即可添加。</p>
            )}
            {mastered.map((item) => (
              <div className="learned row" key={item.key}>
                <div>
                  <p>
                    {item.anchor} · {item.meaning}
                  </p>
                  <small>{item.domain}</small>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await rpc('UNMASTER', { key: item.key });
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  恢复显示
                </button>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>把读过的变成会用的</h2>
            <p className="muted">主动回忆、对照反馈，再留下一次实践记录。保存的练习可离线复习。</p>
            <button
              onClick={() =>
                void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html?view=review') })
              }
            >
              打开我的复习
            </button>
          </section>
          <button
            className="quiet"
            onClick={async () => {
              if (
                confirm(
                  '清除本机模型配置、全部暂存方案及密钥、订阅登录令牌、术语缓存、不再显示记录和全部学习练习？',
                )
              ) {
                await rpc('CLEAR_SETTINGS');
                localStorage.removeItem('easy-learn-reader-words-v1');
                for (const key of Object.keys(localStorage))
                  if (key.startsWith('reader-position:')) localStorage.removeItem(key);
                providerDrafts.current = {};
                setForm({ baseUrl: '', model: '', apiKey: '', profile: defaultProfile });
                setMastered([]);
                setCodeAnnotations(false);
                setAnnotationTypes(defaultAnnotationTypes);
                setLocalOnly(false);
                setRememberAnnotations(true);
                setPreset('custom');
                setPrefs(defaultPrefs);
                setOauth({});
                setHasConfig(false);
                setMessage('本机数据已清除。');
              }
            }}
          >
            清除本机数据
          </button>
        </main>
        <aside>
          <div className="side-note">
            <span className="note-number">01</span>
            <h3>从正在读的地方开始</h3>
            <p>点击一次工具栏图标立即开启；悬停网页右侧浮窗可展开设置，或点“整页测验”检验理解。</p>
          </div>
          <div className="side-note">
            <span className="note-number">02</span>
            <h3>解释有依据，也有边界</h3>
            <p>缩写会结合上下文判断。缺少信息时，保留候选解释，不把猜测当结论。</p>
          </div>
          <div className="side-note">
            <span className="note-number">03</span>
            <h3>按自己的节奏阅读</h3>
            <p>读懂的注解可以隐藏，随时在设置中恢复；PDF 也能在配套阅读页中学习。</p>
          </div>
        </aside>
      </div>
      <div className="footer">EASY LEARN · 读懂，再学会 · v0.16.0</div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Options />);
