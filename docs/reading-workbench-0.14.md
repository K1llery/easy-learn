# 0.14 阅读工作台与模型请求偏好

2026-10-01。目标：中文用户保留外语原文，通过提前准备的生词释义继续阅读。独立工作台无需安装浏览器扩展，扩展内也提供相同页面。

## 使用

```sh
pnpm install --frozen-lockfile
pnpm build:workbench
pnpm workbench
```

打开 `http://127.0.0.1:4178`。端口被占用时用 `EASY_LEARN_PORT=其他端口 pnpm workbench`。工作台仅监听本机回环地址；Windows / WSL 的 localhost 转发受当前 WSL 网络配置影响，本轮不修改网络、代理或防火墙设置。

先在设置中连接 DeepSeek、CPA 或其他已有 API 服务，再打开 PDF / EPUB / TXT / Markdown。文件在浏览器本机提取，导入不请求模型。点击“开启伴读”才开始批量发送候选词及每词最多 420 字符的短语境。默认处理当前章节和接下来两节，可选择准备整份文档；切换章节会调整后续请求优先级。在途请求不会因为暂停而重新发送。流式结果经既有候选校验后逐条显示，悬停与聚焦不请求模型。限流或部分输出失败会暂停，不自动付费重试。

英语可选择词频表前 2000 / 5000 / 10000 词作为基础。该表来自已有公开词频数据，归属见 [词表许可](../public/vocabulary/ATTRIBUTION.md)，不等同于四级 / 六级或个人知识水平。工作台每节按设置密度和长度筛选，最多 100 个候选；不保证检出所有生词。法、德、西、日、韩使用浏览器 `Intl.Segmenter` 分词，暂未提供这些语言的词频等级、完整词形还原或日语词典；候选可能包含熟词。

点击词语可收进生词本或标记“已认识”。同语言已认识的词被隐藏；英语复用已有常见屈折形式过滤，其他语言按具体词形区分。词语释义结合本节上下文，不能把一个词的解释套到不同语境。Anki 导出为 UTF-8 TSV（单词 / 中文含义 / 简短解释 / 语言），只导出主动收集的学习中词语；在 Anki 导入时选择制表符分隔并映射对应字段。本轮复习能力继续使用已有练习功能与 Anki，不实现新的记忆算法。

章节目录、字号、深色模式、键盘聚焦、窄屏布局和重新导入同一文件后的章节位置恢复可用。阅读文件保留在会话内存，不建立自动持久化书库。位置仅按提取内容的 SHA-256 标识保存，不保存正文；文件内容更新后视为新文档，不猜测合并同名书籍。

格式边界：PDF 是文字层提取阅读，不重建图表或原排版；扫描 PDF 需先 OCR。EPUB 读取线性 spine 顺序，不运行书内脚本，不加载远程图片或 iframe；支持常见字体混淆，不支持 DRM 文本。Markdown 按标题组织并显示提取的可读文字与代码；TXT / Markdown 要求 UTF-8。文件最多 100 MB，文本文件最多 12 MB，提取文字最多 300 万字符 / 2000 节；EPUB 单个文字成员最多 8 MB、选取成员总展开量最多 32 MB、成员最多 10000 个。

## 请求偏好

- DeepSeek 官方：思考模式默认沿用原方案；可明确关闭或开启，强度选低 / 高 / 最高。关闭思考时不发送 reasoning_effort；开启时不发送无效的 Temperature。
- OpenAI 兼容接口 / CPA：模型名称不再限制请求偏好，可显式指定支持的 reasoning_effort；Fast 独立发送 `service_tier: priority`，明确关闭时发送 `default`。思考强度不随 Fast 改变。代理版本、上游模型和账户决定是否采用优先通道，选择 Fast 不是获得加速的证明。
- 用户可指定 Temperature（非思考时）和输出 Token 上限；未指定上限时沿用短注释预算，识别到思考模式或非零强度后自动预算至少 8192 Token，避免思考消耗掉短输出预算。手动上限优先；上限不是实际用量。
- 并发 1–6 路、每批 2 / 4 / 6 个候选。降低并发不会取消在途请求，后续派发遵守新上限；主动解释仍优先于队列内自动分析。并发高可能更快完成，也可能限流，不承诺 TPS 提升。
- 预设切换会保存各方案自己的请求偏好，首次切换不借用其他方案的参数或密钥。模型、解释风格和请求偏好参与缓存隔离。
- 网页扩展词汇保持默认关闭，开启后也可选择常用词基础和每段 1–6 个生词候选，不再固定只能新增一词。CLI 命令依然独立于默认关闭的代码注释。

参数依据：[DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)、[CPA 的 Fast 适配说明](https://github.com/router-for-me/pi-cliproxyapi-provider#fast-mode)、[CPA 传输与 priority 反馈 #4586](https://github.com/router-for-me/CLIProxyAPI/issues/4586)。本轮没有更换用户本机 CPA 或主动使用个人凭据测速。

## 开源调研与复用

2026-10-01 读取项目仓库、源文件及 issue。GitHub stars 是当日参考指标，不能等同于活跃用户数，本轮没有可验证的活跃用户量。未复制 GPL / AGPL 产品代码；使用下列项目的需求与设计经验，并直接接入适合当前 TypeScript 工程的成熟库。

| 项目 | 当日 stars / 许可 | 检查的代码或反馈 | 本轮落地 |
| --- | --- | --- | --- |
| [Readest](https://github.com/readest/readest) | 24,755 / AGPL-3.0 | `apps/readest-app/src/services/bookService.ts` 的导入及身份判断；[更新 EPUB 后重复书籍 #5959](https://github.com/readest/readest/issues/5959)、[编码章节路径 #5100](https://github.com/readest/readest/pull/5100) | 正确解码章节路径；同内容恢复位置；不按同名标题误合并文档 |
| [Lute](https://github.com/LuteOrg/lute-v3) | 1,572 / MIT | `lute/parse/space_delimited_parser.py` 的 Unicode 词字符与分词；[已知词形联动 #66](https://github.com/LuteOrg/lute-v3/issues/66)、[前后端 API 分离 #297](https://github.com/LuteOrg/lute-v3/issues/297) | 使用平台 Unicode 分词；词汇状态按语言分隔；共用模型与缓存模块；英语继续复用已有屈折形式过滤 |
| [LinguaCafe](https://github.com/simjanos-dev/LinguaCafe) | 1,460 / GPL-3.0 | [增加语言 #3](https://github.com/simjanos-dev/LinguaCafe/issues/3)、[导入错误不可诊断 #227](https://github.com/simjanos-dev/LinguaCafe/issues/227)、部署与语言安装反馈 | 提供明确导入错误和语言能力边界；本机运行不引入 Docker / MySQL / Python 分词服务 |
| [EPUB.js](https://github.com/futurepress/epub.js) | 6,966 / BSD-2-Clause | `src/container.js`、`src/packaging.js` | 直接使用官方 container、OPF metadata / manifest / spine 解析器，不自行实现 EPUB 规范 |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | 53,665 / MIT | 优先通道适配、[请求挂起 #3530](https://github.com/router-for-me/CLIProxyAPI/issues/3530) | 使用明确 Fast 参数、保留有效输出 / 总超时与手动重试；不把 HTTP/SSE 传输速度当作账户必然能力 |

解析与防护直接使用：已有 **pdf.js**（Apache-2.0）、**EPUB.js 0.3.93**（BSD-2-Clause）、**fflate 0.8.3**（MIT）、**marked 18.0.14**（MIT）、**DOMPurify 3.4.16**（Apache-2.0 OR MPL-2.0）。DOMPurify 使用只保留文本结构、不保留外部资源标签和属性的配置；文档和模型结果通过 React 文本节点展示。准确版本写入 lockfile，不加载远程 CDN 或字体。

Readest 用户还提出 [自选 TTS #258](https://github.com/readest/readest/issues/258)、[WebDAV 备份 #356](https://github.com/readest/readest/issues/356)；Lute 的完整词形关系、书签和更完整词汇状态也有价值。它们留作后续独立功能，不把现有浏览器分词说成词典或成熟语言教学系统。优先接入已有 TTS / 同步 / Anki 生态，不另造算法。

## 本机数据

独立服务连接信息写入 `.cache/workbench/settings.json`，Linux 文件权限 0600、目录创建权限 0700；这是本机配置文件，不是操作系统保险库。独立服务只允许自身地址的 JSON API 请求，验证 Origin、Host 和静态路径边界，防止其他网站借用模型接口。工作台与扩展的模型配置分别保存，不自动复制账户或密钥。

生词和阅读位置保存在当前工作台来源的浏览器 localStorage；词语最多 5000 条，写入失败保留原记录。扩展版本和独立版本的生词本目前独立，不能自动跨设备同步。删除单词、清空浏览器站点数据可移除相应记录；扩展的“清除本机数据”也会清除该扩展来源的生词与章节位置。独立服务的注释缓存保留在服务内存，重启清空；扩展继续使用原有 30 天缓存。以上文件、缓存、构建和测试输出均不进入 Git。

## 验证

运行 `pnpm test`、`pnpm build`、`pnpm build:workbench`，以及 WSL 的 Linux Chromium 缓存：

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" pnpm test:e2e
```

新增单元测试覆盖 EPUB spine 顺序、百分号路径、损坏 / 超限 / DRM、Markdown 与脚本过滤、原文定位、重复词、多语言分词、已知词过滤、TSV 导出、参数真实请求体、配置暂存和动态并发。浏览器回归使用本机模拟 API 和公开 / 人工文本，覆盖独立与扩展工作台、四种格式、流式显示、悬停零请求、生词本、位置恢复、限流手动重试、窄屏 / 深色布局以及本机接口边界。没有使用个人账户，尚未完成真实不同模型的 TPS / 语义准确率比较。

本轮验证：160 项单元测试、38 项完整浏览器回归通过；扩展与独立工作台生产构建通过。
