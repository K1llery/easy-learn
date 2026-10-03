import type { AIRequest } from '../core/types';
import type { AnalysisProgress } from '../core/ai';
import { rpc } from './rpc';
type ReadingResult = AnalysisProgress & { missing?: string[]; __warning?: string };
export const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
export async function analyzeReading(
  request: AIRequest,
  signal: AbortSignal,
  onProgress: (p: AnalysisProgress) => void,
  port?: chrome.runtime.Port,
) {
  if (inExtension) {
    const requestId = crypto.randomUUID();
    const listener = (msg: AnalysisProgress & { type?: string; requestId?: string }) => {
      if (msg.type === 'AI_PROGRESS' && msg.requestId === requestId && !signal.aborted)
        onProgress(msg);
    };
    port?.onMessage.addListener(listener);
    try {
      const result = await rpc<ReadingResult>('AI', { request, requestId });
      if (signal.aborted) throw new Error('请求已取消。');
      return result;
    } finally {
      port?.onMessage.removeListener(listener);
    }
  }
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error('无法连接阅读服务，请检查本机工作台。');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    result: ReadingResult | undefined;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (event.progress) onProgress(event.progress);
        if (event.result) result = event.result;
      }
      if (chunk.done) break;
    }
    if (!result) throw new Error('响应中断；已完成的释义仍可阅读，可手动重试。');
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
