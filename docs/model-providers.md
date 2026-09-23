# AI 服务商与模型选择

设置页预设了中国大陆直连接口和海外 / 国际接口。预设仅填写官方 API 地址、模型 ID 和申请入口；需要用户自己的 API Key，不会自动把请求切换到其他模型，也不含免费 API Key。账号资格、区域访问、价格、速率上限和数据保留规则由服务商决定，申请和使用前请查看官方说明。

## 推荐

**首选：阿里云百炼 Qwen3.8 Flash（北京地域）。** Easy Learn 的主要请求是短片段解释、翻译、选择题和严格 JSON 结构。百炼提供 OpenAI 兼容 Chat Completions；Qwen3.8 Flash 支持非思考模式和结构化输出。北京地域官方价格表显示输入每百万 Token ¥0.8、输出每百万 Token ¥2.7，并列出 100 万 Token 免费额度，有效期 90 天（起算时间按百炼开通、模型发布或申请通过中的较晚日期计算）。这对中文技术阅读是一个实用的能力、成本与集成折中；官方的模型选择指南也把 Qwen Flash 列为文档处理的低成本选项。免费额度和价格会变，使用前以控制台为准。

Qwen 预设使用北京地域业务空间专属 Host。到百炼控制台的工作空间管理中复制 API Host，将地址里的 `YOUR_WORKSPACE_ID` 替换掉；API Key 与 Host 必须属于同一地域 / 计费计划。扩展会在该接口上发送 `enable_thinking: false`，并使用 `max_completion_tokens` 限制输出。

**更看重最低调用成本：DeepSeek Flash。** 同样适合短文本任务，官方提供 OpenAI 兼容接口、JSON 输出和非思考模式；收费随峰谷时段及缓存命中变化。对解释或生成质量的取舍，应拿你自己的网页选段做相同题目对照，而不是只看厂商基准。

**海外低延迟备选：GPT-4.1 mini。** 官方资料强调其指令遵循能力和低延迟，并支持 Chat Completions。若想比较另一家海外服务，可试 Gemini 3.8 Flash。Kimi K2.6 使用 Kimi 国际 API，适合希望试用不同模型风格的用户。

以上是按 Easy Learn 当前任务形态作出的选型建议，不是对真实 API 的独立速度或准确率测试。扩展尚未按这些服务商做线上对比评测。

## 预设清单

| 市场分组 | 服务与模型 | 接口特点 |
| --- | --- | --- |
| 中国大陆 | 阿里云百炼 `qwen3.8-flash` | 需把百炼控制台业务空间 API Host 复制到预设地址；北京地域额度和计费见官方价格表。 |
| 中国大陆 | DeepSeek `deepseek-flash` | OpenAI 兼容；非思考模式。按量计费，价格随时段与缓存变化。 |
| 中国大陆 | 智谱 `glm-4.7-flash` | OpenAI 兼容免费额度；受账户并发和速率限制。 |
| 海外 / 国际 | OpenAI `gpt-4.1-mini` | OpenAI 官方 Chat Completions，按量计费。 |
| 海外 / 国际 | Google `gemini-3.8-flash` | Gemini 官方 OpenAI 兼容接口，按量计费。 |
| 海外 / 国际 | Moonshot `kimi-k2.6` | Kimi 官方国际 API，按量计费；服务区域与账户条件以平台为准。 |
| 海外 / 国际 | Groq `qwen/qwen3.8-27b` | 托管 Qwen 模型的 OpenAI 兼容服务；速率限制以 Groq 账户计划为准。 |
| 海外 / 国际 | OpenRouter `openrouter/free` | 免费路由到可用模型，实际模型可能改变并可能限流。 |
| 海外 / 国际 | Google `gemini-2.5-flash-lite` | Gemini 免费额度预设；地区、免费层和数据规则以官方说明为准。 |

选择预设只改填地址和模型名；换服务时会清除原服务密钥。点击保存并授权后才允许扩展向对应服务域名请求。自定义服务仍可填写兼容 Chat Completions 的 HTTPS API；接口必须支持本扩展使用的消息和流式请求。浏览器里的跨源连接还取决于供应商服务器是否允许扩展来源。

## 官方资料

- [百炼模型选择建议](https://help.aliyun.com/zh/model-studio/text-generation-model)、[Qwen3.8 Flash 说明](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)、[百炼价格与免费额度](https://help.aliyun.com/zh/model-studio/model-pricing)
- [百炼 OpenAI 兼容 Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[地域、API Host 与旧域名说明](https://help.aliyun.com/zh/model-studio/regions)
- [DeepSeek API 模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)、[Gemini OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai)
- [Kimi API 文档](https://platform.kimi.ai/docs/overview)
- [Groq Qwen 3.8 27B 模型与限制](https://console.groq.com/docs/model/qwen/qwen3.8-27b)、[OpenRouter 免费模型路由](https://openrouter.ai/openrouter/free)
