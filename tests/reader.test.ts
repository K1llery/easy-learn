import {describe,it,expect} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {epubDocument,epubPath,htmlText,pdfReadingDocument,textDocument} from '../src/reader/document';
import {scanVocabulary,wordKey,wordOccurrences,exportVocabulary} from '../src/reader/vocabulary';
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
});
