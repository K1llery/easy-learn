import {
  defaultConcurrency,
  defaultBatchSize,
  concurrencyChoices,
  batchSizeChoices,
} from '../core/reading-defaults';
import React, { useEffect, useRef, useState } from 'react';
import { providers, providerFor } from '../core/providers';
import { configSchema, defaultProfile, type Config } from '../core/types';
import { rpc } from './rpc';
import { ModelControls } from './model-controls';
import { inExtension } from './reader-rpc';
export function ReaderSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [config, setConfig] = useState<Config>({
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: '',
    api: 'openai',
    profile: { ...defaultProfile, domain: '外语阅读' },
    style: 'concise',
  });
  const [prefs, setPrefs] = useState({
    batchSize: defaultBatchSize,
    concurrency: defaultConcurrency,
    maxPerBlock: 6,
  });
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState('deepseek'),
    [advanced, setAdvanced] = useState(false);
  const drafts = useRef<Record<string, Config>>({});
  const selected = providers.find((p) => p.id === preset);
  useEffect(() => {
    void rpc('GET_SETTINGS')
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          const id = providerFor(data.config.baseUrl, data.config.model)?.id ?? 'custom';
          setPreset(id);
          setAdvanced(id === 'custom');
        }
        setPrefs({
          batchSize: data.reading?.batchSize ?? defaultBatchSize,
          concurrency: data.reading?.concurrency ?? defaultConcurrency,
          maxPerBlock: data.reading?.maxPerBlock ?? 6,
        });
      })
      .catch((e) => setError(e.message));
  }, []);
  function choose(id: string) {
    drafts.current[preset] = config;
    setPreset(id);
    const provider = providers.find((p) => p.id === id);
    setConfig(
      drafts.current[id] ??
        (provider
          ? {
              ...config,
              baseUrl: provider.baseUrl,
              model: provider.model,
              api: provider.api,
              apiKey: '',
              tuning: undefined,
            }
          : { ...config, baseUrl: '', model: '', api: 'openai', apiKey: '', tuning: undefined }),
    );
    setAdvanced(id === 'custom' || !!provider?.requiresWorkspaceId);
    setMessage('');
    setError('');
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const parsed = configSchema.parse(config);
      await rpc('SAVE_SETTINGS', { config: parsed });
      await rpc('SET_READING_PREFS', { prefs });
      setMessage('连接已保存。');
      onSaved();
    } catch (e) {
      setError(
        (e as Error).name === 'ZodError' ? '请检查模型、密钥与参数范围。' : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="reader-settings card" aria-label="工作台设置">
      <div className="row">
        <h2>模型连接</h2>
        <button type="button" className="quiet" onClick={onClose}>
          完成
        </button>
      </div>
      {inExtension ? (
        <>
          <p className="muted">工作台使用扩展已保存的模型连接与请求偏好。</p>
          <div className="actions">
            <button onClick={() => void chrome.runtime.openOptionsPage()}>打开扩展设置</button>
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          <p>
            选择你使用的 AI 服务，填入访问密钥即可连接。地址与模型已预填；导入文件可以先不连接 AI。
          </p>
          <label htmlFor="reader-provider">服务方案</label>
          <select id="reader-provider" value={preset} onChange={(e) => choose(e.target.value)}>
            <option value="custom">自定义连接</option>
            {providers
              .filter((p) => !p.oauth)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <label htmlFor="reader-key">API Key / CPA 访问密钥</label>
          <input
            id="reader-key"
            type="password"
            required
            autoComplete="off"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          />
          {selected?.signup && (
            <p>
              <a href={selected.signup} target="_blank" rel="noreferrer">
                获取此服务的访问密钥 ↗
              </a>
            </p>
          )}
          <details open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
            <summary>高级连接与速度设置</summary>
            <label htmlFor="reader-base">API Base URL</label>
            <input
              id="reader-base"
              type="url"
              required
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            />
            <label htmlFor="reader-model">模型名称</label>
            <input
              id="reader-model"
              required
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            />
            <div className="prefs-grid" style={{ marginTop: 20 }}>
              <label htmlFor="reader-concurrency">同时请求数</label>
              <select
                id="reader-concurrency"
                value={prefs.concurrency}
                onChange={(e) => setPrefs({ ...prefs, concurrency: Number(e.target.value) })}
              >
                {concurrencyChoices.map((n) => (
                  <option key={n} value={n}>
                    {n} 路
                  </option>
                ))}
              </select>
              <label htmlFor="reader-batch">每批候选数</label>
              <select
                id="reader-batch"
                value={prefs.batchSize}
                onChange={(e) => setPrefs({ ...prefs, batchSize: Number(e.target.value) })}
              >
                {batchSizeChoices.map((n) => (
                  <option key={n} value={n}>
                    {n} 个
                  </option>
                ))}
              </select>
            </div>
            <ModelControls
              config={config}
              onChange={(tuning) => setConfig({ ...config, tuning })}
            />
          </details>
          <p className="form-help">
            连接信息只存放在本机。开启伴读发送候选词的短语境；解释、翻译和测验使用你主动选择的文字。AI
            调用使用该服务的额度。
          </p>
          <div className="actions">
            <button className="primary" disabled={busy}>
              保存连接
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void rpc('TEST')
                  .then(setMessage)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              测试连接
            </button>
          </div>
          {message && (
            <div className="success" role="status">
              {message}
            </div>
          )}
        </form>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
