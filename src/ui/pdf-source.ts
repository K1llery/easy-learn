import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPdfDocument, type PdfProgress } from '../core/pdf-document';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function originPattern(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('PDF 地址无效，请填写完整网址，或直接选择本机文件。'); }
  if (url.protocol === 'file:') throw new Error('本机 PDF 请使用下方的文件选择入口。');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTPS / HTTP 的 PDF 网址；本机文件请使用文件选择入口。');
  return url.origin + '/*';
}

export async function hasPdfHostPermission(raw: string): Promise<boolean> {
  try { return await chrome.permissions.contains({ origins: [originPattern(raw)] }); }
  catch { return false; }
}

export async function downloadPdf(raw: string): Promise<Uint8Array> {
  const origin = originPattern(raw);
  const allowed = await chrome.permissions.contains({ origins: [origin] }) || await chrome.permissions.request({ origins: [origin] });
  if (!allowed) throw new Error('未授权访问该 PDF 所在网站，无法读取文件。');
  const response = await fetch(raw);
  if (!response.ok) throw new Error(`无法下载 PDF（HTTP ${response.status}）。`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function readLocalPdf(file: File): Promise<Uint8Array> {
  if (file.size > 100 * 1024 * 1024) throw new Error('这个 PDF 超过 100 MB，请使用较小的文件或提取需要阅读的章节。');
  return new Uint8Array(await file.arrayBuffer());
}

export function extractPdf(data: Uint8Array, onPage: PdfProgress) {
  const task = pdfjs.getDocument({
    data,
    cMapUrl: typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.getURL('pdfjs/cmaps/') : '/pdfjs/cmaps/', cMapPacked: true,
    standardFontDataUrl: typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.getURL('pdfjs/standard-fonts/') : '/pdfjs/standard-fonts/',
  });
  return extractPdfDocument(task, onPage);
}
