import {it,expect} from 'vitest';
import {localExplanation} from '../src/content/glossary';
import {providers,providerFor,providerOptions} from '../src/core/providers';
const profile={domain:'软件开发',level:'入门' as const};
const candidate={anchor:'API',kind:'abbreviation' as const,start:0,heading:'',context:'The API connects applications.'};
it('offers immediate general definitions without pretending to infer context',()=>{
 expect(localExplanation(candidate,profile)).toMatchObject({meaning:'应用程序接口',evidence:expect.stringContaining('通用释义')});
 expect(localExplanation({...candidate,anchor:'virtual environments',kind:'term'},profile)?.summary).toContain('独立');
});
it('never resolves ambiguous initials or overrides an explicit alternative definition',()=>{
 expect(localExplanation({...candidate,anchor:'DR'},profile)).toBeUndefined();
 expect(localExplanation({...candidate,context:'API stands for active pharmaceutical ingredient.'},profile)).toBeUndefined();
 expect(localExplanation(candidate,{...profile,domain:'医学'})).toBeUndefined();
 expect(localExplanation({...candidate,context:'The API connects services. Nearby, DR means disaster recovery.'},profile)).toBeDefined();
});
it('presets keep the local CPA endpoint distinct from official API hosts',()=>{
 expect(providers).toHaveLength(23);expect(providers.filter(p=>p.market!=='local').every(p=>p.baseUrl.startsWith('https:'))).toBe(true);
 expect(providers.filter(p=>p.market==='local')).toHaveLength(4);expect(providers.filter(p=>p.market==='cn')).toHaveLength(6);expect(providers.filter(p=>p.market==='global')).toHaveLength(11);expect(providers.filter(p=>p.market==='oauth')).toHaveLength(2);
 expect(providers.find(p=>p.id==='chatgpt-oauth')).toMatchObject({api:'codex',oauth:'chatgpt',model:'gpt-6-luna'});expect(providers.find(p=>p.id==='claude-oauth')).toMatchObject({api:'claude-oauth',oauth:'claude'});
 expect(providerFor('http://127.0.0.1:8317/v1','gpt-6-luna')?.id).toBe('local-cpa');
 expect(providerOptions('http://127.0.0.1:8317/v1','gpt-6-luna')).toEqual({reasoning_effort:'low'});
 expect(providerOptions('http://127.0.0.1:8317/v1','gpt-6-luna','translate')).toEqual({reasoning_effort:'none'});
 expect(providerFor('https://llm-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','qwen3.8-flash')?.id).toBe('qwen');
 expect(providerOptions('https://api.groq.com/openai/v1','qwen/qwen3.8-27b')).toEqual({reasoning_effort:'none'});
 expect(providerOptions('https://open.bigmodel.cn/api/paas/v4','glm-4.7-flash')).toEqual({thinking:{type:'disabled'}});
 expect(providerOptions('https://other.example/v1','qwen/qwen3.8-27b')).toEqual({});
 expect(providerOptions('https://api.deepseek.com/v1','deepseek-flash')).toEqual({thinking:{type:'disabled'}});
 expect(providerOptions('https://other.example','deepseek-flash')).toEqual({});
 expect(providerOptions('https://llm-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','qwen3.8-flash')).toEqual({enable_thinking:false});
 expect(providerOptions('https://generativelanguage.googleapis.com/v1beta/openai','gemini-3.8-flash')).toEqual({reasoning_effort:'low'});
 expect(providers.find(p=>p.id==='openrouter')?.model).toBe('openrouter/free');
});

it.each(['Pydantic','HTTP','GET','POST','Uvicorn','OpenAPI'])('preloads a general explanation of %s locally',anchor=>{
 expect(localExplanation({...candidate,anchor,kind:'term'},profile)?.summary?.length).toBeGreaterThan(10);
});
