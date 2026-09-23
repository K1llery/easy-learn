// Provider presets checked against official API documentation on 2026-09-23.
// Presets contain no credentials and never switch models or providers automatically.
export const providers = [
  {
    id: 'local-cpa', market: 'local', name: 'ChatGPT Plus · 本机 CPA（个人使用）',
    baseUrl: 'http://127.0.0.1:8317/v1', model: 'gpt-6-luna',
    signup: 'https://github.com/router-for-me/CLIProxyAPI',
    docs: 'https://github.com/router-for-me/CLIProxyAPI',
    note: '使用本机 CPA 和当前 ChatGPT Plus 账户的 Codex 用量。GPT-6 Luna 在翻译时关闭思考，其他任务使用低强度思考。填写本机 CPA 的访问密钥；无需在扩展中填写 ChatGPT 密码。此方案仅供当前个人使用。'
  },
  {
    id: 'deepseek', market: 'cn', name: 'DeepSeek · Flash（中国大陆）',
    baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    signup: 'https://platform.deepseek.com/api_keys',
    docs: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    note: '官方直连接口，按量计费。预设关闭思考模式，适合整页轻量注释；不会自动切换到更贵的模型。'
  },
  {
    id: 'qwen', market: 'cn', requiresWorkspaceId: true, name: '阿里云百炼 · Qwen3.8 Flash（中国大陆）',
    baseUrl: 'https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash',
    signup: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    docs: 'https://help.aliyun.com/zh/model-studio/qwen3-8-flash',
    note: '适合中文技术阅读，支持结构化输出。保存前从百炼控制台复制北京地域的 API Host，替换地址中的 YOUR_WORKSPACE_ID。官方价格表列有 100 万 Token 免费额度，有效期与账户开通、模型发布和申请时间有关；具体以控制台为准。'
  },
  {
    id: 'zhipu', market: 'cn', name: '智谱 · GLM-4.7-Flash（免费额度）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash',
    signup: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docs: 'https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash',
    note: '国内平台，需创建个人 API Key。免费型号有账户并发/速率限制；预设关闭深度思考。'
  },
  {
    id: 'openai-mini', market: 'global', name: 'OpenAI · GPT-4.1 mini（海外付费）',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
    signup: 'https://platform.openai.com/api-keys',
    docs: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
    note: '官方 OpenAI API，指令遵循好、响应较快，适合简短解释和 JSON 输出；按量计费。账户开通、网络可达性和支付方式受服务商地区规则影响。'
  },
  {
    id: 'gemini-3-8', market: 'global', name: 'Google · Gemini 3.8 Flash（海外付费）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash',
    signup: 'https://aistudio.google.com/apikey',
    docs: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash',
    note: '官方 Gemini API 的 OpenAI 兼容接口。按量计费；中国大陆不在官方支持地区，使用前确认账户、网络和计费可用性。'
  },
  {
    id: 'kimi', market: 'global', name: 'Moonshot · Kimi K2.6（国际 API）',
    baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6',
    signup: 'https://platform.kimi.ai/console',
    docs: 'https://platform.kimi.ai/docs/overview',
    note: '中国团队提供的 Kimi 国际 API，兼容 OpenAI Chat Completions；按量计费。此预设使用官方国际域名，所在地区的访问和账户条件以平台为准。'
  },
  {
    id: 'groq', market: 'global', name: 'Groq · Qwen 3.8 27B（免费计划）',
    baseUrl: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b',
    signup: 'https://console.groq.com/keys', docs: 'https://console.groq.com/docs/rate-limits',
    note: '需注册个人 API Key；免费计划有请求和 Token 限额，使用前确认账户仍在免费计划。预设关闭深度思考。'
  },
  {
    id: 'openrouter', market: 'global', name: 'OpenRouter · 免费模型路由',
    baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free',
    signup: 'https://openrouter.ai/settings/keys', docs: 'https://openrouter.ai/openrouter/free',
    note: '一个接口可路由到多个服务商的免费模型；可能排队或限流，实际模型和质量会变化，不会自动切换到付费模型。'
  },
  {
    id: 'gemini', market: 'global', name: 'Google · Gemini 2.5 Flash-Lite（免费额度）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash-lite',
    signup: 'https://aistudio.google.com/apikey',
    docs: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite',
    note: '需免费层项目；启用计费后可能收费。中国大陆不在官方支持地区；免费层的数据使用规则请查看 Google 条款，只提交愿意交给该服务处理的文本。'
  }
] as const;

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

export function providerOptions(baseUrl: string, model: string, mode?: 'translate' | 'explain' | 'followup') {
  const host = new URL(baseUrl).hostname;
  if (host === '127.0.0.1' && new URL(baseUrl).port === '8317' && model === 'gpt-6-luna') return { reasoning_effort: mode === 'translate' ? 'none' : 'low' };
  if (host === 'api.deepseek.com' && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-chat'].includes(model)) return { thinking: { type: 'disabled' } };
  if (host === 'open.bigmodel.cn' && model === 'glm-4.7-flash') return { thinking: { type: 'disabled' } };
  if ((host === 'dashscope.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com')) && model === 'qwen3.8-flash') return { enable_thinking: false };
  if (host === 'generativelanguage.googleapis.com' && model === 'gemini-3.8-flash') return { reasoning_effort: 'low' };
  return host === 'api.groq.com' && model === 'qwen/qwen3.8-27b' ? { reasoning_effort: 'none' } : {};
}
