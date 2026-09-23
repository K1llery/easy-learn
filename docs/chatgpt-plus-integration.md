# ChatGPT Plus 用量接入调研

核对日期：2026-09-23。目标产品是仅通过 Chrome / Edge 扩展商店安装的 Easy Learn：用户打开扩展，提供可用凭据，然后开始伴读，无需自行安装本机代理。

## 结论

**不把“登录 ChatGPT 后消耗 Plus 额度”作为当前扩展的发布功能。** OpenAI 为通用模型调用提供的是 Platform API 凭据，API 使用按 API 计费。Plus 所含的 Codex 用量可用于受支持的 Codex 客户端和 Codex SDK，但这不是授予任意浏览器扩展的 Chat Completions 额度。“Sign in with ChatGPT”目前是面向部分合作伙伴的身份登录，登录本身只提供姓名、邮箱和头像，不授予通用模型调用权。[OpenAI API 认证][openai-api-auth]、[ChatGPT/Codex 计价和可用端][codex-pricing]、[Sign in with ChatGPT 发布说明][chatgpt-signin]

CPA（此处指 CLIProxyAPI）可以在本地通过 Codex OAuth 登录，再提供 OpenAI 兼容的接口，因此作为**已有本机服务的高级自定义接口**有技术可行性。它依赖额外的原生程序和未在 OpenAI Platform API 文档中作为第三方通用推理接口提供的 Codex 通道，不能据此承诺 Plus 额度可作为 Easy Learn 的稳定、可上架模型来源。[CLIProxyAPI 项目说明][cpa]

## 与当前项目的对应关系

- 扩展后台向 `Base URL/chat/completions` 发送 `Bearer API Key`，读取 Chat Completions JSON 或流式结果。设置页已有供应商预设、自定义 HTTPS 地址，以及 `localhost` / `127.0.0.1` 地址。现有自定义入口理论上可连接用户**自己已启动且自行配置密钥的** CPA；仍需用真实代理检查模型名、流式事件、输出上限和错误响应的兼容性。
- 当前配置要求 Base URL、模型名和 API Key，凭据保存在 `chrome.storage.local`。预设能预填前两项，所以“选择服务 → 粘贴 Key → 授权 → 使用”已经基本可行；还可以把预设流程收敛为只要求 Key 的快速设置。
- 不应把开发者自己的通用 API Key 放进扩展包。OpenAI 官方要求 API Key 保密，并明确提醒不要暴露在浏览器或其他客户端代码中。当前用户自带 Key 的本地保存方式也有客户端凭据暴露风险；正式发布时应清楚告知这一点，或改用自己的服务端托管调用和计费。[OpenAI API 认证][openai-api-auth]

## 发布路径比较

| 路径 | 用户步骤 | 能否消耗 Plus 用量 | 适合纯扩展商店安装 | 判断 |
| --- | --- | --- | --- | --- |
| 用户自带服务商 API Key | 选预设，粘贴 Key，授权 | 否；使用 API / 服务商额度 | 是 | **近期主路径**；简化为预设后的单字段设置，并明确费用、数据发送及本地凭据风险。 |
| Easy Learn 自有后端 | 登录 Easy Learn，按产品额度使用 | 否；由运营方支付 API 费用 | 是 | **未来免 Key 路径**；需建账号、计费、用量上限、滥用防护和隐私说明。 |
| CPA 本地代理 | 另外安装并启动原生代理，完成 Codex OAuth，再填本地地址和密钥 | 技术上可能消耗 Codex 配额 | 否 | 仅保留高级自定义地址兼容，不作为默认或宣传卖点。 |
| CPA 云端代理代管用户 ChatGPT 登录 | 用户登录第三方代理 | 技术上可能 | 表面上是 | 不建议：凭据与网页内容经过运营方服务器，账号通道、权限、持续可用性均缺少适合此产品的官方保证。 |
| 官方 Codex SDK / app-server | 需要服务器端 Node.js 或本机运行环境及 Codex 认证 | Plus 可用于受支持的 Codex 用法 | 否 | 官方支持的是 Codex 代理工作流，不是当前扩展的通用短文本解释接口。[Codex SDK][codex-sdk] |

## 为什么“内置 CPA”不能满足单独安装扩展的目标

CLIProxyAPI 是代理**服务器**，其仓库提供 Go SDK 嵌入代理；Chrome 扩展的 Manifest V3 后台是事件驱动的 Service Worker，不提供启动打包原生可执行程序的能力。Chrome 的 Native Messaging 可以连接原生程序，但该程序仍需在系统中单独安装并注册 host。把 CPA 改写成扩展内 JavaScript 也无法把 Codex OAuth 通道变成官方的第三方通用 API。[CLIProxyAPI 项目说明][cpa]、[Chrome Native Messaging][chrome-native]、[Chrome Service Worker][chrome-sw]

Chrome 允许扩展向远程 API 发送请求，但要求扩展的可执行逻辑包含在上架包内；远程服务可以处理数据，不可给扩展下发未审核的执行逻辑。若以后使用自有后端，还须在扩展界面和商店材料中说明网页内容、账号数据的发送与处理，并获得所需同意。[Manifest V3 要求][chrome-mv3]、[Chrome 用户数据披露要求][chrome-disclosure]

`chrome.identity.launchWebAuthFlow` 可以在**身份提供方允许相应客户端和回调地址**时实现 OAuth 登录；这个浏览器能力本身不赋予 ChatGPT 模型权限。目前不能把“登录 ChatGPT”按钮设计为可兑现的 Plus 模型来源。[Chrome Identity API][chrome-identity]、[Sign in with ChatGPT 发布说明][chatgpt-signin]

## 建议的产品实现顺序

1. **先交付 API Key 快速连接。** 首屏只选供应商并填写 Key；预设隐藏 Base URL 和模型名，保留高级设置。保存后申请该服务域名权限、测试一次连接，再进入伴读。对未配置用户保持离线词典可用。不要将 ChatGPT 密码、Cookie 或 Codex 凭据作为扩展输入项。
2. **若要真正做到“登录后开始使用”，建设 Easy Learn 后端。** 扩展登录的是 Easy Learn 账号；后端持有服务端 API 凭据、做请求代理和用量控制。若未来取得官方支持的 ChatGPT 授权范围，再单独评估其是否明确包含模型调用权。
3. **保留 CPA 的高级兼容入口即可。** 在用户主动填写自定义地址时接入其已有代理；不内置下载、启动或托管 CPA，不把 Plus 余额描述成 API 余额。

上线前还需单独审查扩展当前 20 秒内部心跳的用途和生命周期：Chrome 文档说 Service Worker 会在空闲时终止，持续保活仅在少数企业和教育场景适用，不适合作为普通商店扩展的长期运行前提。[Chrome Service Worker][chrome-sw]

[openai-api-auth]: https://developers.openai.com/api/reference/overview#authentication
[codex-pricing]: https://learn.chatgpt.com/docs/pricing
[chatgpt-signin]: https://learn.chatgpt.com/docs/changelog
[cpa]: https://github.com/router-for-me/CLIProxyAPI
[codex-sdk]: https://learn.chatgpt.com/docs/codex-sdk
[chrome-native]: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
[chrome-sw]: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
[chrome-mv3]: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
[chrome-disclosure]: https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements
[chrome-identity]: https://developer.chrome.com/docs/extensions/reference/api/identity
