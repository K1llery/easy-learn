import { spawnSync } from 'node:child_process';
import { buildMetadata } from './version.mjs';

const [task, target] = process.argv.slice(2);
const scripts = {
  extension: [['scripts/build.mjs']],
  workbench: [['scripts/build-workbench.mjs']],
  'package-extension': [['scripts/build.mjs'], ['scripts/package-extension.mjs']],
  desktop: [['scripts/build-workbench.mjs'], ['scripts/build-desktop.mjs', target]],
};
if (!Object.hasOwn(scripts, task))
  throw new Error('请选择 extension、workbench、package-extension 或 desktop。');
if (task === 'desktop' && !['windows-x64', 'macos-x64', 'macos-arm64'].includes(target))
  throw new Error('请选择 windows-x64、macos-x64 或 macos-arm64。');
const metadata = await buildMetadata();
console.log(`构建版本：${metadata.version}`);
const env = { ...process.env, EASY_LEARN_BUILD_METADATA: JSON.stringify(metadata) };
for (const args of scripts[task]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
