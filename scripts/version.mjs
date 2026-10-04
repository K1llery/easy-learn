import { open, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const json = (value) => JSON.stringify(value, null, 2) + '\n';

export function releaseParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('功能版本必须为主版本.次版本.修订号，例如 1.0.0。');
  const parts = version.split('.').map(Number);
  if (parts.some((part) => part > 65535) || parts.every((part) => part === 0))
    throw new Error('功能版本各段须为 0–65535，且不能全为零。');
  return parts;
}

export async function checkVersion(root = process.cwd()) {
  const pkg = await readJson(path.join(root, 'package.json'));
  const manifest = await readJson(path.join(root, 'public/manifest.json'));
  releaseParts(pkg.version);
  if (manifest.version !== pkg.version)
    throw new Error('package.json 与 public/manifest.json 版本不一致，请使用 pnpm version:bump。');
  return pkg.version;
}

export async function bumpVersion(kind, root = process.cwd()) {
  const index = ['major', 'minor', 'patch'].indexOf(kind);
  if (index === -1) throw new Error('请选择 major、minor 或 patch。');
  const parts = releaseParts(await checkVersion(root));
  parts[index]++;
  for (let next = index + 1; next < parts.length; next++) parts[next] = 0;
  const version = parts.join('.');
  releaseParts(version);
  const packagePath = path.join(root, 'package.json');
  const manifestPath = path.join(root, 'public/manifest.json');
  const pkg = await readJson(packagePath);
  const manifest = await readJson(manifestPath);
  pkg.version = manifest.version = version;
  delete manifest.version_name;
  await writeFile(packagePath, json(pkg));
  await writeFile(manifestPath, json(manifest));
  return version;
}

export function validateMetadata(metadata, releaseVersion) {
  releaseParts(releaseVersion);
  if (
    !metadata ||
    metadata.releaseVersion !== releaseVersion ||
    !Number.isSafeInteger(metadata.buildNumber) ||
    metadata.buildNumber < 1 ||
    metadata.version !== `${releaseVersion}.${metadata.buildNumber}` ||
    typeof metadata.builtAt !== 'string' ||
    !Number.isFinite(Date.parse(metadata.builtAt))
  )
    throw new Error('构建版本无效或属于其他功能版本，请重新构建。');
  return metadata;
}

// 同一次 CI 运行的各平台共用构建号；重新运行通过 attempt 区分。
function ciBuildNumber(env) {
  if (env.GITHUB_ACTIONS !== 'true') return null;
  const run = Number(env.GITHUB_RUN_ID),
    attempt = Number(env.GITHUB_RUN_ATTEMPT);
  const number = run * 100 + attempt;
  if (
    !Number.isSafeInteger(run) ||
    run < 1 ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > 99 ||
    !Number.isSafeInteger(number)
  )
    throw new Error('GitHub 构建运行编号或重跑次数无效。');
  return number;
}

async function nextLocalBuild(root) {
  const directory = path.join(root, '.cache/version');
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, 'counter.lock');
  let lock;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      lock = await open(lockPath, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await delay(25);
    }
  }
  if (!lock)
    throw new Error('构建号锁被占用；确认没有构建进程后再移除 .cache/version/counter.lock。');
  const counterPath = path.join(directory, 'counter.json');
  const temporary = path.join(directory, `counter-${process.pid}.tmp`);
  try {
    let previous = 0;
    try {
      previous = (await readJson(counterPath)).buildNumber;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER)
      throw new Error('本地构建号损坏或超出范围，请恢复 .cache/version/counter.json。');
    const buildNumber = previous + 1;
    await writeFile(temporary, json({ buildNumber }));
    await rename(temporary, counterPath);
    return buildNumber;
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockPath);
  }
}

export async function buildMetadata(root = process.cwd(), env = process.env) {
  const releaseVersion = await checkVersion(root);
  if (env.EASY_LEARN_BUILD_METADATA)
    return validateMetadata(JSON.parse(env.EASY_LEARN_BUILD_METADATA), releaseVersion);
  const buildNumber = ciBuildNumber(env) ?? (await nextLocalBuild(root));
  return {
    releaseVersion,
    buildNumber,
    version: `${releaseVersion}.${buildNumber}`,
    builtAt: new Date().toISOString(),
  };
}

export async function writeMetadata(directory, metadata) {
  await writeFile(path.join(directory, 'version.json'), json(metadata));
}

export async function readMetadata(directory, releaseVersion) {
  return validateMetadata(await readJson(path.join(directory, 'version.json')), releaseVersion);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const action = process.argv[2];
    if (action === 'check') console.log(`版本一致：${await checkVersion()}`);
    else if (action === 'bump') console.log(`功能版本：${await bumpVersion(process.argv[3])}`);
    else if (action === 'allocate') console.log(JSON.stringify(await buildMetadata()));
    else if (action === 'ci') {
      if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_OUTPUT)
        throw new Error('ci 命令仅供 GitHub Actions 的构建版本准备 job 使用。');
      const metadata = await buildMetadata();
      if (
        process.env.GITHUB_REF?.startsWith('refs/tags/') &&
        process.env.GITHUB_REF !== `refs/tags/v${metadata.releaseVersion}`
      )
        throw new Error('Git 标签与功能版本不一致，请使用对应的三段版本标签。');
      await writeFile(process.env.GITHUB_OUTPUT, `metadata=${JSON.stringify(metadata)}\n`, {
        flag: 'a',
      });
      console.log(`构建版本：${metadata.version}`);
    } else
      throw new Error(
        '用法：node scripts/version.mjs check | bump major/minor/patch | allocate | ci',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
