import type { ModelTuning } from './types';
// Provider presets checked against official API documentation on 2026-09-29.
// Presets contain no credentials and never switch models or providers automatically.
export type ProviderApi = 'openai' | 'anthropic' | 'codex' | 'claude-oauth';
export type ProviderMarket = 'oauth' | 'local' | 'cn' | 'global';
export type OAuthProviderId = 'chatgpt' | 'claude';
export type Provider = {
  id: string; market: ProviderMarket; api: ProviderApi; name: string;
  baseUrl: string; model: string;
  signup?: string; docs: string; note: string;
  oauth?: OAuthProviderId; requiresWorkspaceId?: boolean;
};
const openai = (overrides: Partial<Provider> & Pick<Provider, 'id' | 'market' | 'name' | 'baseUrl' | 'model' | 'docs' | 'note'>): Provider => ({ api: 'openai', ...overrides });
export const providers: Provider[] = [
  {
    id: 'chatgpt-oauth', market: 'oauth', api: 'codex', oauth: 'chatgpt', name: 'ChatGPT 账户 OAuth（实验性）',
    baseUrl: 'https://chatgpt.com/backend-api/codex', model: 'gpt-6-luna',
    docs: 'https://learn.chatgpt.com/docs/pricing',
    note: '实验性入口：扩展已实现 OAuth 登录流程，但尚未实测 OpenAI 是否接受浏览器扩展的回调地址，不能保证登录或直连成功。官方明确支持 Codex CLI、SDK 和 app-server 的 ChatGPT 登录；当前本机已验证的方案是 CPA。登录成功时令牌仅保存在本机浏览器。'
  },
  {
    id: 'claude-oauth', market: 'oauth', api: 'claude-oauth', oauth: 'claude', name: 'Claude 订阅账户登录（Pro / Max）',
    baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5',
    docs: 'https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan',
    note: '在扩展内用 Claude 订阅账户 OAuth 登录，使用订阅包含的 Claude Code 用量，无需 API Key。令牌只保存在本机浏览器；用量规则与可用性以 Anthropic 官方为准，仅建议个人使用。'
  },
  {
    id: 'local-cpa', market: 'local', api: 'openai', name: 'ChatGPT Plus · 本机 CPA（个人使用）',
    baseUrl: 'http://127.0.0.1:8317/v1', model: 'gpt-6-luna',
    signup: 'https://github.com/router-for-me/CLIProxyAPI',
    docs: 'https://github.com/router-for-me/CLIProxyAPI',
    note: '使用本机 CPA 和当前 ChatGPT Plus 账户的 Codex 用量。可在请求偏好中调整思考强度与 Fast 优先通道，实际速度和额度由代理与账户决定。填写本机 CPA 的访问密钥；无需在扩展中填写 ChatGPT 密码。此方案仅供当前个人使用。'
  },
  {
    id: 'ollama', market: 'local', api: 'openai', name: 'Ollama · 本机模型（免费）',
    baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b',
    docs: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    note: '连接本机 Ollama 的 OpenAI 兼容接口，完全不联网、不消耗额度。先用 ollama pull 拉取模型，模型名须与本地一致；速度取决于本机硬件。'
  },
  {
    id: 'lmstudio', market: 'local', api: 'openai', name: 'LM Studio · 本机模型（免费）',
    baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model',
    docs: 'https://lmstudio.ai/docs/app/api',
    note: '连接本机 LM Studio 服务器（需在软件中启动 Local Server）。模型名可在 LM Studio 的 API 文档页查看；速度取决于本机硬件。'
  },
  {
    id: 'vllm', market: 'local', api: 'openai', name: 'vLLM / 自建推理服务（本机或局域网）',
    baseUrl: 'http://127.0.0.1:8000/v1', model: 'Qwen/Qwen3-8B',
    docs: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
    note: '连接自建 vLLM 等兼容 OpenAI Chat Completions 的推理服务。局域网地址请把 Base URL 改成对应主机（需 HTTPS 或本机地址）。'
  },
  {
    id: 'deepseek', market: 'cn', api: 'openai', name: 'DeepSeek · Flash（中国大陆）',
    baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    signup: 'https://platform.deepseek.com/api_keys',
    docs: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    note: '官方直连接口，按量计费。预设关闭思考模式，适合整页轻量注释；不会自动切换到更贵的模型。'
  },
  {
    id: 'qwen', market: 'cn', api: 'openai', requiresWorkspaceId: true, name: '阿里云百炼 · Qwen3.8 Flash（中国大陆）',
    baseUrl: 'https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash',
    signup: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    docs: 'https://help.aliyun.com/zh/model-studio/qwen3-8-flash',
    note: '适合中文技术阅读，支持结构化输出。保存前从百炼控制台复制北京地域的 API Host，替换地址中的 YOUR_WORKSPACE_ID。官方价格表列有 100 万 Token 免费额度，有效期与账户开通、模型发布和申请时间有关；具体以控制台为准。'
  },
  {
    id: 'zhipu', market: 'cn', api: 'openai', name: '智谱 · GLM-4.7-Flash（免费额度）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash',
    signup: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docs: 'https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash',
    note: '国内平台，需创建个人 API Key。免费型号有账户并发/速率限制；预设关闭深度思考。'
  },
  {
    id: 'siliconflow', market: 'cn', api: 'openai', name: '硅基流动 SiliconFlow（中国大陆）',
    baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B',
    signup: 'https://cloud.siliconflow.cn/account/ak',
    docs: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions',
    note: '国内聚合平台，一个 Key 调用多家开源模型，部分小模型有免费额度；按量计费，具体以控制台为准。'
  },
  {
    id: 'doubao', market: 'cn', api: 'openai', name: '火山方舟 · 豆包（中国大陆）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-flash',
    signup: 'https://console.volcengine.com/ark',
    docs: 'https://www.volcengine.com/docs/82379/1263279',
    note: '字节跳动火山方舟的 OpenAI 兼容接口；需在控制台创建推理接入点，模型名填接入点 ID 或模型版本。按量计费，部分地区有免费额度。'
  },
  {
    id: 'hunyuan', market: 'cn', api: 'openai', name: '腾讯混元（中国大陆）',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest',
    signup: 'https://console.cloud.tencent.com/hunyuan/api-key',
    docs: 'https://cloud.tencent.com/document/product/1729/111007',
    note: '腾讯混元的 OpenAI 兼容接口，需创建混元 API Key；按量计费，具体以控制台为准。'
  },
  {
    id: 'openai', market: 'global', api: 'openai', name: 'OpenAI 官方 API（海外付费）',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-mini',
    signup: 'https://platform.openai.com/api-keys',
    docs: 'https://developers.openai.com/api/docs/models',
    note: '官方 OpenAI API，指令遵循好、响应较快，适合简短解释和 JSON 输出；按量计费。账户开通、网络可达性和支付方式受服务商地区规则影响。'
  },
  {
    id: 'openai-mini', market: 'global', api: 'openai', name: 'OpenAI · GPT-4.1 mini（海外付费）',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
    signup: 'https://platform.openai.com/api-keys',
    docs: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
    note: '官方 OpenAI API 的小型模型，价格低、响应快，适合整页轻量注释；按量计费。'
  },
  {
    id: 'anthropic', market: 'global', api: 'anthropic', name: 'Anthropic · Claude API（海外付费）',
    baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5',
    signup: 'https://console.anthropic.com/settings/keys',
    docs: 'https://docs.claude.com/en/api/overview',
    note: 'Anthropic 官方 Messages 接口，扩展会自动使用原生协议调用；按量计费。中国大陆不在官方支持地区，使用前确认账户、网络和计费可用性。'
  },
  {
    id: 'gemini-3-8', market: 'global', api: 'openai', name: 'Google · Gemini 3.8 Flash（海外付费）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash',
    signup: 'https://aistudio.google.com/apikey',
    docs: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash',
    note: '官方 Gemini API 的 OpenAI 兼容接口。按量计费；中国大陆不在官方支持地区，使用前确认账户、网络和计费可用性。'
  },
  {
    id: 'kimi', market: 'global', api: 'openai', name: 'Moonshot · Kimi K2.6（国际 API）',
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6',
    signup: 'https://platform.kimi.ai/console',
    docs: 'https://platform.kimi.ai/docs/overview',
    note: '中国团队提供的 Kimi 国际 API，兼容 OpenAI Chat Completions；按量计费。此预设使用官方国际域名，所在地区的访问和账户条件以平台为准。'
  },
  {
    id: 'groq', market: 'global', api: 'openai', name: 'Groq · Qwen 3.8 27B（免费计划）',
    baseUrl: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b',
    signup: 'https://console.groq.com/keys', docs: 'https://console.groq.com/docs/rate-limits',
    note: '需注册个人 API Key；免费计划有请求和 Token 限额，使用前确认账户仍在免费计划。预设关闭深度思考。'
  },
  {
    id: 'openrouter', market: 'global', api: 'openai', name: 'OpenRouter · 免费模型路由',
    baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free',
    signup: 'https://openrouter.ai/settings/keys', docs: 'https://openrouter.ai/openrouter/free',
    note: '一个接口可路由到多个服务商的免费模型；可能排队或限流，实际模型和质量会变化，不会自动切换到付费模型。'
  },
  {
    id: 'cline', market: 'global', api: 'openai', name: 'Cline · DeepSeek V4.1 Flash（ClinePass 订阅）',
    baseUrl: 'https://api.cline.bot/api/v1', model: 'cline-pass/deepseek-v4.1-flash',
    signup: 'https://cline.bot/', docs: 'https://github.com/cline/cline/blob/main/docs/api/chat-completions.mdx',
    note: 'Cline 官方网关，使用 ClinePass 订阅用量；模型 ID 需带 provider/ 前缀（如 cline-pass/、openai/、anthropic/）。该网关非流式响应使用 {success, data} 包装、流式为标准 OpenAI 事件，扩展已自动适配。大陆网络可直连，偶发不稳时重试即可。额度与计费以 Cline 官方为准。'
  },
  {
    id: 'mistral', market: 'global', api: 'openai', name: 'Mistral · Small（海外付费）',
    baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest',
    signup: 'https://console.mistral.ai/api-keys',
    docs: 'https://docs.mistral.ai/api/',
    note: 'Mistral 官方 API，兼容 OpenAI Chat Completions；有免费实验层（Beta），按量计费，具体以官方为准。'
  },
  {
    id: 'xai', market: 'global', api: 'openai', name: 'xAI · Grok（海外付费）',
    baseUrl: 'https://api.x.ai/v1', model: 'grok-4-mini',
    signup: 'https://console.x.ai',
    docs: 'https://docs.x.ai/docs/api-reference',
    note: 'xAI 官方 API，兼容 OpenAI Chat Completions；按量计费。账户与地区限制以官方为准。'
  },
  {
    id: 'together', market: 'global', api: 'openai', name: 'Together AI · 开源模型（海外付费）',
    baseUrl: 'https://api.together.xyz/v1', model: 'Qwen/Qwen3-30B-A3B',
    signup: 'https://api.together.ai/settings/api-keys',
    docs: 'https://docs.together.ai/docs/openai-api-compatibility',
    note: '开源模型聚合平台，兼容 OpenAI Chat Completions；新账户通常有少量免费额度，之后按量计费。'
  },
  {
    id: 'gemini', market: 'global', api: 'openai', name: 'Google · Gemini 2.5 Flash-Lite（免费额度）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash-lite',
    signup: 'https://aistudio.google.com/apikey',
    docs: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite',
    note: '需免费层项目；启用计费后可能收费。中国大陆不在官方支持地区；免费层的数据使用规则请查看 Google 条款，只提交愿意交给该服务处理的文本。'
  }
];
export function providerFor(baseUrl: string, model: string) {
  const normalized = baseUrl.replace(/\/$/, '');
  const exact = providers.find(provider => provider.baseUrl === normalized && provider.model === model);
  if (exact) return exact;
  try {
    const host = new URL(normalized).hostname;
    if (model === 'qwen3.8-flash' && host.endsWith('.cn-beijing.maas.aliyuncs.com')) return providers.find(provider => provider.id === 'qwen');
  } catch {
    return undefined;
  }
  return undefined;
}
export function providerOptions(baseUrl: string, model: string, mode?: 'translate' | 'explain' | 'followup', tuning?: ModelTuning) {
  const host = new URL(baseUrl).hostname;
  const defaults = defaultProviderOptions(baseUrl, model, mode);
  const options: Record<string, unknown> = {...defaults};
  const deepseek = host === 'api.deepseek.com';
  const thinking = tuning?.thinking ?? 'auto';
  const effort = tuning?.reasoningEffort ?? 'auto';
  if (deepseek || host === 'open.bigmodel.cn') {
    if (thinking !== 'auto') options.thinking = {type: thinking};
    if (deepseek && thinking !== 'disabled' && effort !== 'auto') {
      options.thinking = {type: effort === 'none' ? 'disabled' : 'enabled'};
      if (effort !== 'none') options.reasoning_effort = effort;
    }
  } else if (host === 'dashscope.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com')) {
    if (thinking !== 'auto') options.enable_thinking = thinking === 'enabled';
  } else if (effort !== 'auto') options.reasoning_effort = effort;
  if (modelCapabilities(baseUrl).fast && tuning?.fast) options.service_tier = 'priority';
  if (modelCapabilities(baseUrl).fast && tuning?.fast === false) options.service_tier = 'default';
  return options;
}
function defaultProviderOptions(baseUrl: string, model: string, mode?: 'translate' | 'explain' | 'followup') {
  const host = new URL(baseUrl).hostname;
  if (['localhost', '127.0.0.1'].includes(host) && new URL(baseUrl).port === '8317' && model === 'gpt-6-luna') return { reasoning_effort: mode === 'translate' ? 'none' : 'low' };
  if (host === 'api.deepseek.com' && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-chat'].includes(model)) return { thinking: { type: 'disabled' } };
  if (host === 'open.bigmodel.cn' && model === 'glm-4.7-flash') return { thinking: { type: 'disabled' } };
  if ((host === 'dashscope.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com')) && model === 'qwen3.8-flash') return { enable_thinking: false };
  if (host === 'generativelanguage.googleapis.com' && model === 'gemini-3.8-flash') return { reasoning_effort: 'low' };
  return host === 'api.groq.com' && model === 'qwen/qwen3.8-27b' ? { reasoning_effort: 'none' } : {};
}

export function modelCapabilities(baseUrl: string, api = 'openai') {
  let host = ''; try { host = new URL(baseUrl).hostname; } catch { /* incomplete draft */ }
  return {
    thinking: api === 'openai' && (host === 'api.deepseek.com' || host === 'open.bigmodel.cn' || host === 'dashscope.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com')),
    deepseek: host === 'api.deepseek.com',
    effort: api === 'codex' || (api === 'openai' && host !== 'open.bigmodel.cn' && !host.endsWith('.maas.aliyuncs.com') && host !== 'dashscope.aliyuncs.com'),
    fast: api === 'codex' || (api === 'openai' && !!host && !['api.deepseek.com','open.bigmodel.cn','dashscope.aliyuncs.com','generativelanguage.googleapis.com','api.groq.com'].includes(host) && !host.endsWith('.maas.aliyuncs.com')),
  };
}
