import {it,expect} from 'vitest';
import {orderPdfLines,pdfLines,structuredPdf,type PdfLine,type PdfTextPage} from '../src/reader/pdf-structure';
import type {TextContent,StructTreeNode} from 'pdfjs-dist/types/src/display/api';
const line=(text:string,page=1,top=100,size=10,x=50,width=200):PdfLine=>({text,page,top,size,x,width,bold:false});
const page=(n:number,lines:PdfLine[]):PdfTextPage=>({page:n,width:600,height:800,lines});
it('finds nested numbered headings and keeps a section across a page boundary',()=>{
 const doc=structuredPdf([page(1,[line('Paper Title',1,40,20),line('Abstract',1,100,12),line('A short abstract.',1,130),line('1 Introduction',1,180,14),line('The first paragraph.',1,210),line('1.1 Threat Model',1,260,12),line('The ephemeral assumption.',1,290)]),page(2,[line('This continues the threat model.',2,100),line('2 Evaluation',2,180,14),line('The cryptographic result.',2,210)])],[],'paper.pdf');
 expect(doc.structure).toBe('headings');expect(doc.sections.map(s=>s.title)).toEqual(['标题与摘要','Abstract','1 Introduction','1.1 Threat Model','2 Evaluation']);
 const nested=doc.sections.find(s=>s.title==='1.1 Threat Model')!;expect(nested.depth).toBe(1);expect(nested.pageStart).toBe(1);expect(nested.pageEnd).toBe(2);expect(nested.text).toContain('This continues');expect(nested.pageSpans?.map(s=>s.page)).toEqual([1,2]);
});
it('uses PDF bookmark hierarchy and exact same-page headings rather than turning pages into chapters',()=>{
 const doc=structuredPdf([page(1,[line('Introduction',1,100),line('Text before.',1,130),line('Assumptions',1,180),line('Text after.',1,210)])],[{title:'Introduction',depth:0,page:1},{title:'Assumptions',depth:1,page:1}],'paper');
 expect(doc.structure).toBe('outline');expect(doc.sections.map(s=>[s.title,s.depth])).toEqual([['Introduction',0],['Assumptions',1]]);
});
it('honors tagged H2 text and does not depend on font size for accessible PDFs',()=>{
 const content={lang:'en',items:[{type:'beginMarkedContentProps',id:'p0_mcid0'},{str:'Methods',dir:'ltr',hasEOL:true,transform:[10,0,0,10,50,650],width:70,height:10,fontName:'f1'},{type:'endMarkedContent'},{str:'Body text.',dir:'ltr',hasEOL:true,transform:[10,0,0,10,50,620],width:100,height:10,fontName:'f1'}],styles:{f1:{fontFamily:'serif',vertical:false,ascent:.8,descent:-.2}}} as TextContent;
 const tree={role:'Root',children:[{role:'H2',children:[{type:'content',id:'p0_mcid0'}]}]} as StructTreeNode;
 const lines=pdfLines(content,tree,1,600,800);expect(lines[0].level).toBe(2);const doc=structuredPdf([page(1,lines)],[],'paper');expect(doc.sections[0]).toMatchObject({title:'Methods',depth:1});
});
it('reads two columns in column order, while preserving spanning headings',()=>{
 const lines=[line('1 Introduction',1,50,14,50,500)];for(let n=0;n<5;n++)lines.push(line('Left '+n,1,100+n*20,10,50,210),line('Right '+n,1,100+n*20,10,330,210));
 expect(orderPdfLines(lines,600).map(s=>s.text)).toEqual(['1 Introduction',...Array.from({length:5},(_,n)=>'Left '+n),...Array.from({length:5},(_,n)=>'Right '+n)]);
});
it('removes repeated running headers and page numbers but keeps ordinary numbered prose and captions',()=>{
 const pages=Array.from({length:3},(_,i)=>page(i+1,[line('Paper running header',i+1,20),line('1 Introduction',i+1,100,14),line('100 participants joined.',i+1,130),line('Figure 1: Results',i+1,160,12),line(String(i+1),i+1,780)]));
 const doc=structuredPdf(pages,[],'paper');expect(doc.sections.map(s=>s.text).join('')).not.toContain('running header');expect(doc.sections.some(s=>s.title.startsWith('Figure'))).toBe(false);expect(doc.sections[0].text).toContain('100 participants');
 const code=structuredPdf([page(1,[line('1 Introduction',1,100,14),line('Text.',1,130),line('1 for (var i = 2; i < 100; ++i) {',1,180),line('Text continues.',1,210)])],[],'paper');expect(code.sections.map(s=>s.title)).toEqual(['1 Introduction']);
});
it('clearly labels unstructured text fragments and still accepts image-only PDFs for original rendering',()=>{
 const doc=structuredPdf([page(1,[line('Ordinary sentence.',1,100)]),page(2,[line('It continues.',2,100)])],[],'paper');expect(doc.structure).toBe('fragments');expect(doc.sections).toHaveLength(1);expect(doc.sections[0].title).not.toMatch(/第.*页/);
 const images=structuredPdf([page(1,[])],[],'scanned');expect(images.sections[0].text).toBe('');expect(images.pageCount).toBe(1);
});
