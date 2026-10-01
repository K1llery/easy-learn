import { epubDocument, pdfReadingDocument, textDocument, type ReadingDocument } from '../reader/document';
export async function importReadingFile(file: File, progress:(text:string)=>void):Promise<ReadingDocument> {
  if (file.size > 100 * 1024 * 1024) throw new Error('文件超过 100 MB，请按章节拆分。');
  const name=file.name.replace(/\s*\(\d+\)$/, '');
  if (/\.pdf$/i.test(name)) {
    const {extractPdf,readLocalPdf}=await import('./pdf-source');
    const doc=await extractPdf(await readLocalPdf(file),(page,total)=>progress(`正在提取第 ${page} / ${total} 页`));
    return pdfReadingDocument(doc.pages,name);
  }
  if (/\.epub$/i.test(name)) { progress('正在读取 EPUB 章节');return epubDocument(new Uint8Array(await file.arrayBuffer()),name); }
  if (/\.(?:txt|md|markdown)$/i.test(name)) {
    if(file.size>12*1024*1024)throw new Error('文本文件过大，请按章节拆分。');
    const bytes=await file.arrayBuffer();
    let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('请将文本另存为 UTF-8 后导入。');}
    return textDocument(text,name,/\.(?:md|markdown)$/i.test(name));
  }
  throw new Error('请选择 PDF、EPUB、TXT 或 Markdown 文件。');
}
