import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const target = process.argv[2],
  folder = path.resolve('artifacts', `Easy-Learn-${version}-${target}`);
const executable =
  process.env.EASY_LEARN_SMOKE_EXECUTABLE ??
  (process.platform === 'win32'
    ? path.join(folder, 'Easy Learn.exe')
    : path.join(folder, 'Easy Learn.app/Contents/MacOS/Easy Learn'));
const dir = await mkdtemp(path.join(tmpdir(), 'easy-learn-smoke-'));
const children = [];
let url, state;
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
}
async function waitForBackendExit() {
  const deadline = Date.now() + 5000;
  while (alive(state.pid)) {
    if (Date.now() > deadline) throw new Error('Packaged Node backend did not exit');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function waitForLauncherExit(child) {
  if (child.exitCode !== null) {
    assert.equal(child.exitCode, 0);
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Launcher stayed alive after readiness')),
      5000,
    );
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Launcher exited ${code}`));
    });
  });
}
async function start() {
  const child = spawn(executable, [], {
    cwd: dir,
    env: { ...process.env, PATH: '', EASY_LEARN_DATA_DIR: dir, EASY_LEARN_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let buffer = '';
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native launcher readiness timeout')), 25000);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      if (!buffer.includes('\n')) {
        clearTimeout(timer);
        reject(new Error(`Native launcher exited ${code}`));
      }
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        clearTimeout(timer);
        resolve(buffer.split('\n')[0].trim());
      }
    });
  });
  return { child, url: address };
}
try {
  const first = await start();
  url = first.url;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  state = JSON.parse(await readFile(path.join(dir, 'desktop-instance.json'), 'utf8'));
  assert.ok(Number.isInteger(state.pid) && state.pid > 0 && state.pid !== process.pid);
  await waitForLauncherExit(first.child);
  assert.ok(alive(state.pid), 'Backend must survive launcher exit');
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /assets\/reader/);
  const post = (body, origin) =>
    fetch(url + 'api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    });
  const settings = await (await post({ type: 'GET_SETTINGS' })).json();
  assert.equal(settings.data.desktop, true);
  assert.equal(settings.data.config, undefined);
  const second = await start();
  assert.equal(second.url, url);
  await waitForLauncherExit(second.child);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, 'desktop-instance.json'), 'utf8')).pid,
    state.pid,
  );
  assert.equal((await post({ type: 'QUIT_DESKTOP' }, 'https://foreign.test')).status, 403);
  assert.equal((await post({ type: 'QUIT_DESKTOP' }, new URL(url).origin)).status, 200);
  await waitForBackendExit();
  console.log(
    'Native launcher, packaged backend/assets, duplicate launch and shutdown passed with empty PATH and isolated data.',
  );
} finally {
  if (url)
    await fetch(url + 'api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin },
      body: JSON.stringify({ type: 'QUIT_DESKTOP' }),
    }).catch(() => undefined);
  if (state) await waitForBackendExit();
  for (const child of children) if (child.exitCode === null) child.kill();
  await rm(dir, { recursive: true, force: true });
}
