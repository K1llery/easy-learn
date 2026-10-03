import React from 'react';
import { modelCapabilities } from '../core/providers';
import { reasoningEfforts, type Config, type ModelTuning } from '../core/types';

export function ModelControls({
  config,
  onChange,
}: {
  config: Config;
  onChange: (tuning: ModelTuning) => void;
}) {
  const caps = modelCapabilities(config.baseUrl, config.api);
  const tuning = config.tuning ?? {};
  const update = (patch: Partial<ModelTuning>) => onChange({ ...tuning, ...patch });
  const efforts = caps.deepseek ? ['auto', 'low', 'high', 'max'] : reasoningEfforts;
  return (
    <fieldset className="model-controls">
      <legend>速度与思考</legend>
      <div className="prefs-grid">
        {caps.thinking && (
          <>
            <label htmlFor="thinking-mode">思考模式</label>
            <select
              id="thinking-mode"
              value={tuning.thinking ?? 'auto'}
              onChange={(e) => update({ thinking: e.target.value as ModelTuning['thinking'] })}
            >
              <option value="auto">跟随方案默认</option>
              <option value="disabled">关闭 · 优先快速释义</option>
              <option value="enabled">开启 · 深入推敲</option>
            </select>
          </>
        )}
        {caps.effort && (
          <>
            <label htmlFor="reasoning-effort">思考强度</label>
            <select
              id="reasoning-effort"
              disabled={caps.thinking && tuning.thinking === 'disabled'}
              value={tuning.reasoningEffort ?? 'auto'}
              onChange={(e) =>
                update({ reasoningEffort: e.target.value as ModelTuning['reasoningEffort'] })
              }
            >
              {efforts.map((e) => (
                <option value={e} key={e}>
                  {
                    (
                      {
                        auto: '跟随方案默认',
                        none: '不思考',
                        minimal: '最低',
                        low: '低',
                        medium: '中',
                        high: '高',
                        xhigh: '更高',
                        max: '最高',
                      } as Record<string, string>
                    )[e]
                  }
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="output-limit">输出 Token 上限</label>
        <input
          id="output-limit"
          type="number"
          min={256}
          max={32768}
          step={1}
          placeholder="自动"
          value={tuning.maxOutputTokens ?? ''}
          onChange={(e) =>
            update({ maxOutputTokens: e.target.value ? Number(e.target.value) : undefined })
          }
        />
        {config.api !== 'codex' && (
          <>
            <label htmlFor="temperature">随机性 Temperature</label>
            <input
              id="temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              placeholder="默认 0.2"
              value={tuning.temperature ?? ''}
              onChange={(e) =>
                update({ temperature: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </>
        )}
      </div>
      {caps.fast && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={tuning.fast === true}
            onChange={(e) => update({ fast: e.target.checked })}
          />
          <span>Fast · 请求优先通道</span>
        </label>
      )}
      <p className="form-help">
        调整后保存生效。思考模式会占用输出预算，启用后自动预算至少 8192
        Token；手动上限优先。思考开启时不发送 Temperature。
      </p>
      {caps.fast && (
        <p className="form-help">
          Fast 会发送 service_tier: priority。是否生效取决于模型、账户和 CPA 版本 /
          传输方式，可能更快消耗额度；关闭时显式请求标准通道。思考强度与 Fast 独立。
        </p>
      )}
      {caps.effort && !caps.deepseek && (
        <p className="form-help">
          可用强度由模型决定，自定义接口需确认支持所选参数。参数不被支持时显示错误，由你调整后重试。
        </p>
      )}
    </fieldset>
  );
}
