import React,{useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PDFViewer} from 'pdfjs-dist/types/web/pdf_viewer';
import type {PDFPageView} from 'pdfjs-dist/types/web/pdf_page_view';
import {wordKey,wordOccurrences,type ReadingWord} from '../reader/vocabulary';
import type {Concept} from '../core/types';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import './reader-pdf.css';

export type PdfDestination={page:number;top?:number};
type Props={pdf:PDFDocumentProxy;page:number;destination:PdfDestination;wordsForPage:(page:number)=>ReadingWord[];language:string;conceptFor:(w:ReadingWord)=>Concept|undefined;onWord:(w:ReadingWord)=>void;onPageChange:(page:number)=>void};
type Zoom='page-actual'|'page-fit'|'page-width'|'custom';

export function ReaderPdf(props:Props){
  const {pdf,page,destination,wordsForPage,language,conceptFor}=props;
  const container=useRef<HTMLDivElement>(null),pages=useRef<HTMLDivElement>(null),viewer=useRef<PDFViewer|null>(null);
  const latest=useRef(props);latest.current=props;
  const [initialized,setInitialized]=useState(false),[error,setError]=useState('');
  const [continuous,setContinuous]=useState(true),[zoom,setZoom]=useState<Zoom>('page-width'),[percent,setPercent]=useState(100);
  const [pageInput,setPageInput]=useState(String(page)),[pageError,setPageError]=useState('');
  const preferences=useRef({continuous,zoom});preferences.current={continuous,zoom};
  const navigationEpoch=useRef(0);
  const originalText=useRef(new WeakMap<HTMLElement,string>());

  function decorate(view:PDFPageView){
    const layer=view.textLayer?.div;if(!layer||layer.hidden)return;
    const words=latest.current.wordsForPage(view.id??0),language=latest.current.language;
    const spans=Array.from(layer.querySelectorAll<HTMLElement>('span[role="presentation"]:not(.markedContent)')).map(element=>{
      let text=originalText.current.get(element);
      if(text===undefined){text=element.textContent??'';originalText.current.set(element,text);}
      return {element,text};
    });
    const matches=new Map(spans.map(({element,text})=>[element,wordOccurrences(text,words,language)]));
    // Preserve both source fragments when a candidate crosses a PDF line break.
    if(language.startsWith('en'))for(let i=0;i<spans.length-1;i++){
      const left=spans[i],right=spans[i+1],a=/(\p{L}{2,})-[ \t]*$/u.exec(left.text),b=/^[ \t]*(\p{Ll}{2,})/u.exec(right.text);
      if(!a||!b)continue;const word=words.find(w=>w.key===wordKey(a[1]+b[1],language));if(!word)continue;
      const add=(element:HTMLElement,start:number,end:number)=>{const existing=matches.get(element)!.filter(m=>m.end<=start||m.start>=end);matches.set(element,[...existing,{word,start,end}].sort((a,b)=>a.start-b.start));};
      add(left.element,a.index,a.index+a[1].length+1);const start=right.text.indexOf(b[1]);add(right.element,start,start+b[1].length);
    }
    for(const {element,text} of spans){
      const fragment=document.createDocumentFragment();let cursor=0;
      for(const match of matches.get(element)??[]){
        fragment.append(text.slice(cursor,match.start));const button=document.createElement('button'),concept=latest.current.conceptFor(match.word);
        button.type='button';button.className=`pdf-word ${concept?'is-ready':'is-pending'}`;button.textContent=text.slice(match.start,match.end);button.title=concept?[concept.expansion,concept.meaning,concept.summary].filter(Boolean).join(' · '):'候选生词 · 释义尚未准备好';button.setAttribute('aria-label',`${match.word.anchor}：${concept?.meaning??'待准备的候选生词'}`);
        const select=()=>latest.current.onWord(match.word);button.onmouseenter=select;button.onfocus=select;button.onclick=select;
        fragment.append(button);cursor=match.end;
      }
      fragment.append(text.slice(cursor));element.replaceChildren(fragment);
    }
  }
  function goTo(target:PdfDestination){
    const ticket=++navigationEpoch.current,current=viewer.current;if(!current?.pagesCount)return;
    current.scrollPageIntoView({pageNumber:target.page});
    if(target.top!==undefined){
      // Offsets use viewport scale 1; viewer zoom 1 also converts PDF points to CSS pixels.
      const locate=(proxy:import('pdfjs-dist').PDFPageProxy)=>{
        if(viewer.current!==current||ticket!==navigationEpoch.current)return;
        const y=proxy.getViewport({scale:1}).convertToPdfPoint(0,target.top!)[1];
        current.scrollPageIntoView({pageNumber:target.page,destArray:[null,{name:'XYZ'},0,y,null],ignoreDestinationZoom:true});
      };
      const view:PDFPageView=current.getPageView(target.page-1);
      if(view.pdfPage)locate(view.pdfPage);else void pdf.getPage(target.page).then(locate).catch(()=>undefined);
    }
  }
  useEffect(()=>{
    let disposed=false,current:PDFViewer|undefined;const lifecycle=new AbortController();setInitialized(false);setError('');setContinuous(true);setZoom('page-width');setPageError('');
    void(async()=>{
      // The viewer consumes globalThis.pdfjsLib; load the matching legacy API first.
      const {pdfjs}=await import('./pdf-source');const {PDFViewer,EventBus}=await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');if(disposed)return;
      const bus=new EventBus();
      const options={container:container.current!,viewer:pages.current!,eventBus:bus,annotationMode:pdfjs.AnnotationMode.DISABLE,annotationEditorMode:pdfjs.AnnotationEditorType.DISABLE,enableAutoLinking:false,enableSelectionRendering:false,maxCanvasPixels:8*1024*1024,abortSignal:lifecycle.signal};
      current=new PDFViewer(options);viewer.current=current;
      bus.on('pagesinit',()=>{if(disposed)return;current!.currentScaleValue='page-width';setInitialized(true);goTo({page:latest.current.page,...(latest.current.destination.page===latest.current.page?{top:latest.current.destination.top}:{})});});
      bus.on('pagechanging',({pageNumber}:{pageNumber:number})=>{if(!disposed)latest.current.onPageChange(pageNumber);});
      bus.on('scalechanging',({scale}:{scale:number})=>{if(!disposed)setPercent(Math.round(scale*100));});
      bus.on('textlayerrendered',({pageNumber,error}:{pageNumber:number;error?:unknown})=>{if(!disposed&&!error)decorate(current!.getPageView(pageNumber-1));});
      bus.on('pagerendered',({pageNumber,error}:{pageNumber:number;error?:unknown})=>{
        if(disposed)return;if(error){setError('PDF 原版渲染失败，请重新导入文件。');return;}
        const view:PDFPageView=current!.getPageView(pageNumber-1),canvas=view.div.querySelector<HTMLCanvasElement>('canvas');if(!canvas)return;
        canvas.dataset.testid='pdf-canvas';canvas.dataset.renderedPage=String(pageNumber);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`PDF 原版第 ${pageNumber} 页（含图片、图表与公式）`);
      });
      current.setDocument(pdf);
      void current.firstPagePromise.catch(()=>{if(!disposed)setError('PDF 原版渲染失败，请重新导入文件。');});
    })().catch(()=>{if(!disposed)setError('PDF 阅读器加载失败，请重新导入文件。');});
    return()=>{disposed=true;navigationEpoch.current++;lifecycle.abort();if(current){current.setDocument(null as unknown as PDFDocumentProxy);viewer.current=null;}pages.current?.replaceChildren();};
  },[pdf]);
  useEffect(()=>{if(initialized)goTo(destination);},[destination,initialized]);
  useEffect(()=>{if(initialized&&viewer.current)viewer.current.scrollMode=continuous?0:3;},[continuous,initialized]);
  useEffect(()=>{if(initialized&&viewer.current&&zoom!=='custom')viewer.current.currentScaleValue=zoom;},[zoom,initialized]);
  useEffect(()=>{const element=container.current;if(!element)return;const observer=new ResizeObserver(()=>{const current=viewer.current,mode=preferences.current.zoom;if(current?.pagesCount&&mode!=='custom'){current.currentScaleValue=mode;current.update();}});observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(initialized)for(const view of viewer.current?.getCachedPageViews()??[])decorate(view);},[initialized,wordsForPage,language,conceptFor]);
  useEffect(()=>{setPageInput(String(page));setPageError('');},[page]);
  function jump(event:React.FormEvent){event.preventDefault();const number=Number(pageInput.trim());if(!/^\d+$/.test(pageInput.trim())||!Number.isInteger(number)||number<1||number>pdf.numPages){setPageError(`请输入 1–${pdf.numPages} 的整数页码`);return;}setPageError('');goTo({page:number});}
  function adjustZoom(value:number){setZoom('custom');setPercent(value);if(viewer.current)viewer.current.currentScale=value/100;}
  return <section className="reader-pdf" aria-label="PDF 阅读器">
    <div className="pdf-reader-controls" role="group" aria-label="PDF 阅读控制">
      <label className="check-row"><input type="checkbox" disabled={!initialized} checked={continuous} onChange={e=>setContinuous(e.target.checked)}/><span>连续阅读</span></label>
      <label>缩放模式<select aria-label="缩放模式" disabled={!initialized} value={zoom} onChange={e=>setZoom(e.target.value as Zoom)}><option value="page-actual">实际大小</option><option value="page-fit">适合页面</option><option value="page-width">适合宽度</option><option value="custom" disabled>自定义</option></select></label>
      <label className="pdf-zoom-slider"><span>缩放 <output aria-live="polite">{percent}%</output></span><input aria-label="缩放比例" disabled={!initialized} type="range" min="25" max="400" step="1" value={Math.min(400,Math.max(25,percent))} onChange={e=>adjustZoom(Number(e.target.value))}/></label>
      <form className="pdf-page-jump" onSubmit={jump} noValidate><button type="button" aria-label="上一页" disabled={!initialized||page===1} onClick={()=>goTo({page:page-1})}>‹</button><label>第 <input aria-label="跳转页码" inputMode="numeric" type="text" value={pageInput} onChange={e=>setPageInput(e.target.value)} aria-invalid={!!pageError} aria-describedby={pageError?'pdf-page-error':undefined}/> / {pdf.numPages} 页</label><button type="submit" disabled={!initialized}>跳转</button><button type="button" aria-label="下一页" disabled={!initialized||page===pdf.numPages} onClick={()=>goTo({page:page+1})}>›</button></form>
    </div>
    {pageError&&<p className="reader-hint" id="pdf-page-error" role="alert">{pageError}</p>}{error&&<p role="alert">{error}</p>}
    <div className="pdf-viewport-frame"><div className="pdf-scroll-container" ref={container} tabIndex={0} role="region" aria-label="PDF 页面" data-testid="pdf-scroll-container" data-current-page={page} data-zoom-mode={zoom} data-continuous={continuous}><div className="pdfViewer" ref={pages}/></div></div>
    {!initialized&&!error&&<p className="reader-hint" role="status">正在准备 PDF 页面…</p>}
  </section>;
}
