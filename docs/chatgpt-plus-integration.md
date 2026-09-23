# ChatGPT Plus 用量接入调研

核对日期：2026-09-23。正式产品目标是仅通过 Chrome / Edge 扩展商店安装；下述本机 CPA 接入只用于当前个人试用，不作为上架后的默认方案。

## 当前本机试用

已在这台电脑上安装并校验 CLIProxyAPI v7.3.15，导入当前 Codex 登录的 `auth.json`，在 `127.0.0.1:8317` 启动仅本机可访问的服务。使用现有 SOCKS5 代理出站，`gpt-5.6-luna` 的普通和流式 Chat Completions 调用均返回成功；Windows 侧也能连接 WSL 的本机端口。**无需再次进行 OAuth。** 这验证的是当前账号、当前模型和当前版本的可用性，不承诺以后持续兼容或无限额度。

项目设置页新增“ChatGPT Plus · 本机 CPA（个人使用）”可选预设，填好本机访问密钥后保存授权即可切换。密钥位于本机的 `.cache/cpa/extension-key`；代理配置、凭据副本、安装包和日志均在被 Git 忽略的 `.cache/cpa/`。不要将此目录或 Codex 的 `auth.json` 上传到仓库或发给别人。扩展只保存 CPA 本机访问密钥，不接收 ChatGPT 密码和 OAuth 令牌。

可用项目自带的 `scripts/cpa-local.py` 管理：`status` 检查运行状态，`start` 启动，`stop` 停止。首次换机时执行 `setup --auth-file <Codex auth.json 路径> [--proxy-url <本机代理地址>]`；脚本从官方发布页下载固定版本并核对 SHA-256，再生成随机本机密钥和仅绑定 localhost 的配置。当前这台电脑的网络需要 `socks5://127.0.0.1:7890`，该地址不应硬编码到其他设备。

代理与 Codex 桌面应用持有各自的令牌副本。后续若凭据刷新导致连接失效，先用最新 `auth.json` 重新执行 `setup --auth-file ...`；若仍失败，再走 CPA 的 `-codex-login` OAuth 流程。不要在扩展中填写 ChatGPT 账号密码。

## 结论

**不把“登录 ChatGPT 后消耗 Plus 额度”作为当前扩展的发布功能。** OpenAI 为通用模型调用提供的是 Platform API 凭据，API 使用按 API 计费。Plus 所含的 Codex 用量可用于受支持的 Codex 客户端和 Codex SDK，但这不是授予任意浏览器扩展的 Chat Completions 额度。“Sign in with ChatGPT”目前是面向部分合作伙伴的身份登录，登录本身只提供姓名、邮箱和头像，不授予通用模型调用权。[OpenAI API 认证][openai-api-auth]、[ChatGPT/Codex 计价和可用端][codex-pricing]、[Sign in with ChatGPT 发布说明][chatgpt-signin]

CPA（此处指 CLIProxyAPI）可以在本地通过 Codex OAuth 登录，再提供 OpenAI 兼容的接口，因此作为**已有本机服务的高级自定义接口**有技术可行性。它依赖额外的原生程序和未在 OpenAI Platform API 文档中作为第三方通用推理接口提供的 Codex 通道，不能据此承诺 Plus 额度可作为 Easy Learn 的稳定、可上架模型来源。[CLIProxyAPI 项目说明][cpa]

## 与当前项目的对应关系

- 扩展后台向 `Base URL/chat/completions` 发送 `Bearer API Key`，读取 Chat Completions JSON 或流式结果。设置页已有供应商预设、自定义 HTTPS 地址，以及 `localhost` / `127.0.0.1` 地址。现有自定义入口和新增的本机预设都能连接 CPA；已用真实代理检查模型名、普通响应和流式事件。错误响应和未来版本兼容性仍需按需复核。
- 当前配置要求 Base URL、模型名和 API Key，凭据保存在 `chrome.storage.local`。预设能预填前两项，所以“选择服务 → 粘贴 Key → 授权 → 使用”已经基本可行；还可以把预设流程收敛为只要求 Key 的快速设置。
- 不应把开发者自己的通用 API Key 放进扩展包。OpenAI 官方要求 API Key 保密，并明确提醒不要暴露在浏览器或其他客户端代码中。当前用户自带 Key 的本地保存方式也有客户端凭据暴露风险；正式发布时应清楚告知这一点，或改用自己的服务端托管调用和计费。[OpenAI API 认证][openai-api-auth]

## 发布路径比较

| 路径 | 用户步骤 | 能否消耗 Plus 用量 | 适合纯扩展商店安装 | 判断 |
| --- | --- | --- | --- | --- |
| 用户自带服务商 API Key | 选预设，粘贴 Key，授权 | 否；使用 API / 服务商额度 | 是 | **近期主路径**；简化为预设后的单字段设置，并明确费用、数据发送及本地凭据风险。 |
| Easy Learn 自有后端 | 登录 Easy Learn，按产品额度使用 | 否；由运营方支付 API 费用 | 是 | **未来免 Key 路径**；需建账号、计费、用量上限、滥用防护和隐私说明。 |
| CPA 本地代理 | 当前本机可由项目工具准备、启动，再填本机密钥 | 本机实测使用 Codex 通道 | 否 | 当前个人方案；不作为上架默认方案。 |
| CPA 云端代理代管用户 ChatGPT 登录 | 用户登录第三方代理 | 技术上可能 | 表面上是 | 不建议：凭据与网页内容经过运营方服务器，账号通道、权限、持续可用性均缺少适合此产品的官方保证。 |
| 官方 Codex SDK / app-server | 需要服务器端 Node.js 或本机运行环境及 Codex 认证 | Plus 可用于受支持的 Codex 用法 | 否 | 官方支持的是 Codex 代理工作流，不是当前扩展的通用短文本解释接口。[Codex SDK][codex-sdk] |

## 为什么“内置 CPA”不能满足单独安装扩展的目标

CLIProxyAPI 是代理**服务器**，其仓库提供 Go SDK 嵌入代理；Chrome 扩展的 Manifest V3 后台是事件驱动的 Service Worker，不提供启动打包原生可执行程序的能力。Chrome 的 Native Messaging 可以连接原生程序，但该程序仍需在系统中单独安装并注册 host。把 CPA 改写成扩展内 JavaScript 也无法把 Codex OAuth 通道变成官方的第三方通用 API。[CLIProxyAPI 项目说明][cpa]、[Chrome Native Messaging][chrome-native]、[Chrome Service Worker][chrome-sw]

Chrome 允许扩展向远程 API 发送请求，但要求扩展的可执行逻辑包含在上架包内；远程服务可以处理数据，不可给扩展下发未审核的执行逻辑。若以后使用自有后端，还须在扩展界面和商店材料中说明网页内容、账号数据的发送与处理，并获得所需同意。[Manifest V3 要求][chrome-mv3]、[Chrome 用户数据披露要求][chrome-disclosure]

`chrome.identity.launchWebAuthFlow` 可以在**身份提供方允许相应客户端和回调地址**时实现 OAuth 登录；这个浏览器能力本身不赋予 ChatGPT 模型权限。目前不能把“登录 ChatGPT”按钮设计为可兑现的 Plus 模型来源。[Chrome Identity API][chrome-identity]、[Sign in with ChatGPT 发布说明][chatgpt-signin]

## 建议的产品实现顺序

1. **先交付 API Key 快速连接。** 首屏只选供应商并填写 Key；预设隐藏 Base URL 和模型名，保留高级设置。保存后申请该服务域名权限、测试一次连接，再进入伴读。对未配置用户保持离线词典可用。不要将 ChatGPT 密码、Cookie 或 Codex 凭据作为扩展输入项。
2. **若要真正做到“登录后开始使用”，建设 Easy Learn 后端。** 扩展登录的是 Easy Learn 账号；后端持有服务端 API 凭据、做请求代理和用量控制。若未来取得官方支持的 ChatGPT 授权范围，再单独评估其是否明确包含模型调用权。
3. **正式发布时重新评估 CPA 入口。** 当前项目工具可在开发机安装和启动 CPA；商店扩展本身无法安装原生程序，不把 Plus 用量描述成 API 余额。

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
