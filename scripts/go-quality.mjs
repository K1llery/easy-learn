import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const launcher = fileURLToPath(new URL('../desktop/launcher/', import.meta.url));
const mode = process.argv[2];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) {
    console.error(`无法运行 ${command}，请安装 Go 并将其加入 PATH。`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

if (mode === 'lint') {
  // 在同一主机上检查所有发行目标，包括仅在 Windows 编译的源文件。
  for (const [GOOS, GOARCH] of [
    ['windows', 'amd64'],
    ['darwin', 'amd64'],
    ['darwin', 'arm64'],
    ['linux', 'amd64'],
  ]) {
    run('go', ['vet', './...'], { cwd: launcher, env: { ...process.env, GOOS, GOARCH } });
    console.log(`go vet: ${GOOS}/${GOARCH} 通过`);
  }
} else if (mode === 'format' || mode === 'check') {
  const files = readdirSync(launcher)
    .filter((name) => name.endsWith('.go'))
    .map((name) => `desktop/launcher/${name}`);
  const output = run('gofmt', [mode === 'format' ? '-w' : '-l', ...files]);
  if (output.trim()) {
    console.error(`Go 文件需要格式化，请运行 pnpm format:go：\n${output}`);
    process.exit(1);
  }
} else {
  console.error('用法：node scripts/go-quality.mjs <lint|format|check>');
  process.exit(1);
}
