import type { Result } from '../core/types';
export async function rpc<T = any>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
  let response: Result<T>;
  try {
    response =
      typeof chrome !== 'undefined' && chrome.runtime?.id
        ? await chrome.runtime.sendMessage({ type, ...fields })
        : await (
            await fetch('/api/rpc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type, ...fields }),
            })
          ).json();
  } catch {
    throw new Error('扩展连接已中断，请刷新页面后重新开启伴读。');
  }
  if (!response?.ok) throw new Error(response?.error ?? '扩展没有响应，请重试。');
  return response.data;
}
