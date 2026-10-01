import { epubDocument, textDocument, type ReadingDocument } from '../reader/document';
import type {PDFDocumentProxy} from 'pdfjs-dist';
export type ImportedReadingFile={document:ReadingDocument;pdf?:PDFDocumentProxy};
export async function importReadingFile(file: File, progress:(text:string)=>void):Promise<ImportedReadingFile> {
  if (file.size > 100 * 1024 * 1024) throw new Error('文件超过 100 MB，请按章节拆分。');
  const name=file.name.replace(/\s*\(\d+\)$/, '');
  if (/\.pdf$/i.test(name)) {
    const [{openPdf,readLocalPdf},{extractStructuredPdf}]=await Promise.all([import('./pdf-source'),import('../reader/pdf-structure')]);
    const task=openPdf(await readLocalPdf(file));
    try{const pdf=await task.promise;const document=await extractStructuredPdf(pdf,name,(page,total)=>progress(`正在识别第 ${page} / ${total} 页的结构`));return {document,pdf};}
    catch(e){await task.destroy().catch(()=>undefined);throw e;}
  }
  if (/\.epub$/i.test(name)) { progress('正在读取 EPUB 章节');return {document:epubDocument(new Uint8Array(await file.arrayBuffer()),name)}; }
  if (/\.(?:txt|md|markdown)$/i.test(name)) {
    if(file.size>12*1024*1024)throw new Error('文本文件过大，请按章节拆分。');
    const bytes=await file.arrayBuffer();
    let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('请将文本另存为 UTF-8 后导入。');}
    return {document:textDocument(text,name,/\.(?:md|markdown)$/i.test(name))};
  }
  throw new Error('请选择 PDF、EPUB、TXT 或 Markdown 文件。');
}
