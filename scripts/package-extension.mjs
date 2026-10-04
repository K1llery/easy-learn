import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { buildMetadata, readMetadata } from './version.mjs';
const metadata = await buildMetadata();
const built = await readMetadata('dist', metadata.releaseVersion);
if (process.env.EASY_LEARN_BUILD_METADATA && built.version !== metadata.version)
  throw new Error('扩展构建号与打包任务不同，请使用 pnpm package:extension。');
const files = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else files[path.relative('dist', file).split(path.sep).join('/')] = await readFile(file);
  }
}
await walk('dist');
if (!files['manifest.json']) throw new Error('请先构建浏览器扩展。');
const manifest = JSON.parse(files['manifest.json'].toString());
if (manifest.version !== metadata.releaseVersion) throw new Error('扩展产物版本过期，请重新构建。');
manifest.version_name = metadata.version;
files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
files['version.json'] = Buffer.from(JSON.stringify(metadata, null, 2) + '\n');
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
  const names = await readdir(path.join('node_modules', module));
  const license = names.find((n) => /^license(?:\.|$)/i.test(n));
  if (!license) throw new Error(`缺少许可证：${module}`);
  files['LICENSES/' + module + '.txt'] = await readFile(path.join('node_modules', module, license));
}
files['THIRD-PARTY-NOTICES.txt'] = Buffer.from(
  'Third-party notices in LICENSES/. Vocabulary data CC BY-SA 4.0: vocabulary/ATTRIBUTION.md. All code is bundled locally; no remote extension code is loaded.\n',
);
await mkdir('artifacts', { recursive: true });
const output = `artifacts/Easy-Learn-${metadata.version}-extension.zip`;
const bytes = zipSync(files, { level: 6 });
await writeFile(output, bytes);
await writeFile(
  output + '.sha256',
  createHash('sha256').update(bytes).digest('hex') + '  ' + path.basename(output) + '\n',
);
console.log(output);
