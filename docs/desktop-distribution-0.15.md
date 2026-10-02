# 0.15.0 桌面与插件分发记录

记录日期：2026-10-02。用户已选择先用自己的 AI 服务密钥，插件仍由点击工具栏开启。目标是省去普通用户安装开发工具与配置后端的过程；没有新增托管 AI 账户或代付额度服务。

## 实现与数据边界

Windows x64 ZIP 内为 `Easy Learn.exe` 与完整 `resources`；Mac ARM64 / x64 ZIP 内为 `Easy Learn.app`。标准库 Go 启动器启动随包 Node.js 24.16.0 和完整 SSR 后端，打开默认浏览器后退出。后端只监听 `127.0.0.1`，默认尝试端口 42780。首次启动不下载运行时，不需要用户 PATH 中的 Node 或 Go。

每用户目录保留模型设置、稳定端口、随机实例令牌和后端 PID。复开通过令牌验证实例身份，不能将其他占用端口的服务误判为本应用；同时启动复用同一实例，不兼容版本提示先退出旧版。端口冲突会选择下一端口并保留选择，降低浏览器本地阅读数据因端口变化而丢失的风险。设置存储路径与明文密钥边界见 [使用说明](desktop-start.md)。实例元数据不等于模型配置，损坏可重建。

退出接口要求工作台同源请求，关闭入站连接，取消连接测试与模型请求。PDF 未导出批注会提示；退出后卸载阅读界面和 PDF 资源。关浏览器标签不等于退出软件。阅读位置、生词仍属浏览器本地数据，PDF 编辑需导出文件。

扩展包可独立使用；首次安装打开设置，更新不重新打开。常见预设只需选择服务和填密钥，自定义地址或工作区参数仍需高级配置。扩展保留持久方案草稿；独立工作台的未保存方案草稿仅在本次设置会话内保留。思考强度、Fast 等现有参数继续走既有模型请求链路。

## 上游调查与复用

- [Ollama](https://github.com/ollama/ollama) 是 MIT 项目；[Windows 启动 / 安装问题](https://github.com/ollama/ollama/issues/13295)提示应验证普通用户账户、原生主机与真实运行环境，而不能以跨平台编译成功代替可用性。
- [Open WebUI Desktop](https://github.com/open-webui/desktop) 的[首次启动讨论](https://github.com/open-webui/desktop/discussions/66)涉及启动时依赖准备卡住；因此运行时在构建时下载并校验，随包分发。[重开行为问题](https://github.com/open-webui/desktop/issues/48)强调复开应恢复用户入口。该桌面项目为 AGPL；未复制其代码。Open WebUI 主项目的自定义许可证也不能按 MIT 使用。
- [Node 单可执行文件机制](https://nodejs.org/api/single-executable-applications.html)已调研；当前采用小型 Go 启动器与官方 Node 运行时，避免另加二进制注入工具、应用框架和运行时动态下载。
- 前端与文档能力继续复用已安装的 PDF.js、EPUB.js、fflate、marked、DOMPurify、React、Zod。包内附对应安装版本许可证、Go 许可证、Node 原包许可证及词频数据归属。未新增 JavaScript 依赖或改动锁文件。星数不能证明实际用户规模。

运行时下载源及完整校验值固定在 `scripts/desktop-runtimes.json`，来源为 [Node 官方校验清单](https://nodejs.org/dist/v24.16.0/SHASUMS256.txt)。复用缓存前同样校验；不降低 TLS 验证，不使用随机加速地址。

## 构建与 GitHub Actions

在仓库根目录、已安装开发依赖及 Go 的开发机执行：

```sh
pnpm install --frozen-lockfile
pnpm package:desktop windows-x64
pnpm package:desktop macos-arm64
pnpm package:desktop macos-x64
pnpm package:extension
```

产物位于忽略的 `artifacts/`。开发机可以跨编译，`pnpm test:desktop <target>` 必须在对应 OS / 架构运行。它启动真正的本机启动器，清空子进程 PATH、使用临时数据目录，并关闭自动浏览器弹出；验证后端和网页资源、重复启动、外站退出拒绝、合法退出、后端 PID 真正结束。测试不依赖用户密钥。

[工作流](../.github/workflows/package.yml) 支持手动执行和推送 `v*` 标签。三个原生桌面 runner 各自打包并运行上述 smoke；Ubuntu job 构建插件和工作台并运行浏览器回归。工具版本及 Actions 提交固定，权限只读，产物保留 14 天，不自动建立 Release 或上传商店。Runner 标签来源：[GitHub 官方说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。本次没有推送代码、触发远端工作流或发布产物。

Mac 原生构建在全部 app 内资源写完后，对 Node 与 app 做临时签名，最后 `codesign --verify --deep --strict`；签名之后不再改 app 内文件。参见 [Apple 签名说明](https://developer.apple.com/library/archive/technotes/tn2206/)与[公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。临时签名不等于发行者签名或公证。面向大众正式分发还需 Windows 发行者签名、Apple Developer ID 与公证，以及 Chrome / Edge 商店审核；不应指导用户关闭系统安全保护。当前 Mac 最低声明系统为 13.5。

## 验证与已修复问题

- `pnpm test`：173 项通过。`pnpm build` 与 `pnpm build:workbench` 通过。
- 浏览器完整回归 57 项通过，使用公开文件和本机模型替身。新增桌面退出测试覆盖未导出 PDF 批注的取消保护、导出后退出和界面资源卸载。最初测试定位器匹配到多个状态元素，改为定位退出提示；不是产品回归。
- 三种桌面包和扩展 ZIP 均生成；SHA-256、目录结构、Mac 可执行权限验证通过，未包含设置、缓存或 node_modules。
- 真实 Windows 主机使用最终原生启动器及随包运行时，空 PATH、隔离目录 smoke 通过，显式校验成功标记。重复启动保持同一后端 PID，退出后 PID 结束。该 smoke 不检验默认浏览器弹出；浏览器交互由独立 e2e 覆盖。
- 一次独立只读复核发现三项并修复：签名后写 PDF 许可证破坏 Mac 密封；长驻启动器不能接收 Finder reopen 事件；退出时连接测试未取消，可能留下外连。连接测试取消回归修复前失败、修复后通过。聚焦独立复核确认三项已解决，没有新明确缺陷。
- 尚未执行真实 Mac 的 Finder 打开 / 重开、公证或 GitHub Actions 远端运行；WSL 跨编译包不构成这些验证。没有付费上游吞吐量测量或真实学习效果实验。
