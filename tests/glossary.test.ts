import {it,expect} from 'vitest';
import {localExplanation} from '../src/content/glossary';
import {providers,providerOptions} from '../src/core/providers';
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
});
it('presets use official hosts and only the exact Groq model receives a reasoning override',()=>{
 expect(providers).toHaveLength(4);expect(providers.every(p=>p.baseUrl.startsWith('https:'))).toBe(true);
 expect(providerOptions('https://api.groq.com/openai/v1','qwen/qwen3.8-27b')).toEqual({reasoning_effort:'none'});
 expect(providerOptions('https://open.bigmodel.cn/api/paas/v4','glm-4.7-flash')).toEqual({thinking:{type:'disabled'}});
 expect(providerOptions('https://other.example/v1','qwen/qwen3.8-27b')).toEqual({});
 expect(providers.find(p=>p.id==='openrouter')?.model).toBe('openrouter/free');
});

it.each(['Pydantic','HTTP','GET','POST','Uvicorn','OpenAPI'])('preloads a general explanation of %s locally',anchor=>{
 expect(localExplanation({...candidate,anchor,kind:'term'},profile)?.summary.length).toBeGreaterThan(10);
});
