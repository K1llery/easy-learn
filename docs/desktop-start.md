# Easy Learn 一键阅读版

无需安装 Node.js、pnpm、Python 或 Docker。首次启动不下载运行环境。

Windows：将整个压缩包解压到一个固定位置，双击 `Easy Learn.exe`。保留旁边的 `resources` 文件夹。

Mac：选择匹配芯片的版本（Apple 芯片 / Intel），将 `Easy Learn.app` 拖到“应用程序”，双击打开。

软件会启动本机阅读服务并打开默认浏览器。再次打开会复用同一服务。浏览器页面关闭后服务仍在运行；在工作台右上角点击“退出软件”停止服务。退出前请导出尚未保存的 PDF 批注。

选择 AI 服务，填入你自己的访问密钥，保存连接；高级设置可修改地址、模型和性能参数。API 服务的账号与网页聊天会员不是同一种授权。导入文件本身不调用 AI；开启伴读、解释、翻译或测验会使用所连接服务的额度。

模型设置存放在当前用户的数据目录，升级或移动应用时保留：Windows 为 `%LOCALAPPDATA%\Easy Learn`，Mac 为 `~/Library/Application Support/Easy Learn`。它不是系统密码保险库，不要共享设置文件。阅读位置与生词仍保存在当前浏览器中；请沿用同一浏览器，换浏览器前导出生词本。PDF 批注通过导出 PDF 保存。

当前包为未完成发行者签名的测试包。Windows 或 Mac 可能提示来源尚未验证。正式大众发布前应完成 Windows 发行者签名、Apple Developer ID 签名与公证；不要让用户关闭系统安全保护。

浏览器插件目前可通过解压包试用。正式的一键安装需要发布到 Chrome Web Store / Edge Add-ons 并通过审核；插件不需要运行桌面版后端。网页伴读仍由用户点击工具栏图标开启。
