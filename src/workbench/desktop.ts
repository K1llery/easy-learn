import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorkbench } from './server';

type State = { port: number; token: string };
export async function startDesktop(
  root: string,
  dataDir: string,
  version: string,
  preferredPort = 42780,
) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(dataDir, 'desktop-instance.json');
  async function readState(): Promise<State | undefined> {
    try {
      const s = JSON.parse(await readFile(stateFile, 'utf8'));
      if (
        Number.isInteger(s.port) &&
        s.port > 0 &&
        s.port <= 65535 &&
        /^[a-f0-9]{64}$/.test(s.token)
      )
        return s;
    } catch {
      /* stale launch metadata is replaceable; settings are not */
    }
  }
  async function reuse() {
    const s = await readState();
    if (!s) return;
    try {
      const r = await fetch(`http://127.0.0.1:${s.port}/desktop/status`, {
        headers: { 'x-easy-learn-instance': s.token },
        signal: AbortSignal.timeout(500),
      });
      if (!r.ok) return;
      const info = await r.json();
      if (info.app !== 'easy-learn') return;
      if (info.version !== version)
        throw new Error('另一个版本的 Easy Learn 正在运行，请先在旧版本中点击“退出软件”。');
      return `http://127.0.0.1:${s.port}/`;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('另一个版本')) throw e;
    }
  }
  const existing = await reuse();
  if (existing) return { url: existing, reused: true };
  const initial = (await readState())?.port ?? preferredPort;
  const token = randomBytes(32).toString('hex');
  const server = createWorkbench(root, dataDir, {
    version,
    token,
    onQuit: () => {
      server.close();
      server.closeAllConnections();
    },
  });
  for (let attempt = 0; attempt < 12; attempt++) {
    const port = initial + attempt;
    if (port > 65535) break;
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (e: Error) => {
            server.off('listening', opened);
            reject(e);
          },
          opened = () => {
            server.off('error', failed);
            resolve();
          };
        server.once('error', failed);
        server.once('listening', opened);
        server.listen(port, '127.0.0.1');
      });
      const temporary = stateFile + `.${process.pid}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ port, token, pid: process.pid }), {
          mode: 0o600,
        });
        await rename(temporary, stateFile);
      } catch (e) {
        server.close();
        throw e;
      }
      return { url: `http://127.0.0.1:${port}/`, reused: false, server };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      // A simultaneous launcher may have bound the port just before writing its identity.
      for (let wait = 0; wait < 10; wait++) {
        const url = await reuse();
        if (url) return { url, reused: true };
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
  throw new Error('本机阅读端口暂时不可用，请稍后重试。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = process.env.EASY_LEARN_DATA_DIR;
  if (!dataDir) {
    console.error('启动器未提供数据目录。');
    process.exitCode = 1;
  } else {
    const version = JSON.parse(
      await readFile(path.join(root, 'desktop-version.json'), 'utf8'),
    ).version;
    try {
      const result = await startDesktop(root, dataDir, version);
      console.log(JSON.stringify({ url: result.url, reused: result.reused }));
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => {
          result.server?.close();
          result.server?.closeAllConnections();
        });
    } catch (e) {
      console.error(e instanceof Error ? e.message : 'Easy Learn 启动失败。');
      process.exitCode = 1;
    }
  }
}
