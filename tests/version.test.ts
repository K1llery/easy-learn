// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/version.mjs', import.meta.url));
let root: string;
const readJson = async (file: string) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const writeJson = (file: string, value: unknown) =>
  writeFile(path.join(root, file), JSON.stringify(value));
const run = (args: string[], extraEnv: Record<string, string> = {}) =>
  exec(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, GITHUB_ACTIONS: 'false', EASY_LEARN_BUILD_METADATA: '', ...extraEnv },
  });
const allocate = async (env: Record<string, string> = {}) =>
  JSON.parse((await run(['allocate'], env)).stdout);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'easy-learn-version-'));
  await mkdir(path.join(root, 'public'));
  await writeJson('package.json', {
    name: 'fixture',
    version: '6.1.9',
    scripts: { test: 'fixture' },
  });
  await writeJson('public/manifest.json', { version: '6.1.9', permissions: ['storage'] });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each([
  ['major', '7.0.0'],
  ['minor', '6.2.0'],
  ['patch', '6.1.10'],
])(
  'bumps %s once, resets lower release fields and keeps both source versions aligned',
  async (kind, expected) => {
    await run(['bump', kind]);
    expect(await readJson('package.json')).toEqual({
      name: 'fixture',
      version: expected,
      scripts: { test: 'fixture' },
    });
    expect(await readJson('public/manifest.json')).toEqual({
      version: expected,
      permissions: ['storage'],
    });
    await expect(run(['check'])).resolves.toMatchObject({
      stdout: expect.stringContaining(expected),
    });
  },
);

it('rejects mismatched source versions before allocating a build number', async () => {
  await writeJson('public/manifest.json', { version: '6.1.8' });
  await expect(allocate()).rejects.toMatchObject({ stderr: expect.stringContaining('版本不一致') });
  await expect(readJson('.cache/version/counter.json')).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['unknown', 'constructor', '__proto__'])(
  'rejects invalid bump kind %s without rewriting source files',
  async (kind) => {
    const original = await readFile(path.join(root, 'package.json'), 'utf8');
    await expect(run(['bump', kind])).rejects.toMatchObject({
      stderr: expect.stringContaining('请选择'),
    });
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(original);
  },
);

it.each(['01.0.0', '1.0.0.1', '65536.0.0', '0.0.0'])(
  'rejects an invalid release version %s',
  async (version) => {
    await writeJson('package.json', { version });
    await writeJson('public/manifest.json', { version });
    await expect(run(['check'])).rejects.toMatchObject({ code: 1 });
  },
);

it('keeps local build numbers increasing across concurrent builds and release bumps', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => allocate()));
  expect(results.map((result) => result.buildNumber).sort((a, b) => a - b)).toEqual([
    1, 2, 3, 4, 5, 6,
  ]);
  expect(results.every((result) => result.version === `6.1.9.${result.buildNumber}`)).toBe(true);
  await run(['bump', 'minor']);
  expect(await allocate()).toMatchObject({
    releaseVersion: '6.2.0',
    buildNumber: 7,
    version: '6.2.0.7',
  });
});

it('reuses a parent packaging version without allocating again and rejects stale parent metadata', async () => {
  const metadata = await allocate();
  const inherited = { EASY_LEARN_BUILD_METADATA: JSON.stringify(metadata) };
  expect(await allocate(inherited)).toEqual(metadata);
  expect((await readJson('.cache/version/counter.json')).buildNumber).toBe(1);
  await run(['bump', 'patch']);
  await expect(allocate(inherited)).rejects.toMatchObject({
    stderr: expect.stringContaining('其他功能版本'),
  });
});

it('shares one CI build across platforms and increases it on a rerun', async () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '1' };
  const first = await allocate(env);
  expect(first.buildNumber).toBe(12345601);
  expect((await allocate(env)).version).toBe(first.version);
  expect((await allocate({ ...env, GITHUB_RUN_ATTEMPT: '2' })).buildNumber).toBe(12345602);
  await expect(readJson('.cache/version/counter.json')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('prepares common CI metadata once and validates release tags before exporting it', async () => {
  const output = path.join(root, 'github-output');
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '123456',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_OUTPUT: output,
    GITHUB_REF: 'refs/tags/v6.1.9',
  };
  await run(['ci'], env);
  const exported = await readFile(output, 'utf8');
  const metadata = JSON.parse(exported.trim().slice('metadata='.length));
  expect(metadata.version).toBe('6.1.9.12345601');
  // 只重跑失败的平台时复用成功上游的输出，不能受当前 job 的 attempt 干扰。
  const rerun = await allocate({
    ...env,
    GITHUB_RUN_ATTEMPT: '2',
    EASY_LEARN_BUILD_METADATA: JSON.stringify(metadata),
  });
  expect(rerun).toEqual(metadata);
  await expect(run(['ci'], { ...env, GITHUB_REF: 'refs/tags/v7.0.0' })).rejects.toMatchObject({
    stderr: expect.stringContaining('标签与功能版本不一致'),
  });
  expect(await readFile(output, 'utf8')).toBe(exported);
});

it('fails closed on corrupt counters and overflowing CI identifiers', async () => {
  await mkdir(path.join(root, '.cache/version'), { recursive: true });
  await writeJson('.cache/version/counter.json', { buildNumber: -1 });
  await expect(allocate()).rejects.toMatchObject({ stderr: expect.stringContaining('构建号损坏') });
  expect(await readJson('.cache/version/counter.json')).toEqual({ buildNumber: -1 });
  await expect(
    allocate({
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '9007199254740991',
      GITHUB_RUN_ATTEMPT: '1',
    }),
  ).rejects.toMatchObject({ stderr: expect.stringContaining('运行编号') });
});

it('rejects source version overflow without changing either file', async () => {
  await writeJson('package.json', { version: '65535.1.2' });
  await writeJson('public/manifest.json', { version: '65535.1.2' });
  await expect(run(['bump', 'major'])).rejects.toMatchObject({ code: 1 });
  expect((await readJson('package.json')).version).toBe('65535.1.2');
  expect((await readJson('public/manifest.json')).version).toBe('65535.1.2');
});
