# Easy Learn · 读懂，再学会

外语阅读辅助工具，提供 Chrome / Edge 扩展和 Windows / macOS 阅读工作台。保留原文，帮助理解内容、积累生词并练习所学。

- **网页伴读**：生词、术语与命令释义，全文双语翻译，选段解释和测验。
- **文件阅读**：支持 PDF、EPUB、TXT、Markdown，提供目录导航、PDF 批注和生词本，可导出到 Anki。
- **自选 AI 服务**：连接自己的模型 API 或本机模型；导入和阅读文件无需连接 AI。

## 安装与使用

从 [GitHub Releases](https://github.com/K1llery/easy-learn/releases) 的 **Assets** 下载对应 ZIP；尚未发布的试用包可在 [GitHub Actions 打包页面](https://github.com/K1llery/easy-learn/actions/workflows/package.yml) 的 **Artifacts** 下载。

- **桌面版**：Windows 解压后运行 `Easy Learn.exe`；Mac 选择对应芯片版本，将 `Easy Learn.app` 拖入“应用程序”并打开。无需安装运行环境，详见[桌面使用说明](docs/desktop-start.md)。
- **浏览器扩展**：解压扩展包，在 Chrome / Edge 的扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”。在设置中连接 AI 服务，打开文章后点击工具栏图标开启伴读。

AI 功能会将相关文本发送给所连接的服务，并使用该服务的额度。桌面版目前为未完成发行者签名的测试包，扩展暂未上架浏览器商店。

## 本地开发

需要 Node.js 22.13+（或 24 LTS）及 `package.json` 固定版本的 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm workbench
```

工作台地址为 `http://127.0.0.1:4178`；扩展构建位于 `dist/`，可在浏览器中加载。

[模型连接](docs/model-providers.md) · [多语言翻译](docs/multilingual-translation.md) · [项目架构](docs/architecture-guide.md) · [开发与测试](docs/code-quality.md) · [发布安装包](docs/releases.md)
