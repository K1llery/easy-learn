import { build } from 'vite';
import { readFile, writeFile, mkdir, cp, rm, chmod, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { zipSync, unzipSync } from 'fflate';

const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
const runtimes = JSON.parse(await readFile('scripts/desktop-runtimes.json', 'utf8'));
const target = process.argv[2];
const spec = runtimes.targets[target];
if (!spec) throw new Error('请选择 windows-x64、macos-x64 或 macos-arm64。');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败。`);
}
await stat('dist-workbench/reader.html');
const cache = path.resolve('.cache/desktop-runtimes');
await mkdir(cache, { recursive: true });
const archive = path.join(cache, spec.archive);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
let bytes;
try {
  bytes = await readFile(archive);
  if (digest(bytes) !== spec.sha256) throw new Error('缓存校验不匹配');
} catch {
  console.log(`下载官方 Node.js ${runtimes.version} (${target})…`);
  // curl reuses existing proxy variables without logging them. No downloads occur on user launch.
  const partial = archive + '.partial';
  run('curl', [
    '--fail',
    '--location',
    '--retry',
    '2',
    '--connect-timeout',
    '15',
    '--max-time',
    '300',
    '--output',
    partial,
    `https://nodejs.org/dist/v${runtimes.version}/${spec.archive}`,
  ]);
  bytes = await readFile(partial);
  if (digest(bytes) !== spec.sha256) throw new Error('官方运行时 SHA-256 校验失败。');
  await writeFile(archive, bytes);
  await rm(partial);
}
const folder = path.resolve('artifacts', `Easy-Learn-${packageInfo.version}-${target}`);
await rm(folder, { recursive: true, force: true });
await mkdir(folder, { recursive: true });
const mac = spec.goos === 'darwin';
const app = path.join(folder, 'Easy Learn.app');
const resources = mac ? path.join(app, 'Contents/Resources') : path.join(folder, 'resources');
await mkdir(path.join(resources, 'runtime'), { recursive: true });
if (mac) {
  const unpack = path.join(cache, target);
  await rm(unpack, { recursive: true, force: true });
  await mkdir(unpack, { recursive: true });
  run('tar', ['-xzf', archive, '-C', unpack]);
  const runtimeRoot = path.join(unpack, spec.archive.replace(/\.tar\.gz$/, ''));
  await cp(path.join(runtimeRoot, 'bin/node'), path.join(resources, 'runtime/node'));
  await chmod(path.join(resources, 'runtime/node'), 0o755);
  await cp(path.join(runtimeRoot, 'LICENSE'), path.join(resources, 'runtime/LICENSE'));
} else {
  const files = unzipSync(bytes),
    prefix = spec.archive.replace(/\.zip$/, '') + '/';
  for (const name of ['node.exe', 'LICENSE']) {
    if (!files[prefix + name]) throw new Error('运行时包缺少必要文件。');
    await writeFile(path.join(resources, 'runtime', name), files[prefix + name]);
  }
}
await cp('dist-workbench', path.join(resources, 'dist-workbench'), { recursive: true });
await build({
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: 'src/workbench/desktop.ts',
    outDir: path.join(resources, 'backend-build'),
    rollupOptions: { output: { entryFileNames: 'desktop.mjs', inlineDynamicImports: true } },
  },
});
await cp(path.join(resources, 'backend-build/desktop.mjs'), path.join(resources, 'desktop.mjs'));
await rm(path.join(resources, 'backend-build'), { recursive: true });
await writeFile(
  path.join(resources, 'desktop-version.json'),
  JSON.stringify({ version: packageInfo.version }),
);
const executable = mac
  ? path.join(app, 'Contents/MacOS/Easy Learn')
  : path.join(folder, 'Easy Learn.exe');
await mkdir(path.dirname(executable), { recursive: true });
run(
  'go',
  [
    'build',
    '-p',
    '4',
    '-trimpath',
    '-ldflags',
    mac ? '-s -w' : '-s -w -H windowsgui',
    '-o',
    executable,
    '.',
  ],
  {
    cwd: path.resolve('desktop/launcher'),
    env: {
      ...process.env,
      GOOS: spec.goos,
      GOARCH: spec.goarch,
      CGO_ENABLED: '0',
      GOMAXPROCS: '4',
      GOTOOLCHAIN: 'local',
    },
  },
);
if (mac) {
  await writeFile(
    path.join(app, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Easy Learn</string><key>CFBundleIdentifier</key><string>app.easylearn.reader</string><key>CFBundleName</key><string>Easy Learn</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${packageInfo.version}</string><key>CFBundleVersion</key><string>${packageInfo.version}</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>13.5</string></dict></plist>`,
  );
}
await cp('public/vocabulary/ATTRIBUTION.md', path.join(folder, 'VOCABULARY-LICENSE.md'));
await cp('node_modules/pdfjs-dist/LICENSE', path.join(resources, 'dist-workbench/pdfjs/LICENSE'));
await cp('docs/desktop-start.md', path.join(folder, '使用说明.md'));
await writeFile(
  path.join(folder, 'THIRD-PARTY-NOTICES.txt'),
  'Node.js: bundled runtime LICENSE in resources/runtime (or app Contents/Resources/runtime).\nGo runtime: BSD-3-Clause, https://go.dev/LICENSE\nPDF.js: Apache-2.0, bundled LICENSE in dist-workbench/pdfjs.\nReact: MIT; DOMPurify: Apache-2.0 or MPL-2.0; EPUB.js: BSD-2-Clause; fflate: MIT; marked: MIT; Zod: MIT. See LICENSES directory for their exact installed notices.\nVocabulary data: CC BY-SA 4.0, see VOCABULARY-LICENSE.md.\n',
);
await mkdir(path.join(folder, 'LICENSES'));
for (const module of [
  'react',
  'react-dom',
  'dompurify',
  'epubjs',
  'fflate',
  'marked',
  'zod',
  'pdfjs-dist',
]) {
  const entries = await readdir(path.join('node_modules', module));
  const license = entries.find((n) => /^license(?:\.|$)/i.test(n));
  if (!license) throw new Error(`缺少许可证：${module}`);
  await cp(
    path.join('node_modules', module, license),
    path.join(folder, 'LICENSES', module + '.txt'),
  );
}
await cp('desktop/launcher/LICENSE.go-runtime', path.join(folder, 'LICENSES/go.txt'));
// Sign only after every file inside the app is final; later resource writes invalidate the seal.
if (mac && process.platform === 'darwin') {
  run('codesign', ['--force', '--sign', '-', path.join(resources, 'runtime/node')]);
  run('codesign', ['--force', '--sign', '-', app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);
}
const zip = {};
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await collect(file);
    else {
      const relative = path.relative(path.dirname(folder), file).split(path.sep).join('/');
      zip[relative] = [
        await readFile(file),
        { os: 3, attrs: ((await stat(file)).mode & 0xffff) << 16 },
      ];
    }
  }
}
await collect(folder);
const output = folder + '.zip';
await writeFile(output, zipSync(zip, { level: 6 }));
await writeFile(
  output + '.sha256',
  digest(await readFile(output)) + '  ' + path.basename(output) + '\n',
);
console.log(`桌面包：${output}`);
