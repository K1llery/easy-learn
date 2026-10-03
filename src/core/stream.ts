/** Decode SSE across arbitrary UTF-8/network boundaries. Never expose provider diagnostics. */
export async function readEvents(response: Response, accept: (event: any) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('服务未返回可读取的响应。');
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  function dispatch(frame: string) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let event: any;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error('流式响应格式异常，已保留完成的注释。');
    }
    if (event.error) throw new Error('模型流式响应中断，已保留完成的注释。');
    accept(event);
  }
  try {
    while (!done) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done }).replace(/\r/g, '');
      if (buffer.length > 262144) throw new Error('流式响应过大。');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        dispatch(frame);
        if (done) break;
      }
      if (chunk.done) {
        if (buffer.trim()) dispatch(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Emit complete JSON objects, including entries inside an unfinished items array. */
export class ObjectStream {
  private text = '';
  private starts: number[] = [];
  private quoted = false;
  private escape = false;
  push(part: string): unknown[] {
    const values: unknown[] = [];
    for (const ch of part) {
      const at = this.text.length;
      this.text += ch;
      if (this.quoted) {
        if (this.escape) this.escape = false;
        else if (ch === '\\') this.escape = true;
        else if (ch === '"') this.quoted = false;
        continue;
      }
      if (ch === '"') {
        this.quoted = true;
        continue;
      }
      if (ch === '{') this.starts.push(at);
      if (ch === '}') {
        const start = this.starts.pop();
        if (start !== undefined) {
          try {
            values.push(JSON.parse(this.text.slice(start)));
          } catch {
            /* Only complete valid objects. */
          }
        }
      }
    }
    if (this.text.length > 60000) throw new Error('模型返回过大的响应。');
    return values;
  }
}
