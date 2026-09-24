import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { extractBlocks, contextFor, locateText, matchesSnapshot } from '../src/content/document';
import { explainCommand } from '../src/content/commands';
import { Preloads } from '../src/content/preload';
import { analyzeSchema } from '../src/core/types';
it('extracts the supplied FastAPI terminal commands once without hidden copies or terminal output', () => {
  const html=readFileSync('example/Tutorial - User Guide - FastAPI.html','utf8');
  const parsed=new DOMParser().parseFromString(html,'text/html');
  document.body.replaceChildren(document.importNode(parsed.querySelector('article')!,true));
  const original=document.body.innerHTML, blocks=extractBlocks();
  const commands=blocks.filter(b=>b.kind==='command');
  expect(commands.map(b=>b.text)).toEqual(['uv run fastapi dev','uv init awesome-project --bare','cd awesome-project','uv add "fastapi[standard]"','uvx library-skills']);
  expect(blocks.some(b=>b.text.includes('383153'))).toBe(false);
  expect(blocks.some(b=>b.text.includes('████'))).toBe(false);
  for(const b of commands){const concepts=explainCommand(b.text)!;expect(concepts).not.toBeNull();expect(matchesSnapshot(b)).toBe(true);for(const part of concepts[0].parts!)expect(locateText(b.element,part.text)?.toString()).toBe(part.text);}
  expect(document.body.innerHTML).toBe(original);
});
it('explains every part of uv init including the positional project name and --bare', () => {
  const [result]=explainCommand('uv init awesome-project --bare')!;
  expect(result.parts?.map(p=>p.text)).toEqual(['uv','init','awesome-project','--bare']);
  expect(result.parts?.[2].explanation).toContain('目录');expect(result.parts?.[3].explanation).toContain('pyproject.toml');
  expect(explainCommand('uv init app --unknown')).toBeNull();
  expect(explainCommand('uv init app && rm -rf app')).toBeNull();
});
it('preserves quoted arguments and can anchor repeated tokens precisely', () => {
  const [result]=explainCommand('uv add "fastapi[standard]"')!;
  expect(result.parts?.[2].text).toBe('"fastapi[standard]"');expect(result.parts?.[2].explanation).toContain('可选依赖');
  document.body.innerHTML='<pre><code>uv init uv --bare</code></pre>';
  const block=extractBlocks()[0];const r=locateText(block.element,'uv',8)!;
  expect(r.startOffset).toBe(8);
});
it('chunks highlighted Python code with stable offsets and surrounding context', () => {
  document.body.innerHTML='<article><h2>Python</h2><pre><code>from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/")\nasync def root():\n    return {"message": "hello"}\n\nx = 1\nx = 1\ny = 2</code></pre></article>';
  const blocks=extractBlocks();expect(blocks).toHaveLength(2);expect(blocks.every(b=>b.kind==='code')).toBe(true);
  expect(contextFor(blocks[1],blocks).before).toContain('FastAPI');
  const range=locateText(blocks[1].element,'x = 1',blocks[1].offset)!;
  expect(range.startOffset).toBe(blocks[1].offset);
  expect(matchesSnapshot(blocks[1])).toBe(true);blocks[1].element.append(' changed');expect(matchesSnapshot(blocks[1])).toBe(false);
});
it('only exposes ready summaries and does not retry failed blocks on scroll', () => {
  const store=new Preloads();const [concept]=explainCommand('uv init app')!;
  store.ready('a','v1',[{...concept,summary:''}]);expect(store.get('a','v1')?.concepts).toHaveLength(0);
  store.fail('a','v1','超时');store.ready('b','v1',[concept]);
  expect(store.get('a','v1')?.state).toBe('failed');expect(store.get('b','v1')?.state).toBe('ready');
  expect(store.get('a','v2')).toBeUndefined();store.retry();expect(store.get('a','v1')).toBeUndefined();expect(store.get('b','v1')?.state).toBe('ready');
});
it('rejects model concepts without preloaded explanation and accepts line parts', () => {
  const [concept]=explainCommand('uv init app')!;
  expect(analyzeSchema.safeParse({concepts:[{...concept,summary:undefined}]}).success).toBe(false);
  expect(analyzeSchema.safeParse({concepts:[concept]}).success).toBe(true);
});
it('does not misidentify another package with standard extras as FastAPI', () => {
  const [concept]=explainCommand('uv add "another-package[standard]"')!;
  expect(concept.parts?.[2].explanation).not.toContain('fastapi');
});

it('recognizes MIT/WSL prompts, strips them from command context, and skips terminal output',()=>{
 document.body.innerHTML=`<article><h2>Shell</h2><pre><code>missing:~$ sed -i 's/pattern/replacement/g' file
mr@Mechrevo-Jiaolong16pro :~$ sed -n '1,5p' file
missing:~$
pattern/replacement/g
</code></pre></article>`;
 const blocks=extractBlocks(),commands=blocks.filter(b=>b.kind==='command');
 expect(commands.map(b=>b.text)).toEqual(["sed -i 's/pattern/replacement/g' file","sed -n '1,5p' file"]);
 expect(commands.every(b=>matchesSnapshot(b))).toBe(true);
 expect(locateText(commands[0].element,'sed',commands[0].offset)?.toString()).toBe('sed');
 expect(blocks.some(b=>b.kind==='code')).toBe(false);
 expect(blocks.every(b=>!b.text.includes('missing:~$'))).toBe(true);
});

it('recognizes cd in ordinary shell blocks as a command with a local explanation',()=>{
 document.body.innerHTML='<article><pre><code>cd awesome-project</code></pre></article>';
 const blocks=extractBlocks();
 expect(blocks).toMatchObject([{kind:'command',text:'cd awesome-project'}]);
 expect(explainCommand(blocks[0].text)?.[0].meaning).toBe('切换目录');
});
