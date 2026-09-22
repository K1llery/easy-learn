import { readFileSync } from 'node:fs';
import { it,expect } from 'vitest';
import { extractBlocks } from '../src/content/document';
import { findCandidates,candidateEnvironment,candidateKey,packCandidates } from '../src/content/candidates';
function article(text:string){document.body.innerHTML='<article><p></p></article>';document.querySelector('p')!.textContent=text;return extractBlocks()[0];}
it.each(['python-classes','fastapi-readme','attention-paper'])('finds a small set of technical candidates in the real %s excerpt',name=>{
 const fixture=JSON.parse(readFileSync(`tests/fixtures/references/${name}.json`,'utf8'));
 const block=article(fixture.text);const candidates=findCandidates(block);
 expect(candidates.length).toBeGreaterThan(0);expect(candidates.length).toBeLessThanOrEqual(6);
 expect(candidates.every(c=>block.text.includes(c.anchor)&&c.context.length<=420)).toBe(true);
});
it('does not annotate ordinary words, capitalized headings, common flags or generic inline names',()=>{
 const block=article('IMPORTANT: Read the Documentation for Installation, Examples and Performance. This project has useful features and supports Python.');
 expect(findCandidates(block)).toHaveLength(0);
 document.querySelector('p')!.innerHTML+=' <code>app</code> <code>name</code> <code>example</code> <strong>Getting Started</strong>';
 expect(findCandidates(extractBlocks()[0])).toHaveLength(0);
});
it('retains sentence context so DR can mean different things without global acronym reuse',()=>{
 const recovery=findCandidates(article('The DR plan restores the application after a regional failure.')).find(c=>c.anchor==='DR')!;
 const daily=findCandidates(article('The DR job is a daily run performed every morning.')).find(c=>c.anchor==='DR')!;
 expect(candidateKey(recovery,'入门')).not.toBe(candidateKey(daily,'入门'));
});
it('limits the compact request size and merges up to eight candidates',()=>{
 const all=Array.from({length:20},(_,i)=>({candidate:{id:`c${i}`,anchor:'API',kind:'abbreviation' as const,heading:'',context:'x'.repeat(420)}}));
 const batch=packCandidates(all);expect(batch).toHaveLength(8);expect(JSON.stringify(batch.map(x=>x.candidate)).length).toBeLessThan(5100);
});
it('deduplicates identical context across repeated paragraphs while preserving candidates per occurrence',()=>{
 const text='An API connects independent applications through a contract.';
 document.body.innerHTML='<article>'+Array.from({length:100},()=>`<p>${text}</p>`).join('')+'</article>';
 const candidates=extractBlocks().flatMap(b=>findCandidates(b));expect(candidates).toHaveLength(100);
 expect(new Set(candidates.map(c=>candidateKey(c,'software/beginner'))).size).toBe(1);
});

it('rejects unexplained capitals and prose in pre while retaining explicit acronym definitions',()=>{
 expect(findCandidates(article('GREAT NEWS: AVAILABLE SOON. Run the example with DEFAULT settings.'))).toHaveLength(0);
 expect(findCandidates(article('XYZ stands for experimental yield zoning in this system.')).map(c=>c.anchor)).toContain('XYZ');
 document.body.innerHTML='<article><pre>DO NOT ANALYZE THIS CODE BLOCK</pre></article>';
 expect(extractBlocks().flatMap(b=>findCandidates(b))).toHaveLength(0);
});

it('recognizes essential FastAPI concepts together, including lowercase initialisms',()=>{
 const candidates=findCandidates(article('FastAPI uses Pydantic with http. GET retrieves data and POST submits data.'));
 expect(candidates.map(c=>c.anchor)).toEqual(expect.arrayContaining(['Pydantic','http','GET','POST']));
});
it('uses article context for headings and short method lists',()=>{
 document.body.innerHTML='<article><h1>FastAPI</h1><h2>Pydantic</h2><p>HTTP methods:</p><ul><li><code>get</code></li><li>POST</li></ul></article>';
 const blocks=extractBlocks(document,true),env=candidateEnvironment(blocks,'FastAPI');
 expect(blocks.flatMap(b=>findCandidates(b,env)).map(c=>c.anchor)).toEqual(expect.arrayContaining(['Pydantic','HTTP','get','POST']));
});
it('finds unfamiliar acronyms and explicitly introduced libraries in technical prose',()=>{
 expect(findCandidates(article('The authentication protocol uses PKCE and RBAC.')).map(c=>c.anchor)).toEqual(expect.arrayContaining(['PKCE','RBAC']));
 expect(findCandidates(article('Marshmallow is a serialization library.')).map(c=>c.anchor)).toContain('Marshmallow');
});
it('does not confuse ordinary verbs or notices with HTTP methods',()=>{
 const block=article('HTTP helps you get started. Write a post about it. IMPORTANT: GREAT NEWS AVAILABLE SOON.');
 expect(findCandidates(block).map(c=>c.anchor)).toEqual(['HTTP']);
 expect(findCandidates(article('GET your tickets and POST a letter today.'))).toHaveLength(0);
 expect(findCandidates(article('Use the HTTP get method and a post request.')).map(c=>c.anchor)).toEqual(expect.arrayContaining(['get','post']));
});
