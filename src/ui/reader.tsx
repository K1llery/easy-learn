import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Concept} from '../core/types';
import {connectSurface} from '../core/connection';
import {textDocument,type ReadingDocument} from '../reader/document';
import {exportVocabulary,recordWord,scanVocabulary,wordOccurrences,type ReadingWord,type WordRecord} from '../reader/vocabulary';
import {importReadingFile} from './reader-source';
import {analyzeReading,inExtension} from './reader-rpc';
import {ReaderSettings} from './reader-settings';
import {ReaderPdf} from './reader-pdf';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {rpc} from './rpc';
import './style.css';
import './reader.css';
const WORD_STORE='easy-learn-reader-words-v1';
function storedWords():Record<string,WordRecord> {
  try {const data=JSON.parse(localStorage.getItem(WORD_STORE)??'{}');
    return Object.fromEntries(Object.entries(data).filter(([key,v])=>{const r=v as WordRecord;return key.length<100&&r&&typeof r.word==='string'&&r.word.length<=60&&typeof r.language==='string'&&['known','learning'].includes(r.status)&&(!r.meaning||typeof r.meaning==='string'&&r.meaning.length<=300)&&(!r.summary||typeof r.summary==='string'&&r.summary.length<=1200);})) as Record<string,WordRecord>;
  }catch{return {};}
}
function Reader() {
  const [doc,setDoc]=useState<ReadingDocument|null>(null),[sectionIndex,setSectionIndex]=useState(0),[fingerprint,setFingerprint]=useState('');
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[pdfPage,setPdfPage]=useState(1),[pdfView,setPdfView]=useState(true);
  const [language,setLanguage]=useState('en'),[baseline,setBaseline]=useState(5000),[fontSize,setFontSize]=useState(19);
  const [records,setRecords]=useState(storedWords),[wordsFile,setWordsFile]=useState<string[]>([]);
  const [settings,setSettings]=useState(false),[vocabOpen,setVocabOpen]=useState(false),[pasteOpen,setPasteOpen]=useState(false),[paste,setPaste]=useState('');
  const [loading,setLoading]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [reading,setReading]=useState(false),[wholeBook,setWholeBook]=useState(false);
  const [concepts,setConcepts]=useState<Record<string,Concept>>({}),[completed,setCompleted]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState(0),[batchSize,setBatchSize]=useState(4),[concurrency,setConcurrency]=useState(2),[density,setDensity]=useState(6);
  const [selected,setSelected]=useState<ReadingWord|null>(null);
  const importing=useRef(false);
  const fileInput=useRef<HTMLInputElement>(null),port=useRef<ReturnType<typeof connectSurface>|null>(null);
  const epoch=useRef(0),claimed=useRef(new Set<string>()),done=useRef(new Set<string>()),conceptRef=useRef<Record<string,Concept>>({});
  const currentIndex=useRef(0),active=useRef(false),inflight=useRef(0),work=useRef<ReadingWord[]>([]),scopeAll=useRef(false),book=useRef(doc);
  const prefs=useRef({batchSize,concurrency});
  const indices=useRef(new Map<string,number>());
  indices.current=useMemo(()=>new Map(doc?.sections.map((s,i)=>[s.id,i])??[]),[doc]);
  currentIndex.current=sectionIndex;active.current=reading;scopeAll.current=wholeBook;book.current=doc;prefs.current={batchSize,concurrency};
  async function refreshSettings(){try{const data=await rpc('PUBLIC_SETTINGS');setBatchSize(data.batchSize??4);setConcurrency(data.concurrency??2);setDensity(data.maxPerBlock??6);}catch(e){setError((e as Error).message);}}
  useEffect(()=>{
    if(inExtension){port.current=connectSurface('reader');port.current.port.onMessage.addListener(msg=>{if(msg.type==='REFRESH'){setRecords(storedWords());setReading(false);active.current=false;resetAnalysis();void refreshSettings();setNotice('阅读设置已更新，点击开启伴读继续。');}});}
    void refreshSettings();
    void fetch(inExtension?chrome.runtime.getURL('vocabulary/english-frequency.txt'):'/vocabulary/english-frequency.txt').then(r=>{if(!r.ok)throw new Error('词频表加载失败');return r.text();}).then(s=>setWordsFile(s.split(/\s+/).filter(Boolean))).catch(e=>setError(e.message));
    return()=>{epoch.current++;active.current=false;port.current?.disconnect();};
  },[]);
  useEffect(()=>()=>{void pdf?.loadingTask.destroy().catch(()=>undefined);},[pdf]);
  const common=useMemo(()=>new Set(wordsFile.slice(0,baseline)),[wordsFile,baseline]);
  const frequency=useMemo(()=>new Map(wordsFile.map((w,i)=>[w,i+1])),[wordsFile]);
  const known=useMemo(()=>new Set(Object.entries(records).filter(([,r])=>r.status==='known').map(([key])=>key)),[records]);
  const candidates=useMemo(()=>doc?.sections.flatMap(s=>scanVocabulary(s,language,common,known,Math.min(100,density*Math.max(1,Math.ceil(s.text.length/600))),frequency)).map((w,i)=>({...w,id:`c${i}`}))??[],[doc,language,common,known,density,frequency]);
  const keyFor=(w:ReadingWord)=>JSON.stringify([w.sectionId,w.key,w.context]);
  work.current=candidates;
  function resetAnalysis(){epoch.current++;claimed.current.clear();done.current.clear();conceptRef.current={};setConcepts({});setCompleted(new Set());setSelected(null);setError('');}
  async function loadDocument(next:ReadingDocument,source:PDFDocumentProxy|null=null) {
    setReading(false);active.current=false;resetAnalysis();
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(next)));
    const key=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
    let index=0;try{index=Number(localStorage.getItem('reader-position:'+key)??0);}catch{/* reading still works */}
    const restored=Number.isInteger(index)&&index>=0&&index<next.sections.length?index:0;
    setFingerprint(key);setSectionIndex(restored);setDoc(next);setPdf(source);setPdfPage(next.sections[restored].pageStart??1);setPdfView(true);setLanguage(['en','fr','de','es','ja','ko'].includes(next.language.split('-')[0])?next.language.split('-')[0]:'en');setNotice('文件已在本机读取。点击“开启伴读”后，候选词和短语境才会发送给模型。');setLoading('');setPasteOpen(false);
  }
  async function openFile(file:File){if(importing.current)return;importing.current=true;setLoading('正在读取文件');setError('');try{const imported=await importReadingFile(file,setLoading);await loadDocument(imported.document,imported.pdf??null);}catch(e){setError((e as Error).message);setLoading('');}finally{importing.current=false;}}
  function navigate(index:number){setSectionIndex(index);setPdfPage(doc?.sections[index].pageStart??1);setSelected(null);try{if(fingerprint)localStorage.setItem('reader-position:'+fingerprint,String(index));}catch{/* nonessential position */}window.scrollTo({top:0,behavior:'instant'});}
  function navigatePdf(page:number){setPdfPage(page);setSelected(null);const index=doc?.sections.findIndex(s=>(s.pageStart??1)<=page&&(s.pageEnd??1)>=page)??-1;if(index>=0)setSectionIndex(index);window.scrollTo({top:0,behavior:'instant'});}
  function startAnalysis(){setError('');setNotice('');setReading(true);active.current=true;pump();}
  function pump(){
    const generation=epoch.current;
    while(active.current&&inflight.current<prefs.current.concurrency&&book.current){
      const eligible=work.current.filter(w=>{const i=indices.current.get(w.sectionId)??0;return (scopeAll.current||i>=currentIndex.current&&i<currentIndex.current+3)&&!claimed.current.has(keyFor(w))&&!done.current.has(keyFor(w));}).sort((a,b)=>{
        const rank=(w:ReadingWord)=>{const i=indices.current.get(w.sectionId)??0;return i>=currentIndex.current?i-currentIndex.current:10000+i;};return rank(a)-rank(b);
      });
      const batch=eligible.slice(0,prefs.current.batchSize);if(!batch.length)break;
      for(const w of batch)claimed.current.add(keyFor(w));
      inflight.current++;setBusy(inflight.current);
      const apply=(p:{concepts:Concept[];skipped:string[]})=>{
        if(generation!==epoch.current)return;
        for(const c of p.concepts){const w=batch.find(w=>w.id===c.id);if(w){conceptRef.current[keyFor(w)]=c;done.current.add(keyFor(w));}}
        for(const id of p.skipped){const w=batch.find(w=>w.id===id);if(w)done.current.add(keyFor(w));}
        setConcepts({...conceptRef.current});setCompleted(new Set(done.current));
      };
      const controller=new AbortController();
      const request={operation:'analyze' as const,context:{title:book.current.title,heading:'',text:'生词预读',before:'',after:''},candidates:batch.map(({id,anchor,kind,heading,context})=>({id,anchor,kind,heading,context}))};
      void analyzeReading(request,controller.signal,apply,port.current?.port).then(result=>{
        apply(result);
        if(generation!==epoch.current)return;
        if(result.missing?.length||result.__warning){active.current=false;setReading(false);setError(result.__warning??'部分释义尚未完成，已暂停。点击继续后手动重试。');}
      }).catch(e=>{if(generation===epoch.current){active.current=false;setReading(false);setError(e.message);}}).finally(()=>{
        if(generation===epoch.current)for(const w of batch)claimed.current.delete(keyFor(w));inflight.current--;setBusy(inflight.current);if(generation===epoch.current&&active.current)pump();else if(active.current&&inflight.current===0)pump();
      });
    }
  }
  useEffect(()=>{if(reading&&wordsFile.length)pump();},[reading,sectionIndex,wholeBook,candidates,batchSize,concurrency,wordsFile]);
  const section=doc?.sections[sectionIndex];
  const pdfWords=useMemo(()=>candidates.filter(w=>{const s=doc?.sections[indices.current.get(w.sectionId)??-1];return !!s&&(s.pageStart??1)<=pdfPage&&(s.pageEnd??1)>=pdfPage&&(concepts[keyFor(w)]||!completed.has(keyFor(w)));}),[candidates,pdfPage,concepts,completed,doc]);
  const conceptFor=useCallback((w:ReadingWord)=>conceptRef.current[JSON.stringify([w.sectionId,w.key,w.context])],[]);
  const sectionWords=useMemo(()=>candidates.filter(w=>w.sectionId===section?.id),[candidates,section?.id]);
  const visibleWords=useMemo(()=>sectionWords.filter(w=>concepts[keyFor(w)]||!completed.has(keyFor(w))),[sectionWords,concepts,completed]);
  const occurrences=useMemo(()=>section?wordOccurrences(section.text,visibleWords,language):[],[section,visibleWords,language]);
  function saveWord(w:ReadingWord,status:'known'|'learning'){
    const next={...records,[w.key]:recordWord(w,language,status,concepts[keyFor(w)])};
    try{if(Object.keys(next).length>5000)throw new Error('词汇记录达到 5000 条，请导出并清理后继续。');localStorage.setItem(WORD_STORE,JSON.stringify(next));setRecords(next);setSelected(null);}catch(e){setError((e as Error).message);}
  }
  function removeWord(key:string){try{const next={...records};delete next[key];localStorage.setItem(WORD_STORE,JSON.stringify(next));setRecords(next);}catch(e){setError((e as Error).message);}}
  function exportWords(){const blob=new Blob(['\ufeff'+exportVocabulary(Object.values(records))],{type:'text/tab-separated-values;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Easy-Learn-vocabulary.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const displayedConcept=selected?concepts[keyFor(selected)]:null;
  const learning=Object.values(records).filter(r=>r.status==='learning');
  let cursor=0;const rendered:React.ReactNode[]=[];
  for(const {word,start,end} of occurrences){rendered.push(section!.text.slice(cursor,start));const concept=concepts[keyFor(word)];rendered.push(<button key={start} className={`reader-word ${concept?'is-ready':'is-pending'}`} title={concept?`${concept.meaning} · ${concept.summary}`:'候选生词 · 释义尚未准备好'} onMouseEnter={()=>setSelected(word)} onFocus={()=>setSelected(word)} onClick={()=>setSelected(word)} aria-label={concept?`${word.anchor}：${concept.meaning}`:`${word.anchor}：待准备的候选生词`}>{section!.text.slice(start,end)}</button>);cursor=end;}
  if(section)rendered.push(section.text.slice(cursor));
  return <div className="reader-shell">
    <header className="reader-bar"><a className="brand" href="reader.html"><span className="brandmark">E</span>Easy Learn</a><nav aria-label="工作台"><button className="quiet" onClick={()=>fileInput.current?.click()}>打开文件</button><button className="quiet" onClick={()=>setPasteOpen(!pasteOpen)}>粘贴文本</button><button className="quiet" onClick={()=>setVocabOpen(!vocabOpen)}>生词本{learning.length>0?` · ${learning.length}`:''}</button><button className="quiet" onClick={()=>setSettings(!settings)}>设置</button></nav></header>
    <input ref={fileInput} id="reader-file" type="file" accept=".pdf,.epub,.txt,.md,.markdown" aria-label="导入阅读文件" hidden disabled={!!loading} onChange={e=>{const file=e.target.files?.[0];if(file)void openFile(file);e.target.value='';}}/>
    {settings&&<ReaderSettings onClose={()=>setSettings(false)} onSaved={()=>{setReading(false);active.current=false;resetAnalysis();void refreshSettings();}}/>}
    {error&&<div className="reader-message error" role="alert">{error}</div>}
    {loading&&<div className="reader-message busy" role="status"><span className="dot"/>{loading}</div>}
    {pasteOpen&&<form className="reader-message card" onSubmit={e=>{e.preventDefault();try{void loadDocument(textDocument(paste,'粘贴的文章'));}catch(e){setError((e as Error).message);}}}><label htmlFor="reader-paste">粘贴要读的外语原文</label><textarea id="reader-paste" value={paste} onChange={e=>setPaste(e.target.value)} maxLength={3000000}/><div className="actions"><button className="primary" disabled={!paste.trim()}>开始阅读</button><button type="button" onClick={()=>setPasteOpen(false)}>取消</button></div></form>}
    {vocabOpen&&<section className="reader-message card" aria-label="生词本"><div className="row"><h2>生词本</h2><button onClick={exportWords} disabled={!learning.length}>导出到 Anki（TSV）</button></div><p className="muted">只保存你主动收集的单词和释义，已认识的词会在同语言阅读中隐藏。共 {Object.keys(records).length} 条；导出不含密钥和整篇原文。</p>{Object.entries(records).map(([key,r])=><div className="learned row" key={key}><div><b>{r.word}</b><small> · {r.language} · {r.status==='known'?'已认识':'学习中'}</small><p>{r.meaning}</p></div><button className="quiet" onClick={()=>removeWord(key)}>移除</button></div>)}{!Object.keys(records).length&&<p className="notice">在原文中点击一个标注的单词，就能收进生词本。</p>}</section>}
    {!doc&&!loading&&<main className="reader-welcome"><div className="reader-book-icon" aria-hidden="true">Aa</div><h1>阅读工作台</h1><p>打开外语原文，提前准备生词释义。</p><div className="reader-import" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)void openFile(f);}}><button className="primary" onClick={()=>fileInput.current?.click()}>选择文件</button><span>或将文件拖到这里</span><small>PDF · EPUB · TXT · Markdown</small></div><p className="reader-local">文件在本机提取。原文保持原样，释义按需提前准备。<br/>阅读位置和生词记录保存在本机，重新导入同一文件可继续阅读。</p></main>}
    {doc&&section&&<div className="reader-layout"><aside className="reader-sidebar"><div className="reader-document-meta"><span className="tag">{doc.format}</span><h2>{doc.title}</h2><p className="muted">{doc.sections.length} 个{doc.structure==='fragments'?'阅读片段':'阅读章节'}{doc.pageCount?` · ${doc.pageCount} 页`:null}</p></div><nav aria-label="章节目录">{doc.sections.map((s,i)=><button key={s.id} data-depth={s.depth??0} aria-current={i===sectionIndex?'page':undefined} onClick={()=>navigate(i)}>{s.title}</button>)}</nav></aside>
      <main className="reader-main"><div className="reader-toolbar"><label>原文语言<select aria-label="原文语言" value={language} disabled={busy>0} onChange={e=>{setReading(false);active.current=false;resetAnalysis();setLanguage(e.target.value);}}>{[['en','英语'],['fr','法语'],['de','德语'],['es','西班牙语'],['ja','日语'],['ko','韩语']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        {language==='en'&&<label>常用词基础<select aria-label="常用词基础" value={baseline} disabled={busy>0} onChange={e=>{setReading(false);active.current=false;resetAnalysis();setBaseline(Number(e.target.value));}}><option value={2000}>前 2000 词</option><option value={5000}>前 5000 词</option><option value={10000}>前 10000 词</option></select></label>}
        <label>字号<select aria-label="阅读字号" value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}><option value={17}>小</option><option value={19}>中</option><option value={22}>大</option></select></label>
        <button className={reading?'':'primary'} disabled={!wordsFile.length} onClick={()=>{if(reading){active.current=false;setReading(false);}else startAnalysis();}}>{reading?'暂停伴读':completed.size?'继续伴读':'开启伴读'}</button></div>
        <div className="reader-progress" role="status"><span>{busy?`正在准备 · ${busy} 路请求`:reading?'伴读已开启':'伴读已暂停'} · 本节 {sectionWords.filter(w=>completed.has(keyFor(w))).length} / {sectionWords.length} 个候选已处理</span><label className="check-row"><input type="checkbox" checked={wholeBook} onChange={e=>setWholeBook(e.target.checked)}/><span>提前准备整份文档</span></label></div>
        {notice&&<p className="reader-hint">{notice}</p>}
        {language!=='en'&&<p className="reader-hint">当前语言使用浏览器分词筛选候选，尚无对应词频等级表；候选不代表你一定不认识，可标记“已认识”。</p>}
        {pdf&&<><div className="reader-view-switch" role="group" aria-label="PDF 阅读视图"><button aria-pressed={pdfView} onClick={()=>setPdfView(true)}>原版（含图表）</button><button aria-pressed={!pdfView} onClick={()=>setPdfView(false)}>文字伴读</button></div><p className="reader-hint">{doc.structure==='outline'?'目录来自 PDF 书签。':doc.structure==='headings'?'目录依据结构标签与标题样式识别。':'未检测到可靠标题；以下为阅读片段，不是论文的章节。'} 原版保留图片、图表和公式，图片不发送给模型。{!doc.sections.some(s=>s.text.trim())?'此文件没有文字层，仍可查看原版；生词伴读需要先 OCR。':''}</p></>}
        {pdf&&pdfView?<><h1 className="pdf-section-heading">{section.title}</h1><ReaderPdf pdf={pdf} page={pdfPage} top={section.pageStart===pdfPage?section.top:undefined} words={pdfWords} language={language} conceptFor={conceptFor} onWord={setSelected}/></>:<article className="reader-article" lang={language} style={{fontSize}}><h1>{section.title}</h1><div className="reader-prose" data-testid="reader-prose">{rendered}</div></article>}
        {pdf&&pdfView?<div className="reader-pagination"><button disabled={pdfPage===1} onClick={()=>navigatePdf(pdfPage-1)}>上一页</button><span>第 {pdfPage} / {pdf.numPages} 页</span><button disabled={pdfPage===pdf.numPages} onClick={()=>navigatePdf(pdfPage+1)}>下一页</button></div>:<div className="reader-pagination"><button disabled={sectionIndex===0} onClick={()=>navigate(sectionIndex-1)}>上一节</button><span>{sectionIndex+1} / {doc.sections.length}</span><button disabled={sectionIndex===doc.sections.length-1} onClick={()=>navigate(sectionIndex+1)}>下一节</button></div>}
        <p className="reader-hint">默认预读本节与接下来两节。下划线表示候选，释义准备好后显示浅色标记。悬停和点击都不请求模型。暂停后在途请求可能继续完成。</p>
      </main><aside className="reader-inspector" aria-label="词语释义">{selected?<><div className="row"><small>{displayedConcept?'语境释义':'候选生词'}</small><button className="quiet" onClick={()=>setSelected(null)} aria-label="关闭释义">×</button></div><h2 lang={language}>{selected.anchor}</h2>{displayedConcept?<><h3>{displayedConcept.meaning}</h3><p>{displayedConcept.summary}</p>{displayedConcept.ambiguity&&<p className="muted">{displayedConcept.ambiguity}</p>}</>:<p className="muted">释义尚未准备好。开启伴读后会提前分析，悬停不会发起请求。</p>}<div className="actions"><button disabled={!displayedConcept} onClick={()=>saveWord(selected,'learning')}>加入生词本</button><button className="quiet" onClick={()=>saveWord(selected,'known')}>已认识</button></div></>:<><small>词语释义</small><h2>边读边理解</h2><p className="muted">将鼠标移到标注的单词，或用键盘聚焦，即可查看预先准备的解释。</p></>}</aside>
    </div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Reader/>);
