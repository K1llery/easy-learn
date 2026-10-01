// @vitest-environment node
import {it,expect} from 'vitest';
import { AnnotationCache } from '../src/core/annotation-cache';
import type { Config, Candidate, Concept } from '../src/core/types';
const config:Config={baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'not-in-cache',profile:{domain:'软件开发',level:'入门'}};
const candidate:Candidate={id:'c0',anchor:'DR',kind:'abbreviation',heading:'Recovery',context:'Unique secret source paragraph'};
const concept:Concept={id:'c0',anchor:'DR',category:'缩写',meaning:'灾难恢复',summary:'在另一地区恢复服务',expansion:'Disaster Recovery',ambiguity:'',evidence:''};
function setup(){const values:Record<string,unknown>={};const cache=new AnnotationCache({get:async()=>structuredClone(values),set:async data=>{Object.assign(values,structuredClone(data));}});return {cache,values};}
it('reuses across IDs but separates meanings, profiles and providers without storing raw context or credentials',async()=>{
 const {cache,values}=setup();const key=(await cache.key(config,'Doc',candidate))!;
 expect(await cache.key(config,'Doc',{...candidate,id:'c9'})).toBe(key);
 expect(await cache.key(config,'Doc',{...candidate,context:'daily run'})).not.toBe(key);
 expect(await cache.key({...config,model:'other'},'Doc',candidate)).not.toBe(key);
 expect(await cache.key({...config,tuning:{reasoningEffort:'max'}},'Doc',candidate)).not.toBe(key);
 expect(await cache.key({...config,style:'deep'},'Doc',candidate)).not.toBe(key);
 expect(await cache.key({...config,profile:{...config.profile,level:'进阶'}},'Doc',candidate)).not.toBe(key);
 await cache.put([{key,concept}]);expect((await cache.get([key]))[0]).toMatchObject({summary:concept.summary});
 expect(JSON.stringify(values)).not.toContain(candidate.context);expect(JSON.stringify(values)).not.toContain(config.apiKey);
 expect(await cache.key(config,'Doc',{...candidate,kind:'vocabulary'})).not.toBeNull();
 expect(await cache.key(config,'Doc',{...candidate,kind:'code'})).toBeNull();
 expect(await cache.key(config,'Doc',{...candidate,kind:'command'})).toBeNull();
});
it('serializes simultaneous writes, supports clearing and rejects stale in-flight writes',async()=>{
 const {cache}=setup();await Promise.all([cache.put([{key:'a',concept}]),cache.put([{key:'b',concept}])]);
 expect((await cache.get(['a','b'])).every(Boolean)).toBe(true);
 await cache.clear();await cache.put([{key:'c',concept}],()=>false);
 expect(await cache.get(['a','b','c'])).toEqual([undefined,undefined,undefined]);
});
it('expires old entries and bounds cache size',async()=>{
 const {cache,values}=setup();await cache.put(Array.from({length:510},(_,i)=>({key:String(i),concept})));
 expect(await cache.get(['0'])).toEqual([undefined]);expect((values.annotationCacheV1 as any[]).length).toBe(500);
 (values.annotationCacheV1 as any[]).forEach(e=>e.at=Date.now()-31*86400000);
 expect(await cache.get(['509'])).toEqual([undefined]);
});
