# 免费服务与速度说明（核查于 2026-09-20）

扩展内置接口、模型与申请入口，不内置共享 API Key。以下远程服务仍需各自的个人账号与 Key；Key 本身不等于付费，是否计费由模型和账户计划决定。插件不自动更换到付费模型、不代为开户、不规避额度限制。免费方案的可用性、并发和限额可能变化，使用前以控制台为准。

| 预设 | 模型 | 使用条件与官方依据 |
| --- | --- | --- |
| 智谱 | `glm-4.7-flash` | 国内平台，个人账号与 Key；官方发布说明免费调用。账户并发限制仍适用。[发布说明](https://www.zhipuai.cn/zh/news/148)、[接口](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash) |
| Groq | `qwen/qwen3.8-27b` | 使用 Free Plan；有请求与 Token 限额，升级计划后不能仅凭预设认定免费。[免费限额](https://console.groq.com/docs/rate-limits)、[兼容接口](https://console.groq.com/docs/openai) |
| OpenRouter | `openrouter/free` | 免费模型路由，可能排队/限流，模型及质量可能变化；没有付费回退列表。[免费路由](https://openrouter.ai/openrouter/free)、[限额](https://openrouter.ai/docs/api_reference/limits) |
| Gemini | `gemini-2.5-flash-lite` | 需免费层项目；开启计费的项目可能收费。中国大陆不在支持区域，免费层内容可能用于改进产品。[价格](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite)、[地区](https://ai.google.dev/gemini-api/docs/available-regions)、[兼容接口](https://ai.google.dev/gemini-api/docs/openai) |

智谱预设使用 `thinking.type=disabled`，Groq 的对应模型使用 `reasoning_effort=none`，避免为简短注释进行长时间深度思考。其他服务不发送这些专用参数。[智谱参数](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)、[Groq 参数](https://console.groq.com/docs/reasoning)。

在设置里选择服务方案，打开“注册 / 获取免费 Key”，创建个人 Key 后粘贴、保存并授权，再测试连接。选择其他服务会清空原服务的输入密钥；不会未经保存就发送到新服务。

## 不需要账号的用法

内置通用释义覆盖一部分常见软件技术词及命令，完全在本机运行，标注不等待模型。它是词典/规则，不是免费的云端 AI。注解明确标明“内置通用释义”；DR 等歧义缩写、正文明确给出其他含义的缩写，仍交给模型处理。切换到“离线模式（不调用 AI）”后，后台阻止新的模型分析、翻译、追问和连接测试。已发出的请求不能撤回费用。

## 可复现实测

本机 Chromium + 本地模拟 API 的 0.5.0 回归结果：

- 500 段软件文本、1,000 处内置词命中：从注入到全部标注约 **32 ms**，**0** API 请求。
- 48 个需要模型判断的候选，分 6 批，每批模拟固定 300 ms：两路并发下约 **945 ms** 完成标注；串行响应延迟本身至少 1,800 ms。
- 第二项用页面 MutationObserver 记录最终完成状态时刻，不把自动化断言的轮询间隔当作插件耗时。未对真实供应商速度进行测量。
- 本地词典命中基准不代表所有文章都能 32 ms 完成。未知概念仍受网络、模型生成、服务排队与限流影响。

执行 README 中的端到端测试，可在 `test-results/local-speed.json` 与 `test-results/parallel-speed.json` 查看当次结果。不会使用个人 API Key。
