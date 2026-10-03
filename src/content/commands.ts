import type { Concept } from '../core/types';
// Deliberately small, reviewed vocabulary. Unknown flags/complex shell syntax go
// through contextual AI preloading instead of receiving guessed meanings.
// Sources: docs.astral.sh/uv/concepts/projects/{init,dependencies,run}/
export function explainCommand(text: string): Concept[] | null {
  if (/[\n;&|<>`]|\$\(/.test(text)) return null;
  const words: string[] = text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  if (words[0] === '$') words.shift();
  if (!words.length) return null;
  const parts: { text: string; explanation: string }[] = [];
  let meaning: string, summary: string;
  const add = (i: number, explanation: string) => {
    if (words[i]) parts.push({ text: words[i], explanation });
  };
  if (words[0] === 'uv' && words[1] === 'init') {
    if (
      words.slice(2).some((w) => w.startsWith('-') && w !== '--bare') ||
      words.filter((w) => !w.startsWith('-')).length > 3
    )
      return null;
    meaning = '创建 Python 项目';
    summary =
      '创建一个新的 Python 项目。--bare 表示只生成最小项目配置，不附带示例代码等脚手架文件。';
    if (!words.includes('--bare'))
      summary = '创建一个新的 Python 项目，生成项目配置和默认的初始文件。';
    add(0, 'uv：管理 Python 项目、依赖和环境的工具。');
    add(1, 'init：初始化一个新项目。');
    for (let i = 2; i < words.length; i++)
      add(
        i,
        words[i] === '--bare'
          ? '只创建最小的 pyproject.toml 项目配置，省去示例代码等默认文件。'
          : '新项目的目录名称，可以换成你自己的名字。',
      );
  } else if (
    words[0] === 'uv' &&
    words[1] === 'add' &&
    words.length > 2 &&
    !words.slice(2).some((w) => w.startsWith('-'))
  ) {
    meaning = '添加项目依赖';
    summary = '把这些 Python 包加入项目依赖，并更新项目环境和锁定文件。';
    add(0, 'uv：Python 项目与依赖管理工具。');
    add(1, 'add：添加项目依赖。');
    for (let i = 2; i < words.length; i++)
      add(
        i,
        words[i].replace(/^["']|["']$/g, '') === 'fastapi[standard]'
          ? 'fastapi 是包名；[standard] 请求它的 standard 可选依赖组；引号让 shell 将整段作为一个参数。'
          : '要添加的依赖包名称或依赖声明。',
      );
  } else if (text.trim().replace(/^\$\s+/, '') === 'uv run fastapi dev') {
    meaning = '启动 FastAPI 开发服务';
    summary = '通过项目的 Python 环境启动 FastAPI 开发服务器。';
    add(0, 'uv：管理项目的 Python 环境。');
    add(1, 'run：在项目环境中执行后面的命令。');
    add(2, 'fastapi：FastAPI 的命令行工具。');
    add(3, 'dev：开发模式，会监听代码变化并重新加载。');
  } else if (words[0] === 'cd' && words.length === 2 && !words[1].startsWith('-')) {
    meaning = '切换目录';
    summary = '把终端的当前工作目录切换到指定目录，后续命令会从那里开始执行。';
    add(0, 'cd：change directory，切换当前目录。');
    add(1, '要进入的目录路径；引号（如果有）用于保留空格。');
  } else if (words[0] === 'uvx' && words.length === 2 && !words[1].startsWith('-')) {
    meaning = '运行 Python 命令行工具';
    summary = '在隔离环境中运行这个工具，相当于 uv tool run。';
    add(0, 'uvx：在隔离环境中运行工具，不把它加入项目依赖。');
    add(1, '需要运行的工具名称。');
  } else return null;
  return [
    {
      anchor: text,
      category: '命令',
      meaning,
      expansion: '',
      evidence: '按命令语法逐项解释；仅解释，不执行。',
      ambiguity: '',
      summary,
      parts,
    },
  ];
}
