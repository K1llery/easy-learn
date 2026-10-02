# Windows CI 换行与 Actions 运行时修复

记录日期：2026-10-02。

用户提供的两条红色 annotation 是同一次 `pnpm test` 失败的两个呈现：Windows 桌面 job 退出码 1，以及 `tests/reader.test.ts` 第 41 行失败。实际词表含 `the\r`、`you\r`，测试按 `\n` 分行留下 CR。应用阅读器本来已用空白分词，问题在测试读取方式；无需重建词频数据或修改排序算法。

修复将测试与现有阅读器的空白归一化保持一致，并将现有排名与生词筛选检查参数化为 LF / CRLF 两种输入。新的 CRLF 用例修复前复现相同错误，修复后通过。`.gitattributes` 仅对生成的 `public/vocabulary/*.txt` 固定 LF，避免 Windows 检出转换；没有全仓库重新归一化或改动词表内容。

黄色 Node 20 提示来自 Action 自身运行时；`setup-node` 的 `node-version: 24.16.0` 只控制项目命令，不能修改其他 Action 的运行时。工作流升级 checkout / setup-node 到 v5、setup-go / upload-artifact 到 v6、pnpm/action-setup 到 v5，均固定官方提交 SHA，并检查对应 action manifest 声明 `node24`。继续固定项目 Node、Go、pnpm 版本和锁文件安装，权限与触发条件保持原有设置。

官方来源：[checkout 升级说明](https://github.com/actions/checkout#checkout-v5)、[setup-node](https://github.com/actions/setup-node)、[setup-go](https://github.com/actions/setup-go)、[upload-artifact](https://github.com/actions/upload-artifact)、[pnpm setup](https://github.com/pnpm/action-setup)。GitHub API 调查曾遇到限流，改为官方 Git 标签和对应提交内容核验，没有降低 TLS 校验。Mac ARM64 容量排队提示来自托管 runner 调度，与源码失败无关。

本次保留已有 `scripts/build-vocabulary.mjs`、`scripts/build-workbench.mjs` 的未提交格式修改，不纳入修复提交。远端 Actions 仍需推送修复后重新运行；本地验证不能证明远端 run 已成功。

验证：WSL 与真实 Windows 都通过 174 项单测、`pnpm build`、`pnpm build:workbench`。Windows 使用隔离源代码副本、随包 Node 24.16.0、缓存的 pnpm 10.32.1 和锁文件安装，模拟源码 CRLF 检出，生成词表保留 LF；成功标记和每步退出码均核验。首次 Windows 校验因本机 PATHEXT 仅为 `.CPL` 无法找到已经安装的 `vitest.cmd`，在测试进程内补全常见扩展后通过，没有修改全局环境或应用源码。当前仓库没有独立 formatter / lint 命令或配置，类型检查包含在两种构建命令中，暂存差异另用 `git diff --cached --check` 检查。
