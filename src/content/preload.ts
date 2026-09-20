import type { Concept } from '../core/types';
export type Entry = { signature: string; state: 'ready' | 'failed'; concepts: Concept[]; error?: string };
/** Failed blocks stay failed until an explicit retry or their context changes.
 * Scrolling never re-requests identical failed or ready content.
 */
export class Preloads {
  private entries = new Map<string, Entry>();
  get(key:string, signature:string) { const entry=this.entries.get(key);return entry?.signature===signature ? entry : undefined; }
  ready(key:string, signature:string, concepts:Concept[]) { this.entries.set(key,{signature,state:'ready',concepts:concepts.filter(c=>!!c.summary?.trim())}); }
  fail(key:string, signature:string, error:string) { this.entries.set(key,{signature,state:'failed',concepts:[],error}); }
  retry() { for(const [key,entry] of this.entries) if(entry.state==='failed') this.entries.delete(key); }
  prune(keys:Set<string>) { for(const key of this.entries.keys()) if(!keys.has(key))this.entries.delete(key); }
  clear() { this.entries.clear(); }
  errors() { return [...new Set([...this.entries.values()].filter(e=>e.state==='failed').map(e=>e.error!))]; }
}
