// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Config } from '../src/core/types';
const model = vi.hoisted(() => vi.fn());
vi.mock('../src/core/ai', () => ({ callModel: model }));
function event() {
  const listeners: ((...args: any[]) => any)[] = [];
  return { addListener: (listener: (...args: any[]) => any) => listeners.push(listener), emit: (...args: any[]) => listeners.forEach(listener => listener(...args)), listeners };
}
const cfg: Config = {baseUrl:'https://model.example/v1',model:'test',apiKey:'secret',profile:{domain:'软件开发',level:'入门'}};
const extensionUrl = 'chrome-extension://test-id/';
const pageSender = {id:'test-id',url:'https://article.example/',tab:{id:3},documentId:'article-3'};
const panelSender = {id:'test-id',url:extensionUrl+'panel.html',tab:{id:3},documentId:'panel-3'};
const optionSender = {id:'test-id',url:extensionUrl+'options.html',documentId:'options'};
const context = {title:'Recovery',heading:'DR',text:'DR restores service after a regional failure.',before:'',after:''};
const concept = {anchor:'DR',category:'缩写',meaning:'灾难恢复',expansion:'Disaster Recovery',evidence:'regional failure',ambiguity:''};
let api: any, data: Record<string, any>;
async function send(type: string, fields: any = {}, sender: any = optionSender): Promise<any> {
  return new Promise(resolve => api.runtime.onMessage.listeners[0]({type,...fields},sender,resolve));
}
function port(sender: any, name: string) { return {sender,name,onMessage:event(),onDisconnect:event(),postMessage:vi.fn()}; }
beforeEach(async () => {
  vi.resetModules(); model.mockReset().mockResolvedValue({concepts:[concept]}); data={config:structuredClone(cfg)};
  const storage = {
    setAccessLevel:vi.fn().mockResolvedValue(undefined),
    get:vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])]))),
    set:vi.fn(async (next: any) => {await Promise.resolve();Object.assign(data,structuredClone(next));}),
    clear:vi.fn(async () => {data={};}),
  };
  api={storage:{local:storage,session:{setAccessLevel:vi.fn().mockResolvedValue(undefined)}},permissions:{contains:vi.fn().mockResolvedValue(true)},runtime:{id:'test-id',getURL:(p:string)=>extensionUrl+p,openOptionsPage:vi.fn(),onMessage:event(),onConnect:event()},tabs:{onRemoved:event(),onUpdated:event(),create:vi.fn()},action:{onClicked:event()},scripting:{executeScript:vi.fn()}};
  vi.stubGlobal('chrome',api); await import('../src/background');
});
afterEach(()=>vi.unstubAllGlobals());
it('keeps credentials out of public settings and rejects untrusted privileged messages', async () => {
  const result = await send('PUBLIC_SETTINGS',{},pageSender); expect(result.data).toEqual({profile:cfg.profile,mastered:[],codeAnnotations:false,annotationTypes:['abbreviation','term','command'],localOnly:false});
  expect(JSON.stringify(result)).not.toContain('secret');
  expect((await send('GET_SETTINGS',{},pageSender)).ok).toBe(false);
  expect((await send('GET_SETTINGS',{}, {...optionSender,url:extensionUrl+'panel.html-forged'})).ok).toBe(false);
  expect((await send('GET_SETTINGS',{}, {...optionSender,id:'other-extension'})).ok).toBe(false);
  expect(api.storage.local.setAccessLevel).toHaveBeenCalledWith({accessLevel:'TRUSTED_CONTEXTS'});
});
it('denied host permission never saves configuration or calls the model', async () => {
  api.permissions.contains.mockResolvedValue(false);
  expect((await send('SAVE_SETTINGS',{config:{...cfg,model:'changed'}})).ok).toBe(false);
  expect(data.config.model).toBe('test');
  expect((await send('AI',{request:{operation:'analyze',context}},pageSender)).ok).toBe(false);
  expect((await send('TEST')).ok).toBe(false);
  expect(model).not.toHaveBeenCalled();
});
it('serializes simultaneous mastery updates and retains distinct meanings', async () => {
  const results = await Promise.all([send('MASTER',{concept}),send('MASTER',{concept:{...concept,meaning:'每日运行',expansion:'Daily Run'}})]);
  expect(results.every(r=>r.ok)).toBe(true);expect(data.mastered).toHaveLength(2);
  await send('UNMASTER',{key:data.mastered[0].key});expect(data.mastered.map((x:any)=>x.meaning)).toEqual(['每日运行']);
});
it('caches per document and clears standalone panel data when its port closes', async () => {
  const sender={...panelSender,tab:undefined,documentId:'standalone-1'}; const p=port(sender,'panel');api.runtime.onConnect.emit(p);
  const fields={request:{operation:'explain',context}};
  await send('AI',fields,sender);await send('AI',fields,sender);expect(model).toHaveBeenCalledTimes(1);
  await send('AI',fields,{...sender,documentId:'standalone-2'});expect(model).toHaveBeenCalledTimes(2);
  p.onDisconnect.emit();await send('AI',fields,sender);expect(model).toHaveBeenCalledTimes(3);
});
it('closing a panel does not discard the article analysis cache', async () => {
  const c=port(pageSender,'content'),p=port(panelSender,'panel');api.runtime.onConnect.emit(c);api.runtime.onConnect.emit(p);
  const analysis={request:{operation:'analyze',context}};
  await send('AI',analysis,pageSender);await send('AI',{request:{operation:'quiz',context}},panelSender);
  p.onDisconnect.emit();await send('AI',analysis,pageSender);expect(model).toHaveBeenCalledTimes(2);
  api.tabs.onRemoved.emit(3);await send('AI',analysis,pageSender);expect(model).toHaveBeenCalledTimes(3);
});
it('cancels requests on tab closure and rejects results returned after cancellation', async () => {
  let resolve: (value:unknown)=>void = ()=>{};
  model.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const pending=send('AI',{request:{operation:'analyze',context}},pageSender);
  await vi.waitFor(()=>expect(model).toHaveBeenCalledTimes(1));
  const signal=model.mock.calls[0][2] as AbortSignal;
  api.tabs.onRemoved.emit(3);expect(signal.aborted).toBe(true);resolve({concepts:[concept]});
  expect(await pending).toMatchObject({ok:false,error:'请求已取消。'});
});
it('routes contexts only to the panel in the same tab', () => {
  const c=port(pageSender,'content'),p=port(panelSender,'panel'),other=port({...panelSender,documentId:'panel-4',tab:{id:4}},'panel');
  api.runtime.onConnect.emit(c);api.runtime.onConnect.emit(p);api.runtime.onConnect.emit(other);
  expect(c.postMessage).toHaveBeenCalledWith({type:'PANEL_READY'});
  c.onMessage.emit({type:'CONTEXT',payload:{context}});
  expect(p.postMessage).toHaveBeenCalledWith({type:'CONTEXT',payload:{context}});expect(other.postMessage).not.toHaveBeenCalled();
});

it('does not cancel live requests on same-document loading/status changes', async () => {
  let resolve: (value:unknown)=>void = ()=>{};
  model.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const pending=send('AI',{request:{operation:'analyze',context}},pageSender);
  await vi.waitFor(()=>expect(model).toHaveBeenCalledTimes(1));
  const signal=model.mock.calls[0][2] as AbortSignal;
  api.tabs.onUpdated.emit(3,{status:'loading',url:'https://article.example/#install'});
  expect(signal.aborted).toBe(false);resolve({concepts:[concept]});expect((await pending).ok).toBe(true);
});

it('persists the selected annotation types and leaves command/code preferences independent',async()=>{
 const popup={id:'test-id',url:extensionUrl+'popup.html',documentId:'popup'};
 expect((await send('GET_SETTINGS',{},popup)).ok).toBe(true);
 expect((await send('SET_ANNOTATION_TYPES',{types:['abbreviation','command','vocabulary']},popup)).ok).toBe(true);
 expect((await send('PUBLIC_SETTINGS',{},pageSender)).data.annotationTypes).toEqual(['abbreviation','command','vocabulary']);
 await send('SET_CODE_ANNOTATIONS',{enabled:true},pageSender);
 expect(data.reading).toEqual({annotationTypes:['abbreviation','command','vocabulary'],codeAnnotations:true});
 expect((await send('SET_ANNOTATION_TYPES',{types:['not-a-type']},popup)).ok).toBe(false);
 expect((await send('GET_SETTINGS',{}, {...popup,url:extensionUrl+'popup.html-forged'})).ok).toBe(false);
 expect((await send('PUBLIC_SETTINGS',{},pageSender)).data.annotationTypes).toEqual(['abbreviation','command','vocabulary']);
});

it('persists a safe code switch without exposing credentials or clearing the model cache',async()=>{
 expect((await send('SET_CODE_ANNOTATIONS',{enabled:true},pageSender)).ok).toBe(true);
 expect((await send('PUBLIC_SETTINGS',{},pageSender)).data.codeAnnotations).toBe(true);
 expect(data.config.apiKey).toBe(cfg.apiKey);
 expect((await send('SET_CODE_ANNOTATIONS',{enabled:'yes'},pageSender)).ok).toBe(false);
 expect((await send('MASTER',{concept},pageSender)).ok).toBe(true);
 expect((await send('PUBLIC_SETTINGS',{},pageSender)).data.mastered).toHaveLength(1);
});

it('offline mode blocks model requests while preserving other reading preferences',async()=>{
 await send('SET_LOCAL_ONLY',{enabled:true},pageSender);await send('SET_CODE_ANNOTATIONS',{enabled:true},pageSender);
 expect(data.reading).toEqual({localOnly:true,codeAnnotations:true});
 expect((await send('AI',{request:{operation:'analyze',context}},pageSender)).ok).toBe(false);
 expect((await send('TEST')).ok).toBe(false);expect(model).not.toHaveBeenCalled();
});

it('routes incremental results only to the requesting document and ignores obsolete progress',async()=>{
 const c=port(pageSender,'content'),p=port(panelSender,'panel');api.runtime.onConnect.emit(c);api.runtime.onConnect.emit(p);
 let resolve!:(v:any)=>void;
 model.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const pending=send('AI',{requestId:'batch-1',request:{operation:'analyze',context}},pageSender);
 await vi.waitFor(()=>expect(model).toHaveBeenCalledTimes(1));
 const progress=model.mock.calls[0][3];progress({concepts:[concept],skipped:[]});
 expect(c.postMessage).toHaveBeenCalledWith({type:'AI_PROGRESS',requestId:'batch-1',concepts:[concept],skipped:[]});
 expect(p.postMessage).not.toHaveBeenCalled();
 c.onDisconnect.emit();c.postMessage.mockClear();progress({concepts:[concept],skipped:[]});expect(c.postMessage).not.toHaveBeenCalled();
 resolve({concepts:[concept]});expect((await pending).ok).toBe(false);
});

it('reuses persistent terms after a document reload, remaps IDs, and clears them on opt out',async()=>{
 const candidates=[{id:'c0',anchor:'DR',kind:'abbreviation',heading:'Recovery',context:'Recover from a regional failure.'}];
 model.mockResolvedValue({concepts:[{...concept,id:'c0',summary:'恢复服务'}],missing:[]});
 await send('AI',{request:{operation:'analyze',context,candidates}},pageSender);
 const reload={...pageSender,documentId:'reloaded'};
 const result=await send('AI',{request:{operation:'analyze',context,candidates:[{...candidates[0],id:'c8'}]}},reload);
 expect(result).toMatchObject({ok:true,data:{__cached:true,concepts:[{id:'c8',summary:'恢复服务'}]}});expect(model).toHaveBeenCalledTimes(1);
 expect((await send('CLEAR_ANNOTATION_CACHE',{},pageSender)).ok).toBe(false);
 await send('SET_REMEMBER_ANNOTATIONS',{enabled:false});
 await send('AI',{request:{operation:'analyze',context,candidates}},{...reload,documentId:'after-clear'});expect(model).toHaveBeenCalledTimes(2);
 expect(data.annotationCacheV1).toEqual([]);
});
