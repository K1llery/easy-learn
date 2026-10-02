import {describe,it,expect} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {epubDocument,epubPath,htmlText,pdfReadingDocument,textDocument} from '../src/reader/document';
import {scanVocabulary,wordKey,wordOccurrences,exportVocabulary,recordWord} from '../src/reader/vocabulary';
import {readFileSync} from 'node:fs';
function epub(chapters:Record<string,string>={}) {
 return zipSync(Object.fromEntries(Object.entries({
  'META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
  'OEBPS/book.opf':'<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A public story</dc:title><dc:language>en</dc:language></metadata><manifest><item id="a" href="First%20chapter.xhtml" media-type="application/xhtml+xml"/><item id="b" href="second.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
  'OEBPS/First chapter.xhtml':'<html><body><h1>First</h1><p>A serendipitous encounter.</p></body></html>',
  'OEBPS/second.xhtml':'<html><body><h1>Second</h1><p>The ephemeral lantern glows.</p><script>window.bad=true</script><img src="https://example.test/tracker"/></body></html>',...chapters,
 }).map(([k,v])=>[k,strToU8(v)])));
}
describe('document imports',()=>{
 it('uses EPUB reading order and resolves percent-encoded chapter names',()=>{
  const result=epubDocument(epub(),'story.epub');expect(result.title).toBe('A public story');expect(result.sections.map(s=>s.title)).toEqual(['Second','First']);expect(result.sections[0].text).toContain('ephemeral');expect(result.sections[0].text).not.toContain('window.bad');
 });
 it('rejects missing chapters, remote chapter URLs and invalid archives',()=>{
  expect(()=>epubDocument(new Uint8Array([1,2,3]),'bad')).toThrow();expect(()=>epubPath('book.opf','https://attacker.test/chapter')).toThrow('文件中');expect(()=>epubDocument(epub({'OEBPS/First chapter.xhtml':''}),'bad')).not.toThrow();
  expect(()=>epubDocument(epub({'OEBPS/book.opf':'<broken'}),'bad')).toThrow('损坏');
 });
 it('rejects huge expansion and DRM, while accepting font obfuscation',()=>{
  expect(()=>epubDocument(epub({'OEBPS/huge.xhtml':'x'.repeat(8*1024*1024+1)}),'huge')).toThrow('过大');
  const encryption=(algorithm:string)=>`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptionMethod xmlns="http://www.w3.org/2001/04/xmlenc#" Algorithm="${algorithm}"/></encryption>`;
  expect(()=>epubDocument(epub({'META-INF/encryption.xml':encryption('http://example.test/drm')}),'protected')).toThrow('DRM');
  expect(()=>epubDocument(epub({'META-INF/encryption.xml':encryption('http://www.idpf.org/2008/embedding')}),'fonts')).not.toThrow();
 });
 it('splits Markdown at real headings and preserves readable code, ignoring HTML scripts',()=>{
  const result=textDocument('# Notes\n\nAn **ephemeral** bird.\n\n```python\n# not a chapter\nprint("bird")\n```\n\n## Next\n\n<img src="https://example.test/tracker" onerror="bad()"><script>steal()</script>Safe.','notes.md',true);
  expect(result.title).toBe('Notes');expect(result.sections).toHaveLength(2);expect(result.sections[0].text).toContain('# not a chapter');expect(result.sections[1].text).toContain('Safe.');expect(result.sections[1].text).not.toMatch(/steal|tracker|bad\(\)/);
 });
 it('retains paragraph boundaries, bounds model context and reports empty / binary documents',()=>{
  expect(htmlText('<p>First</p><p>Second</p>').text).toBe('First\n\nSecond');const doc=textDocument('First\n\n'+('word '.repeat(5000)),'long');expect(doc.sections.every(s=>s.text.length<=10000)).toBe(true);
  const longHeading=textDocument('# '+('h'.repeat(600))+'\n\nThe ephemeral bird.','long.md',true);expect(longHeading.title).toHaveLength(500);expect(longHeading.sections[0].title).toHaveLength(500);expect(longHeading.sections[0].text).toContain('h'.repeat(600));
  expect(()=>textDocument('','empty')).toThrow('文字');expect(()=>textDocument('a\u0000b','binary')).toThrow('UTF-8');expect(()=>pdfReadingDocument([{page:1,text:''}],'scan')).toThrow('OCR');
 });
});
describe('vocabulary reading',()=>{
 it.each(['LF','CRLF'])('uses actual frequency order and prioritizes late rare words over ordinary terms (%s)',lineEnding=>{
  const source=readFileSync('public/vocabulary/english-frequency.txt','utf8').replace(/\r?\n/g,lineEnding==='CRLF'?'\r\n':'\n');
  const words=source.split(/\s+/).filter(Boolean),common=new Set(words.slice(0,5000)),frequency=new Map(words.map((w,i)=>[w,i+1]));
  expect(words.slice(0,100)).toContain('you');expect(words.slice(0,100)).toContain('the');expect(new Set(words).size).toBe(words.length);
  const found=scanVocabulary({id:'s0',title:'Results',text:'The system provides addresses and explains the threat. Its results are useful. Cryptographic attestation ensures verifiable provenance.'},'en',common,new Set(),2,frequency);
  expect(found.map(w=>w.anchor)).toEqual(['Cryptographic','attestation']);expect(found.every(w=>w.start>50)).toBe(true);
 });
 const section={id:'s0',title:'Story',text:'The ephemeral bird sings. An ephemeral feather drifts by the lantern. Birds are singing.'};
 it('filters common inflections, keeps offsets, and finds repeated words without replacing source',()=>{
  const words=scanVocabulary(section,'en',new Set(['the','bird','sing','feather','drift','lantern']),new Set());expect(words.map(w=>w.anchor)).toEqual(['ephemeral']);expect(section.text.slice(words[0].start,words[0].end)).toBe('ephemeral');expect(wordOccurrences(section.text,words,'en')).toHaveLength(2);
 });
 it('honors user knowledge by language, and segments Japanese rather than splitting by spaces',()=>{
  expect(scanVocabulary(section,'en',new Set(),new Set([wordKey('ephemeral','en')])).some(w=>w.anchor==='ephemeral')).toBe(false);
  expect(wordKey('éphémère','fr')).not.toBe(wordKey('éphémère','en'));expect(scanVocabulary({id:'s0',title:'物語',text:'図書館で本を読みます。'},'ja',new Set(),new Set()).length).toBeGreaterThan(1);
 });
 it('exports learning words as safe Anki TSV and excludes known words',()=>{
  expect(exportVocabulary([{word:'ephemeral',language:'en',status:'learning',meaning:'短暂\t的',summary:'稍纵\n即逝<script>'},{word:'known',language:'en',status:'known'}])).toBe('ephemeral\t短暂 的\t稍纵 即逝script\ten');
 });
 it('includes contextual short abbreviations, excludes all-caps labels and preserves known-word feedback',()=>{
  const input={id:'s0',title:'Model security',text:'NOTE: A Large Language Model (LLM) uses a Trusted Execution Environment (TEE). LLMs appear again. TODO: test THE labels.'};
  const words=scanVocabulary(input,'en',new Set(['model','environment']),new Set(),40);
  expect(words.filter(w=>w.kind==='abbreviation').map(w=>w.anchor)).toEqual(['LLM','TEE','LLMs']);
  for(const word of words)expect(input.text.slice(word.start,word.end)).toBe(word.anchor);
  expect(words.some(w=>['NOTE','TODO','THE'].includes(w.anchor))).toBe(false);
  expect(scanVocabulary(input,'en',new Set(),new Set([wordKey('TEE','en')]),40).some(w=>w.anchor==='TEE')).toBe(false);
  const llm=words.find(w=>w.anchor==='LLM')!;
  const record=recordWord(llm,'en','learning',{anchor:'LLM',category:'缩写',meaning:'大语言模型',summary:'此处用于文本处理。',expansion:'Large Language Model',evidence:'',ambiguity:''});
  expect(record.expansion).toBe('Large Language Model');
  expect(exportVocabulary([record])).toContain('Large Language Model · 此处用于文本处理。');
  const unresolved=recordWord(llm,'en','learning',{anchor:'LLM',category:'缩写',meaning:'语境含义',summary:'此处指模型。',expansion:'',evidence:'',ambiguity:'全称待确认，原文没有定义。'});
  expect(unresolved.ambiguity).toBe('全称待确认，原文没有定义。');
  const fields=exportVocabulary([unresolved]).split('\t');expect(fields).toHaveLength(4);expect(fields[2]).toContain('全称待确认，原文没有定义。');
 });
});
