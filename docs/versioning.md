# 版本更替规则

本规则适用于 Easy Learn 的浏览器扩展、阅读工作台和桌面安装包，AI 与人工开发均须执行。规则启用时，软件从 `0.16.0` 升至 `1.0.0`，对外可简称 **1.0**；后续当前版本以 `package.json` 为准。

## 四段版本

完整构建版本为 `主版本.次版本.修订号.构建号`，例如 `6.1.1.2024`。前三段称为功能版本；最后一段标识构建。

| 类型   | 递增条件                                                         | 示例                             | 低位处理           |
| ------ | ---------------------------------------------------------------- | -------------------------------- | ------------------ |
| 主版本 | 大量功能发生重大改变或升级，例如重构主要学习流程、大规模功能替换 | `5.8.3` → `6.0.0`（V5 → V6）     | 次版本、修订号归零 |
| 次版本 | 增加新功能或改进现有功能，例如新增阅读方式、改进生词复习流程     | `6.0.3` → `6.1.0`（V6.0 → V6.1） | 修订号归零         |
| 修订号 | 修复错误或问题，例如修复切换译文语言后不更新                     | `6.1.0` → `6.1.1`                | 保留主版本、次版本 |
| 构建号 | 构建、编译或打包时自动生成新的构建标识                           | `6.1.1.2023` → `6.1.1.2024`      | 功能版本不变       |

比较顺序是从左到右按整数比较：`1.0.0` → `1.0.1` → `1.1.0` → `2.0.0`；同一功能版本下再比较构建号。不得用字符串字典顺序比较，例如 `1.10.0` 高于 `1.9.0`。

同一任务包含多个类型时取最高级别，只递增一次。代码行数多少不直接决定主版本；应判断软件的主要功能和使用方式是否发生重大变化。纯文档、测试及不改变软件行为的维护不递增前三段；需要验证时仍产生新构建号。用户明确指定目标版本时遵照指定版本，本次迁移保持 `1.0.0`。

## 文件与命令

- `package.json`：三段功能版本的唯一基准，例如 `1.0.0`。
- `public/manifest.json`：扩展源模板，三段版本必须与基准一致。
- `CHANGELOG.md`：每次功能版本变更说明变更内容、递增原因和验证。
- `AGENTS.md`：要求 AI 每次任务读取本规则、判断变化级别、同步版本并执行检查。
- `scripts/version.mjs`：检查一致性、递增功能版本及分配构建号。
- 产物中的 `version.json`：记录 `releaseVersion`、`buildNumber`、完整 `version` 和 `builtAt`。打包文件名使用完整版本，例如 `Easy-Learn-1.0.0.12-extension.zip`。

```sh
pnpm version:check
pnpm version:bump major
pnpm version:bump minor
pnpm version:bump patch
```

每个任务只选一个递增命令，不按列表连续执行。命令同步修改 `package.json` 和扩展源模板，高位递增时重置较低的功能版本位；随后补充变更日志。`pnpm lint` 和所有构建入口均先检查版本一致性，版本无效或不同步时停止。

## 构建号自动分配

- 本地工作区在 `.cache/version/counter.json` 保存计数器，每次顶层构建或打包加一，跨功能版本继续累加。计数器使用独占锁和原子替换，并发构建不会分到同一个号。失败的构建也占用已分配编号，避免复用。
- `pnpm package:extension` 和 `pnpm package:desktop <target>` 各代表一次打包任务，其内部编译与组装共用一个构建号，不重复加号。单独运行 `pnpm build` 或 `pnpm build:workbench` 则是新的构建任务。
- GitHub Actions 的上游 `version` job 自动使用 `GITHUB_RUN_ID × 100 + GITHUB_RUN_ATTEMPT`，把元数据传给四个平台。同一次打包共用一个号；只重跑失败 job 时复用已成功的上游编号，以补齐同一批产物；重跑所有 job 时分配新的构建号，不依赖临时 runner 的计数器。重跑次数必须为 1–99，结果必须处于 JavaScript 安全整数范围，超出范围停止而不回绕。[GitHub 运行变量说明](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)。
- 本地编号只保证同一工作区内单调递增。迁移工作区需保留该计数器；不要删除 `.cache/version/` 来重置编号。独立工作区使用各自计数器，正式多平台发布使用统一 CI 打包运行。
- 同一任务内部通过 `EASY_LEARN_BUILD_METADATA` 传递已分配版本；这是脚本间复用机制，日常构建无需手工设置。

```sh
pnpm build
pnpm build:workbench
pnpm package:extension
pnpm package:desktop windows-x64
pnpm package:desktop macos-arm64
pnpm package:desktop macos-x64
```

构建输出、ZIP 与校验文件不入库。源版本不会因构建而变脏；计数器也不提交。构建结束后可从终端输出及 `dist/version.json`、`dist-workbench/version.json` 查到实际构建版本。桌面包还包含 `desktop-version.json`，桌面兼容检查使用完整构建版本。

## 平台字段与发布

Chrome / Edge 的 `manifest.version` 使用三段功能版本；`version_name` 显示完整四段构建版本，安装包和 `version.json` 同样保留四段。Chrome 要求数值版本的每段不超过 65535，因此不把可能较大的 CI 构建号塞入该字段。浏览器自动升级比较的是功能版本；向商店提交新更新仍须提升前三段。[Chrome 官方版本格式说明](https://developer.chrome.com/docs/extensions/reference/manifest/version)。

macOS 的 `CFBundleShortVersionString` 使用三段功能版本，`CFBundleVersion` 使用自动生成的整数构建号，完整四段版本保留在文件名和元数据中。[Apple 功能版本说明](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring)、[构建版本说明](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)。

Git 标签使用三段功能版本，例如 `v1.0.0`，上游版本 job 在标签与源版本不符时立即停止。Release 验证安装包前三段与标签一致，且四个平台完整构建版本相同。不要用修订号替代构建号，也不要为了普通打包改变功能版本。历史记录、第三方依赖、工具链版本与运行时版本保持其自身编号。

## AI 每次任务的执行顺序

1. 读取本文件和 `AGENTS.md`，运行 `pnpm version:check`，检查现有分支是否已为当前任务递增，避免续做时重复递增。
2. 完成变更并判断级别；需要递增时执行一次对应命令，更新 `CHANGELOG.md`。
3. 运行 lint、审查改动、格式化，再执行适合改动的测试和构建。构建号由脚本自动分配。
4. 提交前重新检查版本一致性；仅提交源版本和变更记录，报告功能版本、产物构建版本以及验证结果。
