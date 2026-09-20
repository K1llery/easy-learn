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
  private waiting: (() => void)[] = [];
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await fn(); } finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
