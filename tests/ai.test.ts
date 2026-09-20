// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { callModel } from '../src/core/ai';
import { parseModelOutput } from '../src/core/model-output';
import type { AIRequest, Config } from '../src/core/types';
const config:Config={baseUrl:'https://example.test/v1',model:'test',apiKey:'never-log-me',profile:{domain:'软件开发',level:'入门'}};
const request:AIRequest={operation:'analyze',context:{title:'Doc',heading:'',text:'unused long paragraph',before:'unused',after:''},candidates:[{id:'c0',anchor:'DR',kind:'abbreviation',heading:'Recovery',context:'DR restores service after a regional failure.'},{id:'c1',anchor:'API',kind:'abbreviation',heading:'Interfaces',context:'API connects services.'}]};
const response=(content:unknown,other:object={})=>new Response(JSON.stringify({choices:[{message:{content}}],...other}),{status:200});
it('sends only compact local candidates and consumes one provider response',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(response('{"items":[{"id":"c0","summary":"灾难后的恢复流程"},{"id":"c1","summary":"程序间接口"}]}',{usage:{total_tokens:123}}));
 const result=await callModel(config,request);expect(result).toMatchObject({__usage:123,concepts:[{anchor:'DR'},{anchor:'API'}]});
 const input=JSON.parse(JSON.parse(fetcher.mock.calls[0][1]!.body as string).messages[1].content);
 expect(input.context).toBeUndefined();expect(input.candidates).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('never makes a paid automatic repair request on unusable output',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response('无法对应两个候选的自由文本'));
 await expect(callModel(config,request)).rejects.toThrow('未自动重试');expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([[401,'认证'],[403,'授权'],[429,'限流'],[404,'接口不存在'],[500,'HTTP 500']])('maps HTTP %s without revealing provider diagnostics',async(status,word)=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('never-log-me',{status:Number(status)}));await expect(callModel(config,request)).rejects.toThrow(String(word));
});
it('accepts compatible text-array content and plain-text detailed explanations',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response([{type:'text',text:'这是一个自然语言解释。'}]));
 expect(await callModel(config,{operation:'explain',context:request.context})).toMatchObject({explanation:'这是一个自然语言解释。'});
});
it('distinguishes timeout during response reading',async()=>{
 const res=response('{}');vi.spyOn(res,'json').mockRejectedValue(new DOMException('timeout','TimeoutError'));const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(res);
 await expect(callModel(config,request)).rejects.toThrow('超时');expect(fetcher).toHaveBeenCalledTimes(1);
});
describe('local output normalization',()=>{
 it.each([
  'Here are the results:\n```json\n{"items":[{"id":"c0","explanation":"恢复流程"},{"id":"c1","skip":true}]}\n```',
  '[{"id":"c0","summary":"恢复流程"},{"id":"c1","relevant":false}]',
  '{"c0":"恢复流程","c1":{"skip":true}}',
 ])('accepts envelopes, optional fields and explicit filtering',raw=>{
  expect(parseModelOutput('analyze',raw,request)).toMatchObject({concepts:[{id:'c0',anchor:'DR',summary:'恢复流程'}],skipped:['c1'],missing:[]});
 });
 it('keeps valid partial results when another entry is malformed',()=>{
  expect(parseModelOutput('analyze','{"items":[{"id":"c0","summary":"恢复流程"},{"id":"c1","summary":null}]}',request)).toMatchObject({concepts:[{anchor:'DR'}],missing:['c1']});
 });
 it('salvages complete objects from a truncated response without guessing the tail',()=>{
  expect(parseModelOutput('analyze','{"items":[{"id":"c0","summary":"恢复流程"},{"id":"c1","summary":"truncated',request)).toMatchObject({concepts:[{anchor:'DR'}],missing:['c1']});
 });
 it('never associates invented IDs or unrelated terms with page content',()=>{
  expect(()=>parseModelOutput('analyze','{"items":[{"id":"c99","summary":"unrelated"}]}',request)).toThrow();
 });
 it('reads numbered plain text and does not require unrelated empty fields',()=>{
  expect(parseModelOutput('analyze','c0: 恢复流程\nc1: 程序接口',request)).toMatchObject({concepts:[{anchor:'DR'},{anchor:'API'}],missing:[]});
 });
});
