// Memory only: no article or conversation is written to storage.
export class SessionCache<T> {
  private values = new Map<string, T>();
  constructor(private limit = 150) {}
  get(key: string) { return this.values.get(key); }
  set(key: string, value: T) {
    this.values.delete(key); this.values.set(key, value);
    if (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!);
  }
  clear() { this.values.clear(); }
}
export function cacheKey(request: unknown, profile: unknown, model: string, baseUrl: string) { return JSON.stringify([request, profile, model, baseUrl]); }
export class Queue {
  private active = 0;
  private limit = 2;
  private waiting: {resolve:()=>void;priority:number}[] = [];
  setLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 6) throw new Error('并发数必须在 1 到 6 之间。');
    this.limit = limit; this.drain();
  }
  private drain() {
    while (this.active < this.limit && this.waiting.length) { this.active++; this.waiting.shift()!.resolve(); }
  }
  async run<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    if (this.active < this.limit) this.active++;
    else await new Promise<void>(resolve => { this.waiting.push({resolve, priority}); this.waiting.sort((a,b)=>b.priority-a.priority); });
    try { return await fn(); } finally { this.active--; this.drain(); }
  }
}
