# 0.14.1：论文结构、图表与生词筛选

## 修正的原因

0.14.0 的词表是字母顺序，却将前 2000 / 5000 项当作词频基础。这会保留靠前的难词，却标注靠后的简单词。扫描达到候选上限便停止，又导致章节后半部分的生词遗漏。现在依据原始排名重新生成词表，结合 Wikipedia 和 OpenSubtitles 语料；每节扫描完再按低频程度选择候选。常见屈折形式继续使用已有过滤，不把关闭思考、增加并发当作识别精度的修复。

PDF 工作台以前只调用文字提取，按物理页组装所谓“章节”，不展示任何图片。这一实现不能保留论文结构。本轮新增原版视图，并重新建立论文目录；旧 PDF 学习页的测验与选段接口保持兼容。

## 当前行为

- 本机打开 PDF 默认显示**原版（含图表）**。直接复用 pdf.js Canvas 和 TextLayer，保留位图、矢量图、公式和原排版；生词标记叠加在可选择文字层。悬停、键盘聚焦、点击仍只查看预先准备的释义。
- 可以切换“文字伴读”查看提取正文。此视图提供文字重排，不将图表转换成文本或承诺重建原布局；图表请看原版视图。模型不接收 PDF 图片，本轮不实现图片语义分析或 OCR。
- 原版按物理页翻页，目录按逻辑章节导航；两者区分。同页多个标题可以各自定位，章节可以跨页。处理常见的行末断词连字符，并将原版中的两段文字对应到同一词义。标注上下文保持文本来源，原 PDF 不被修改。
- 目录优先采用文档书签与其层级 / 目标位置；结合 `getStructTree` 的 H1–H6 标签。没有书签 / 标签时，利用编号、字号、加粗信息、段落间距和常见论文标题识别层级。过滤页码、重复页眉页脚、图表标题与带编号的代码行；双栏文字尝试按栏顺序读取。
- 目录提取属于启发式分析，不能保证任意复杂论文都正确。未找到可靠标题时明确标为“阅读片段”，不把页码伪装成章节；原版始终可用。旋转文字、复杂表格、跨栏脚注可能需要原版核对。
- 图片型 / 扫描 PDF 可以查看原版，但没有文字层时不执行生词分析，并提示先 OCR。
- 英语词频基础统一用于工作台和扩展。新增合并词频表 **46892 个词条**，工作台 2000 / 5000 / 10000 基础按真实频次顺序截取。扫描完整阅读片段后，优先低频 / 未收录词；常见词形与主动标记“已认识”的词仍被过滤。词频不等于个人掌握程度，未收录项可能含专名，不承诺识别所有生词。

## 复用、来源与许可

词频数据沿用 [imjxyang / English-words](https://github.com/imjxyang/English-words) 的 Wikipedia 原始排名，并接入 [Hermit Dave / FrequencyWords](https://github.com/hermitdave/FrequencyWords) 的 OpenSubtitles 2018 排名。两份**数据**按 CC BY-SA 4.0 使用，合并衍生表也按该许可提供。源码固定 revision、下载输入 SHA-256 与离线生成脚本均保留在仓库，详见 [词表归属](../public/vocabulary/ATTRIBUTION.md)。Google 10000 数据的商业许可限制不适合本项目，调研后未集成。

PDF 复用已安装 **pdfjs-dist 6.3.289**（Apache-2.0）。使用上游兼容构建，解决内嵌 Chromium 尚未支持 `Map / WeakMap.getOrInsertComputed` 时的 Canvas / TextLayer 渲染失败，未自行编写浏览器标准 polyfill。将官方 WASM 解码器、ICC 色彩文件、标准字体和 CMap 随应用打包，保留其许可，不加载 CDN。CSP 仅增加 `wasm-unsafe-eval` 以允许本机解码器；不启用 JavaScript 字符串 eval。

参考官方 [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)、[结构树与文字层关联 #18508](https://github.com/mozilla/pdf.js/discussions/18508)、[文字项顺序不同于阅读顺序 #14493](https://github.com/mozilla/pdf.js/issues/14493)。复用现有书签解析，文字层样式依据安装版本的官方样式改写并隔离；许可全文随 `public/licenses/pdfjs-APACHE-2.0.txt` 提供。

## 验证与使用

验证包含实际词频表的顺序 / 简单词过滤 / 后段低频词优先；带书签与无书签的嵌套标题、标签标题、跨页章节、双栏顺序、页眉页脚和代码行；浏览器中验证真实 PDF Image XObject 被渲染为预期颜色、原版词语释义悬停零请求、文字 / 原版切换、章节导航和图片型文档。

额外用 Mozilla 官方 demo 的公开双栏论文 [TraceMonkey](https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf) 做本机导入和原版显示检查，不纳入仓库，不调用用户模型凭据。用户截图中的论文原文件未提供，因此未对该特定文件逐页验证。

检查命令：`pnpm test`、`pnpm build`、`pnpm build:workbench`、`PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" pnpm test:e2e`。生产构建后刷新工作台并重新导入 PDF；已打开的文档不自动重提取。本机模型配置、生词本保留，文档本身仍不持久化。

本轮结果：167 项单元测试、40 项完整浏览器回归及两种生产构建通过。公开 TraceMonkey 论文识别出 27 项目录（其中 13 项子标题），原版 Canvas / TextLayer 渲染完成，没有页面脚本错误。并发回归的耗时测量改用单调时钟 `performance.now()`，避免系统时间调整影响耗时断言。
