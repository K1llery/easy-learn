# 将打包产物发布为 GitHub Release 附件

安装包与 SHA-256 校验文件直接在 GitHub runner 上从 Actions 转存到 Release，不需要下载到本地，也不需要另配个人访问令牌。

## 复用已经成功的打包

1. 打开 [Release Easy Learn](https://github.com/K1llery/easy-learn/actions/workflows/release.yml)，点击 **Run workflow**，使用默认的 `master` 分支。
2. 填写 `tag`，例如 `v1.0.0`。新标签会指向产物实际构建的提交；已有标签必须与打包提交相同。
3. `run_id` 留空时使用最近一次成功的 **Package Easy Learn** 运行。也可以从打包运行的网址 `…/actions/runs/37126378257` 中复制数字 ID，指定该次产物。
4. 点击 **Run workflow**。成功后，从运行摘要打开 Release；若为新建草稿，编辑说明后点击 **Publish release**。

若该标签已有 Release，工作流直接为它上传附件，保留标题、说明及发布状态。草稿的同名附件允许重传；已公开 Release 的同名附件不覆盖，GitHub 会报错。开启不可变 Release 的仓库，应在发布草稿前上传全部附件。

只能复用当前仓库成功的 `package.yml` 运行。四个平台的产物必须完整，四段构建版本一致、前三段功能版本与标签一致，且通过 SHA-256 校验。Actions 产物保留 14 天，过期后需要重新打包。已有标签与打包提交不一致时，不会上传；请选择正确的运行或使用新标签。

完整版本使用 `主版本.次版本.修订号.构建号`，如 `1.0.0.12`；标签只使用前三段。构建号自动生成，同一次 CI 打包的四个平台共享编号，详见[版本更替规则](versioning.md)。历史三段安装包仍可按其对应标签转存。新增上游版本准备 job，四个平台共用其元数据；“Re-run failed jobs”补齐原编号的产物，“Re-run all jobs”生成新的完整构建版本。当前运行内重传的平台 Actions 产物会替换同名旧产物，避免重跑时上传冲突；其行为见 [upload-artifact 官方说明](https://github.com/actions/upload-artifact#overwriting-an-artifact)。

## 新版本自动准备 Release

推送 `v*` 标签后，[Package Easy Learn](../.github/workflows/package.yml) 完成 Windows x64、Mac ARM64、Mac x64、浏览器扩展打包，以及桌面 smoke 和浏览器回归，再调用发布工作流，把四个 ZIP 和四个 SHA-256 文件上传到对应 Release。任一打包或测试失败，就不会进入上传步骤。

不存在的 Release 会创建为草稿。打开 [Releases](https://github.com/K1llery/easy-learn/releases)，编辑说明并点击 **Publish release** 即可公开。单独手动运行 **Package Easy Learn** 仍只打包；需要发布时再使用上面的发布入口。

发布工作流仅在上传 job 授予 `contents: write` 与 `actions: read`，原有打包 job 保持只读。实现使用 GitHub CLI 的 [下载运行产物](https://cli.github.com/manual/gh_run_download)、[创建 Release](https://cli.github.com/manual/gh_release_create)和[上传附件](https://cli.github.com/manual/gh_release_upload)命令。
