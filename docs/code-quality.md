# 代码质量与格式规范

开发使用 Node.js 22.13+（或 24 LTS），pnpm 版本由 `package.json` 固定。ESLint、typescript-eslint、React Hooks 插件与 Prettier 均固定版本，并提交锁文件，避免不同机器自动采用不同规则。

## JavaScript、TypeScript 与界面资源

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
pnpm verify
```

- ESLint 使用 flat config，检查自有 JS/TS 源码、构建脚本、测试及配置；Node 脚本识别 Node 全局变量，TypeScript 由 typescript-eslint 解析。
- 应用源码额外启用类型感知的 Promise 检查，识别漏处理的 Promise、错误的异步回调及对非 Promise 使用 `await`。JSX 事件允许返回 Promise，调用者仍需在事件处理逻辑中处理错误。
- React 检查 Hook 调用顺序和 Effect 等 Hook 的依赖。当前项目未使用 React Compiler，因此只启用这两项核心 Hook 规则。
- Prettier 负责 TS/TSX、JS/MJS、CSS、HTML、JSON、YAML、Markdown 的排版；使用两空格、单引号、分号、尾逗号和 LF，目标行宽 100，保留 Markdown 正文换行。
- `eslint-config-prettier` 放在配置末尾，关闭与格式化冲突的 lint 规则；`.editorconfig` 提供编辑器默认缩进与换行规范。
- `pnpm verify` 顺序运行 lint、格式检查、全部单元测试、扩展构建及阅读工作台构建。它不包括 Go、Python 和需要 Chromium 的浏览器测试，这些检查在 CI 中另外运行。

Node 构建脚本与浏览器源码分别采用对应环境；不把浏览器全局变量开放给 Node 脚本。中文模板文案中的全角空格可以保留。Playwright 测试参数允许空对象 fixture，解构后通过剩余属性排除字段时允许未使用的字段名。模型请求与文档解析模块有意只抛出安全错误文案，因此不要求附带可能包含原始响应的 `cause`。

## Go 启动器

安装 Go 并将 `go`、`gofmt` 加入 PATH 后运行：

```sh
pnpm lint:go
pnpm format:go
pnpm format:go:check
```

`lint:go` 对 Windows amd64、macOS amd64/arm64 和 Linux amd64 分别运行 `go vet`，覆盖平台条件编译文件。跨平台 vet 不代替各原生主机上的桌面启动测试。Go 源码由标准工具 `gofmt` 格式化；格式检查发现差异时返回失败，而不只是列出文件名。Go 命令缺失也会明确失败。

## Python 脚本

Ruff 同时负责 Python lint、导入顺序和格式化，版本固定在 `requirements-dev.txt`。在仓库根目录创建虚拟环境：

```sh
python3 -m venv .cache/quality-venv
. .cache/quality-venv/bin/activate
python -m pip install -r requirements-dev.txt
pnpm lint:python
pnpm format:python
pnpm format:python:check
```

Windows PowerShell 创建虚拟环境使用 `py -3 -m venv .cache/quality-venv`，激活使用 `.\.cache\quality-venv\Scripts\Activate.ps1`，之后命令相同。Python 版本需为 3.10+。Ruff 检查 `scripts/` 下的 Python 文件，启用语法、未使用变量／导入和导入排序规则；采用四空格、100 字符目标行宽。检查不会执行私人代理脚本或需要 API Key 的在线基准测试。

## 检查边界与历史告警

生成目录、依赖、缓存、下载的网页示例 `example/` 不参与 lint 或格式化。Prettier 另外排除词表、许可证、浏览器夹具和 `pnpm-lock.yaml`：词表与许可证保持来源数据，夹具保持原始 DOM／空白，锁文件由 pnpm 管理。不要把新的业务源码放进这些排除目录。

初次接入时发现的 92 处显式 `any` 和 12 处 Hook 依赖告警已全部处理，删除历史迁移基线。所有自有源码、脚本、测试与配置直接按 error 检查，不使用计数豁免。动态模型响应保留原有字段归一化、兼容别名和 schema 校验，不因补类型拒绝已有输出格式。

Hook 修复保留现有触发条件：初始 PDF 地址、弹窗启动和选段学习只在挂载时自动执行一次；显式重试继续使用当前状态。稳定回调保持阅读器并发调度、PDF 查看器按文档初始化和过期响应取消，不将状态变化改为自动重复请求。

## CI 与提交前验证

`.github/workflows/quality.yml` 在分支推送、PR 和手动触发时执行 JS/TS lint、全部格式检查、类型检查、单元测试、双构建与 Chromium 浏览器测试；Go、Python 在独立 job 中检查。既有打包 workflow 也加入 JS/TS lint 与 Prettier 检查，桌面包另外检查 Go。

浏览器回归统一调用 `.github/workflows/browser-tests.yml`，使用 Playwright 官方 `v1.56.1-noble` 镜像中已安装的 Chromium 和系统依赖，不再运行 `playwright install --with-deps`。镜像版本必须与 `package.json` 中的 `@playwright/test` 一致；升级依赖时同步修改镜像和版本检查。扩展使用完整 Chromium 的无头模式加载，不能改用 runner 预装的 Chrome / Edge 替代。

扩展打包 job 在生成 ZIP 与 SHA-256 后直接上传产物，再由独立 job 执行浏览器回归。回归失败仍会使整个工作流失败，并上传 `test-results/` 中的诊断文件，但不会阻止下载已生成的试用包；正式分发前应确认浏览器回归通过。Windows 与 Mac 的原生打包流程不变。

提交前先运行 lint，审查改动，再用 formatter 统一格式，最后运行对应格式检查及测试。涉及生命周期、持久化、架构或并发的实质变更需独立只读审查。应用改动至少运行 `pnpm verify`；阅读器或 UI 改动还需运行受影响的浏览器流程。在 WSL 使用仓库内的 Chromium 缓存：

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" pnpm exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" pnpm test:e2e
```

静态检查与格式化不能证明功能完全无缺陷；现有测试、构建和浏览器验证共同提供回归保护。
