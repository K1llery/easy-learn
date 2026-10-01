import React,{useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy,PDFPageProxy,RenderTask} from 'pdfjs-dist';
import {wordKey,wordOccurrences,type ReadingWord} from '../reader/vocabulary';
import type {Concept} from '../core/types';
import './reader-pdf.css';

type Props={pdf:PDFDocumentProxy;page:number;top?:number;words:ReadingWord[];language:string;conceptFor:(w:ReadingWord)=>Concept|undefined;onWord:(w:ReadingWord)=>void};
export function ReaderPdf({pdf,page:pageNumber,top,words,language,conceptFor,onWord}:Props){
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),layer=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(600),[ready,setReady]=useState(0),[error,setError]=useState('');
  const spans=useRef<{element:HTMLElement;text:string}[]>([]),scale=useRef(1),props=useRef({words,language,conceptFor,onWord});props.current={words,language,conceptFor,onWord};
  useEffect(()=>{const el=host.current!;const observer=new ResizeObserver(entries=>{const size=entries[0].contentRect.width;if(size>0)setWidth(Math.round(size));});observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let disposed=false,render:RenderTask|undefined,textLayer:{cancel:()=>void}|undefined,page:PDFPageProxy|undefined;
    const surface=canvas.current!,container=layer.current!;spans.current=[];container.replaceChildren();setError('');setReady(0);
    void (async()=>{
      const {pdfjs}=await import('./pdf-source');if(disposed)return;
      page=await pdf.getPage(pageNumber);if(disposed)return;
      const original=page.getViewport({scale:1});scale.current=Math.min(2,width/original.width);
      const viewport=page.getViewport({scale:scale.current}),pixelRatio=Math.min(2,window.devicePixelRatio||1);
      surface.width=Math.ceil(viewport.width*pixelRatio);surface.height=Math.ceil(viewport.height*pixelRatio);surface.style.width=`${viewport.width}px`;surface.style.height=`${viewport.height}px`;
      const parent=container.parentElement!;parent.style.width=`${viewport.width}px`;parent.style.height=`${viewport.height}px`;parent.style.setProperty('--total-scale-factor',String(viewport.scale));
      render=page.render({canvas:surface,viewport,transform:pixelRatio===1?undefined:[pixelRatio,0,0,pixelRatio,0,0]});
      const content=await page.getTextContent();if(disposed)return;
      const text=new pdfjs.TextLayer({textContentSource:content,container,viewport});textLayer=text;
      await Promise.all([render.promise,text.render()]);if(disposed)return;
      spans.current=text.textDivs.map((element,i)=>({element,text:text.textContentItemsStr[i]}));setReady(pageNumber);
    })().catch(e=>{if(!disposed&&e?.name!=='RenderingCancelledException')setError('PDF 原版渲染失败，请重新导入文件。');});
    return()=>{disposed=true;render?.cancel();textLayer?.cancel();void render?.promise.catch(()=>undefined).finally(()=>page?.cleanup());};
  },[pdf,pageNumber,width]);
  useEffect(()=>{
    if(!ready)return;
    const matches=new Map(spans.current.map(({element,text})=>[element,wordOccurrences(text,words,language)]));
    // PDF line-end hyphenation splits a single candidate between text runs.
    // Highlight both source fragments without altering the visible document.
    if(language.startsWith('en'))for(let i=0;i<spans.current.length-1;i++){
      const left=spans.current[i],right=spans.current[i+1],a=/(\p{L}{2,})-[ \t]*$/u.exec(left.text),b=/^[ \t]*(\p{Ll}{2,})/u.exec(right.text);
      if(!a||!b)continue;const word=words.find(w=>w.key===wordKey(a[1]+b[1],language));if(!word)continue;
      const add=(element:HTMLElement,start:number,end:number)=>{const existing=matches.get(element)!.filter(m=>m.end<=start||m.start>=end);matches.set(element,[...existing,{word,start,end}].sort((a,b)=>a.start-b.start));};
      add(left.element,a.index,a.index+a[1].length+1);const start=right.text.indexOf(b[1]);add(right.element,start,start+b[1].length);
    }
    for(const {element,text} of spans.current){
      const fragment=document.createDocumentFragment();let cursor=0;
      for(const match of matches.get(element)??[]){
        fragment.append(text.slice(cursor,match.start));const button=document.createElement('button'),concept=conceptFor(match.word);
        button.type='button';button.className=`pdf-word ${concept?'is-ready':'is-pending'}`;button.textContent=text.slice(match.start,match.end);button.title=concept?`${concept.meaning} · ${concept.summary}`:'候选生词 · 释义尚未准备好';button.setAttribute('aria-label',`${match.word.anchor}：${concept?.meaning??'待准备的候选生词'}`);
        const select=()=>props.current.onWord(match.word);button.onmouseenter=select;button.onfocus=select;button.onclick=select;
        fragment.append(button);cursor=match.end;
      }
      fragment.append(text.slice(cursor));element.replaceChildren(fragment);
    }
  },[ready,words,language,conceptFor]);
  useEffect(()=>{if(ready&&top!==undefined&&top>0){const bounds=host.current!.getBoundingClientRect();window.scrollTo({top:window.scrollY+bounds.top+top*scale.current-100,behavior:'instant'});}},[ready,top]);
  return <div className="reader-pdf" ref={host}>{error&&<p role="alert">{error}</p>}<div className="pdf-page-surface"><canvas ref={canvas} role="img" aria-label={`PDF 原版第 ${pageNumber} 页（含图片、图表与公式）`} data-testid="pdf-canvas" data-rendered-page={ready||undefined}/><div className="textLayer" ref={layer} aria-label={`第 ${pageNumber} 页可选择原文`}/></div>{!ready&&!error&&<p className="reader-hint" role="status">正在显示原版第 {pageNumber} 页…</p>}</div>;
}
