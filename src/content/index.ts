import { conceptKey, type Concept, type Mastered, type Profile, type TextContext } from '../core/types';
import { contextFor, extractBlocks, locateText, matchesSnapshot, type Block } from './document';
import { localExplanation } from './glossary';
import { explainCommand } from './commands';
import { findCandidates, candidateKey, packCandidates } from './candidates';
import type { Candidate } from '../core/types';
import { rpc } from '../ui/rpc';
import { connectSurface } from '../core/connection';

type Annotation = { range: Range; concept: Concept; block: Block; part?: {text:string;explanation:string} };
type Payload = { context: TextContext; expandedContext: TextContext; concept?: Concept; mode: 'explain' | 'translate' };
const state = globalThis as typeof globalThis & { __easyLearn?: { toggle(): void } };
if (state.__easyLearn) state.__easyLearn.toggle();
else {
  let dirty=true;
  let active=false, generation=0, running=false, scheduled=0, rescan=false, hoverTimer=0;
  let host: HTMLDivElement, shadow: ShadowRoot, toolbar: HTMLSpanElement, statusNode: HTMLButtonElement, tools: HTMLDivElement, diagnostic: HTMLParagraphElement;
  let tip: HTMLDivElement, selectionButton: HTMLButtonElement, frame: HTMLIFrameElement | undefined;
  let connection: ReturnType<typeof connectSurface> | undefined, observer: MutationObserver | undefined;
  let blocks: Block[]=[], annotations: Annotation[]=[], payload: Payload | undefined, selected: Payload | undefined, shown: Annotation | undefined;
  let profile: Profile={domain:'软件开发',level:'入门'}, mastered: Mastered[]=[];
  let settingsError='', networkPaused=false, codeAnnotations=false,localOnly=false;
  let codeToggle:HTMLInputElement, domainInput:HTMLInputElement, levelSelect:HTMLSelectElement;
  type Work = {candidate:Candidate;state:'pending'|'loading'|'ready'|'skipped'|'failed';concept?:Concept;error?:string};
  type Target = {block:Block;work:Work;offset:number};
  const workByKey=new Map<string,Work>();let targets:Target[]=[],nextId=0;
  let batchCount=0,tokenCount=0,usageKnown=false,userPaused=false,observed:IntersectionObserver|undefined;
  let progress:HTMLSpanElement;const observedNodes=new Set<HTMLElement>();

  const highlightName=`easy-learn-${chrome.runtime.id}`;
  const highlights=(CSS as unknown as {highlights?:Map<string,unknown>}).highlights;
  const HighlightClass=(globalThis as any).Highlight;
  const style=document.createElement('style');style.dataset.easyLearn='';
  style.textContent=`::highlight(${highlightName}){background-color:#ffe08acc;color:#173c31;text-decoration:underline solid #b17700 2px;text-underline-offset:3px}`;
  function status() {
    if(!active)return;
    const works=[...new Set(targets.map(t=>t.work))];
    const ready=works.filter(w=>w.state==='ready').length, skipped=works.filter(w=>w.state==='skipped').length;
    const failures=works.filter(w=>w.state==='failed');
    const remaining=works.filter(w=>w.state==='pending').length;
    const phase=settingsError||networkPaused?'已暂停，查看详情':localOnly?'离线模式 · 仅显示已准备的本地释义':dirty?'正在扫描正文':userPaused?'已暂停':works.some(w=>w.state==='loading')?'正在生成解释':remaining?'正在准备整页注释':'当前内容已处理';
    statusNode.textContent='阅读注释';
    progress.textContent=`本地识别 ${works.length} · 已解释 ${ready} · 已过滤 ${skipped} · 未完成 ${failures.length} · API ${batchCount} 批${usageKnown?` · ${tokenCount} tokens`:''} · ${phase}`;
    statusNode.title=`已准备 ${annotations.filter(a=>!a.part).length} 条注释。悬停下划线即可阅读。`;
    diagnostic.textContent=[settingsError,...new Set(failures.map(w=>w.error))].filter(Boolean).join('\n');
  }
  function rebuild() {
    const next:Annotation[]=[];const valid=new Map<Block,boolean>();
    for(const {block,work,offset} of targets){
      if(work.state!=='ready'||!work.concept)continue;
      if(!valid.has(block))valid.set(block,matchesSnapshot(block));if(!valid.get(block))continue;
      const concept=work.concept;
      if(mastered.some(m=>m.key===conceptKey(profile.domain,concept.meaning)))continue;
      const start=(block.offset??0)+offset;
      const range=locateText(block.element,concept.anchor,start);if(!range)continue;
      let cursor=0;
      for(const part of concept.parts??[]){
        const index=concept.anchor.indexOf(part.text,cursor);if(index<0)continue;
        const partRange=locateText(block.element,part.text,start+index);if(partRange)next.push({range:partRange,concept,block,part});cursor=index+part.text.length;
      }
      next.push({range,concept,block});
    }
    annotations=next;
    if(highlights&&HighlightClass)highlights.set(highlightName,new HighlightClass(...next.map(a=>a.range)));
    if(shown&&!matchesSnapshot(shown.block))hideTip();status();
  }
  function sendContext(){try{connection?.port.postMessage({type:'CONTEXT',payload:payload??null});}catch{/* worker gone */}}
  function openPanel(next?:Payload){hideTip();payload=next;if(!frame){frame=document.createElement('iframe');frame.src=chrome.runtime.getURL('panel.html');frame.title='Easy Learn 学习面板';frame.className='panel';shadow.append(frame);}else sendContext();}
  function hideTip(){clearTimeout(hoverTimer);shown=undefined;if(tip)tip.hidden=true;}
  function node(tag:string,text:string){const el=document.createElement(tag);el.textContent=text;return el;}
  function showTip(item:Annotation,x:number,y:number){
    if(shown===item && !tip.hidden)return;
    shown=item;tip.replaceChildren();
    const header=node('div','');header.className='tip-header';header.append(node('strong',item.part?.text??item.concept.anchor));
    const close=node('button','×') as HTMLButtonElement;close.setAttribute('aria-label','关闭注释');close.onclick=hideTip;header.append(close);tip.append(header);
    const label=node('small',item.concept.meaning);tip.append(label);
    tip.append(node('p',item.part?.explanation??item.concept.summary!));
    if(!item.part&&(item.concept.parts?.length??0)>0){const list=document.createElement('dl');for(const part of item.concept.parts!){list.append(node('dt',part.text),node('dd',part.explanation));}tip.append(list);}
    if(item.concept.ambiguity)tip.append(node('p',`语境尚不确定：${item.concept.ambiguity}`));
    if(!item.part&&item.concept.evidence){const evidence=node('small',item.concept.evidence);tip.append(evidence);}
    const more=node('button','深入理解 / 翻译') as HTMLButtonElement;more.className='more';more.onclick=()=>openPanel({context:contextFor(item.block,blocks),expandedContext:contextFor(item.block,blocks,true),concept:item.concept,mode:'explain'});tip.append(more);
    const understood=node('button','我懂了，不再显示') as HTMLButtonElement;
    understood.onclick=async()=>{understood.disabled=true;try{const entry=await rpc<Mastered>('MASTER',{concept:item.concept});mastered=[...mastered.filter(m=>m.key!==entry.key),entry];hideTip();rebuild();}catch(e){understood.disabled=false;tip.append(node('p',(e as Error).message));}};
    tip.append(understood);
    // No fetch, RPC or analysis is allowed here: every displayed byte is preloaded.
    const articleStyle=getComputedStyle(item.block.element);tip.style.fontFamily=articleStyle.fontFamily;
    tip.hidden=false;tip.style.left=`${Math.max(8,Math.min(innerWidth-370,x))}px`;tip.style.top=`${Math.max(8,y+14)}px`;
    const rect=tip.getBoundingClientRect();if(rect.bottom>innerHeight-8)tip.style.top=`${Math.max(8,y-rect.height-12)}px`;
  }
  function hovered(event:MouseEvent){
    clearTimeout(hoverTimer);
    if(event.composedPath().includes(host))return;
    if(window.getSelection()?.toString().trim()){hideTip();return;}
    const item=annotations.find(a=>matchesSnapshot(a.block)&&[...a.range.getClientRects()].some(r=>event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom));
    if(item)showTip(item,event.clientX,event.clientY);else hoverTimer=window.setTimeout(hideTip,180);
  }
  async function settings(){try{const data=await rpc<{profile:Profile;mastered:Mastered[];codeAnnotations?:boolean;localOnly?:boolean}>('PUBLIC_SETTINGS');localOnly=data.localOnly===true;profile=data.profile;mastered=data.mastered;codeAnnotations=data.codeAnnotations===true;if(codeToggle)codeToggle.checked=codeAnnotations;if(domainInput)domainInput.value=profile.domain;if(levelSelect)levelSelect.value=profile.level;settingsError='';}catch(e){settingsError=(e as Error).message;}status();}
  function refreshBlocks(){
    if(!toolbar.isConnected){const article=document.querySelector('article,main,[role="main"]')??document.body;article.prepend(toolbar);}
    blocks=extractBlocks();const next:Target[]=[];
    for(const block of blocks){
      if(block.kind==='code'&&!codeAnnotations)continue;
      const local=block.kind==='command'?explainCommand(block.text):null;
      const candidates=local?[{anchor:block.text,start:0,kind:'command' as const,heading:block.heading.slice(0,120),context:block.text.slice(0,420)}]:findCandidates(block);
      for(const c of candidates){
        const identity=candidateKey(c,JSON.stringify(profile));let work=workByKey.get(identity);
        if(!work){const immediate=local?.[0]??localExplanation(c,profile);work={candidate:{id:`c${nextId++}`,anchor:c.anchor.slice(0,300),kind:c.kind,heading:c.heading,context:c.context},state:immediate?'ready':'pending',concept:immediate};workByKey.set(identity,work);}
        next.push({block,work,offset:c.start});
      }
    }
    targets=next;
    // Bound removed-node cache while retaining current-page repeats.
    if(workByKey.size>2000){const live=new Set(targets.map(t=>t.work));for(const [k,w] of workByKey)if(!live.has(w))workByKey.delete(k);}
    if(observed){const live=new Set(blocks.map(b=>b.element));for(const el of observedNodes)if(!live.has(el)){observed.unobserve(el);observedNodes.delete(el);}for(const el of live)if(!observedNodes.has(el)){observed.observe(el);observedNodes.add(el);}}
    dirty=false;rebuild();
  }
  function orderedTargets(){const positions=new Map<HTMLElement,number>();for(const t of targets)if(!positions.has(t.block.element))positions.set(t.block.element,Math.abs(t.block.element.getBoundingClientRect().top));return [...targets].sort((a,b)=>positions.get(a.block.element)!-positions.get(b.block.element)!);}
  async function scan(){
    if(!active)return;if(running){rescan=true;return;}running=true;rescan=false;const current=generation;
    try{
      if(dirty)refreshBlocks();
      const ordered=orderedTargets();
      const lane=async()=>{while(active&&current===generation&&!networkPaused&&!settingsError&&!userPaused&&!localOnly){
        const pending=[...new Set(ordered.map(t=>t.work))].filter(w=>w.state==='pending');
        const batch=packCandidates(pending);if(!batch.length)break;
        batch.forEach(w=>w.state='loading');batchCount++;status();
        try{
          const data=await rpc<{concepts:Concept[];skipped?:string[];missing?:string[];__usage?:number|null;__cached?:boolean}>('AI',{request:{operation:'analyze',context:{title:document.title.slice(0,160),heading:'',text:'本地候选解释',before:'',after:''},candidates:batch.map(w=>w.candidate)}});
          if(!active||current!==generation)break;
          if(data.__cached)batchCount--;else if(typeof data.__usage==='number'){tokenCount+=data.__usage;usageKnown=true;}
          for(const w of batch){
            const concept=data.concepts.find(c=>c.id===w.candidate.id)||data.concepts.find(c=>!c.id&&c.anchor===w.candidate.anchor);
            if(concept?.summary){w.concept={...concept,anchor:w.candidate.anchor};w.state='ready';}
            else if(data.skipped?.includes(w.candidate.id)){w.state='skipped';}
            else{w.state='failed';w.error='此候选暂未收到有效解释，已保留其他结果；可手动重试。';}
          }
        }catch(e){
          if(!active||current!==generation)break;
          const error=(e as Error).message;
          for(const w of batch){w.state='failed';w.error=error;}
          if(/限流|额度|认证|授权|配置|先打开设置|连接已中断/.test(error))networkPaused=true;
        }
        rebuild();
      }};
      await Promise.all([lane(),lane()]);
    }finally{running=false;status();if(active&&(current!==generation||rescan))schedule();}
  }
  function schedule(){if(!active)return;if(scheduled)return;scheduled=window.setTimeout(()=>{scheduled=0;void scan();},200);}
  function onScroll(){hideTip();selectionButton.hidden=true;}
  function selection(){
    const sel=window.getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount){selectionButton.hidden=true;return;}
    const range=sel.getRangeAt(0);const parent=range.commonAncestorContainer.nodeType===Node.ELEMENT_NODE?range.commonAncestorContainer as Element:range.commonAncestorContainer.parentElement;
    if(parent?.closest('input,textarea,[contenteditable]:not([contenteditable="false"]),nav,header,footer,aside,[data-easy-learn]')){selectionButton.hidden=true;return;}
    const text=sel.toString().trim().slice(0,16000);if(!text)return;
    const block=blocks.find(b=>b.element.contains(range.commonAncestorContainer)&&b.text.includes(text));
    const base=block?contextFor(block,blocks):{title:document.title.slice(0,500),heading:'',text,before:'',after:''};
    selected={context:{...base,text},expandedContext:block?{...contextFor(block,blocks,true),text}:base,mode:'explain'};
    const rect=range.getBoundingClientRect();selectionButton.style.left=`${Math.max(8,Math.min(innerWidth-180,rect.left))}px`;selectionButton.style.top=`${Math.min(innerHeight-50,Math.max(8,rect.bottom+8))}px`;selectionButton.hidden=false;
  }
  function mount(){
    host=document.createElement('div');host.dataset.easyLearn='';shadow=host.attachShadow({mode:'open'});
    const css=node('style',`:host{all:initial;position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647;font:14px/1.6 system-ui;color:#293a34}*{box-sizing:border-box}button{font:inherit;cursor:pointer;color:inherit;background:transparent;border:0;padding:5px 7px;border-radius:5px}button:hover{background:#71877918}button:focus-visible{outline:2px solid #668c7b}.dock-sheet input:not([type=checkbox]),.dock-sheet select{font:inherit;box-sizing:border-box;border:1px solid #ccd6cf;border-radius:6px;padding:7px 9px;background:#fafcf9;color:#293a34}.dock-sheet button{display:block;margin:5px 0;text-align:left}.dock-sheet input[type=checkbox]{accent-color:#206452}.tip{z-index:2;position:fixed;width:min(350px,calc(100vw - 16px));max-height:min(440px,70vh);overflow:auto;border:1px solid #ccd6cf;border-radius:9px;background:#fffffc;color:#293a34;box-shadow:0 4px 22px #152e2224;padding:13px 15px;font:13px/1.65 system-ui}.tip-header{display:flex;align-items:start;justify-content:space-between;gap:12px}.tip strong,.tip dt{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.tip p{margin:9px 0;white-space:pre-wrap}.tip small{display:block;opacity:.68;font-size:11px}.tip dl{margin:10px 0}.tip dt{font-size:12px;margin-top:7px}.tip dd{margin:0;color:inherit;opacity:.85}.more{display:block;margin:9px 0 0 -7px;font-size:11px;text-decoration:underline}.panel{z-index:3;position:fixed;right:14px;top:14px;width:min(420px,calc(100vw - 28px));height:calc(100dvh - 28px);border:1px solid #dce4db;border-radius:12px;background:#fafbf7;box-shadow:0 12px 60px #173a3033}.selection{position:fixed;border:1px solid #ccd6cf;background:#fffffc;color:#293a34;font-size:12px;box-shadow:0 2px 10px #152e2220}[hidden]{display:none!important}@media(prefers-color-scheme:dark){.tip,.selection{background:#242c28;color:#e0e6df;border-color:#536159}}`);
    tip=document.createElement('div');tip.className='tip';tip.hidden=true;tip.setAttribute('role','dialog');tip.setAttribute('aria-label','阅读注释');tip.onmouseenter=()=>clearTimeout(hoverTimer);tip.onmouseleave=()=>{hoverTimer=window.setTimeout(hideTip,180);};
    selectionButton=node('button','解释 / 翻译所选文字') as HTMLButtonElement;selectionButton.className='selection';selectionButton.hidden=true;selectionButton.onmousedown=e=>e.preventDefault();selectionButton.onclick=()=>{if(selected)openPanel(selected);selectionButton.hidden=true;};
    const dock=document.createElement('div');dock.style.cssText='position:fixed;right:12px;top:42%;pointer-events:auto;z-index:1';
    const launcher=node('button','✦ 伴读设置') as HTMLButtonElement;launcher.style.cssText='background:#206452;color:white;border:1px solid #ffffff88;border-radius:18px;padding:9px 12px;box-shadow:0 3px 16px #173a3033';launcher.setAttribute('aria-expanded','false');
    const sheet=document.createElement('div');sheet.hidden=true;sheet.className='dock-sheet';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','伴读设置');sheet.style.cssText='width:min(290px,calc(100vw - 30px));max-height:55vh;overflow:auto;background:#fffffc;color:#293a34;border:1px solid #ccd6cf;padding:16px;border-radius:12px;box-shadow:0 5px 24px #173a3033';
    launcher.onclick=()=>{sheet.hidden=!sheet.hidden;launcher.setAttribute('aria-expanded',String(!sheet.hidden));};
    sheet.append(node('strong','伴读设置'));
    const feedback=node('p','');feedback.setAttribute('aria-live','polite');
    const codeLabel=node('label','');codeLabel.style.cssText='display:block;margin:14px 0';codeToggle=document.createElement('input');codeToggle.type='checkbox';codeLabel.append(codeToggle,document.createTextNode(' 代码注释（不含命令行）'));codeToggle.onchange=async()=>{try{await rpc('SET_CODE_ANNOTATIONS',{enabled:codeToggle.checked});await settings();refreshBlocks();schedule();feedback.textContent='设置已保存';}catch(e){feedback.textContent=(e as Error).message;}};sheet.append(codeLabel);
    const domainLabel=node('label','学习领域');domainLabel.style.display='block';domainInput=document.createElement('input');domainInput.maxLength=80;domainInput.style.cssText='display:block;width:100%;margin:5px 0 12px';domainLabel.append(domainInput);sheet.append(domainLabel);
    const levelLabel=node('label','熟悉程度');levelSelect=document.createElement('select');for(const value of ['入门','熟悉','进阶']){const option=node('option',value);levelSelect.append(option);}levelSelect.style.cssText='display:block;width:100%;margin:5px 0 12px';levelLabel.append(levelSelect);sheet.append(levelLabel);
    const saveProfile=node('button','应用学习偏好') as HTMLButtonElement;saveProfile.onclick=async()=>{try{await rpc('SET_PROFILE',{profile:{domain:domainInput.value,level:levelSelect.value}});feedback.textContent='学习偏好已应用';}catch(e){feedback.textContent=(e as Error).message;}};sheet.append(saveProfile);
    const allSettings=node('button','模型设置 / 不再显示列表') as HTMLButtonElement;allSettings.onclick=()=>void rpc('OPEN_OPTIONS');sheet.append(allSettings);
    const pause=node('button','暂停 / 继续预载') as HTMLButtonElement;pause.onclick=()=>{userPaused=!userPaused;status();if(!userPaused)schedule();};sheet.append(pause);
    sheet.append(node('p','整页自动预载；命令行保持解释。可暂停以控制 API 用量。'));sheet.append(feedback);dock.append(launcher,sheet);
    shadow.append(css,tip,selectionButton,dock);document.documentElement.append(host,style);
    // Small, in-flow entry near the article title. No fixed corner badges or alerts.
    toolbar=document.createElement('span');toolbar.dataset.easyLearn='';toolbar.style.cssText='display:block;position:sticky;top:4px;z-index:2147483646;font-family:inherit;font-size:12px;line-height:1.7;color:inherit;background:Canvas;border:1px solid #80908333;border-radius:6px;padding:6px 9px;margin:6px 0 12px';
    statusNode=node('button','阅读注释') as HTMLButtonElement;statusNode.style.cssText='font:inherit;color:inherit;background:none;border:0;border-bottom:1px dotted currentColor;cursor:pointer;padding:0';
    progress=document.createElement('span');progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');progress.style.marginLeft='10px';
    tools=document.createElement('div');tools.hidden=true;tools.style.cssText='font-size:12px;padding:8px 0';
    const actions:[string,()=>void][]=[['重试未完成项',()=>{for(const w of workByKey.values())if(w.state==='failed'){w.state='pending';w.error=undefined;}networkPaused=false;settingsError='';void settings().then(schedule);}],['暂停 / 继续',()=>{userPaused=!userPaused;status();if(!userPaused)schedule();}],['粘贴文本',()=>openPanel()],['设置',()=>void rpc('OPEN_OPTIONS')]];
    for(const [label,action] of actions){const b=node('button',label) as HTMLButtonElement;b.style.cssText='font:inherit;color:inherit;background:none;border:0;text-decoration:underline;cursor:pointer;margin-right:12px;padding:0';b.onclick=action;tools.append(b);}
    diagnostic=document.createElement('p');diagnostic.style.cssText='white-space:pre-wrap;margin:6px 0';tools.append(diagnostic);statusNode.onclick=()=>{tools.hidden=!tools.hidden;};toolbar.append(statusNode,progress,tools);
    const article=document.querySelector('article,main,[role="main"]')??document.body;const title=article.querySelector('h1');if(title)title.after(toolbar);else article.prepend(toolbar);
  }
  function keyboard(event:KeyboardEvent){if(event.key==='Escape')hideTip();else selection();}
  async function start(){
    active=true;dirty=true;generation++;mount();connection=connectSurface('content');
    connection.port.onMessage.addListener(msg=>{
      if(msg.type==='PANEL_READY')sendContext();
      if(msg.type==='CLOSE'){frame?.remove();frame=undefined;}
      if(msg.type==='REFRESH'){if(msg.invalidate!==false){generation++;workByKey.clear();networkPaused=false;}void settings().then(()=>{if(active){refreshBlocks();schedule();}});}
    });
    connection.port.onDisconnect.addListener(()=>{if(active){settingsError='扩展连接已中断，请刷新页面后重新开启伴读。';networkPaused=true;status();}});
    document.addEventListener('mousemove',hovered);document.addEventListener('mouseup',selection);document.addEventListener('keyup',keyboard);
    window.addEventListener('scroll',onScroll,{passive:true,capture:true});window.addEventListener('resize',onScroll);

    observer=new MutationObserver(records=>{if(records.every(r=>(r.target instanceof Element?r.target:r.target.parentElement)?.closest('[data-easy-learn]')))return;dirty=true;hideTip();schedule();});
    observer.observe(document.body,{childList:true,characterData:true,subtree:true});
    await settings();if(active){refreshBlocks();void scan();}
  }
  function stop(){
    active=false;generation++;clearTimeout(scheduled);clearTimeout(hoverTimer);observer?.disconnect();observed?.disconnect();observed=undefined;observedNodes.clear();
    try{connection?.port.postMessage({type:'STOP'});}catch{/* closed */}connection?.disconnect();connection=undefined;
    host?.remove();toolbar?.remove();style.remove();frame?.remove();frame=undefined;payload=undefined;selected=undefined;shown=undefined;highlights?.delete(highlightName);workByKey.clear();targets=[];annotations=[];blocks=[];scheduled=0;batchCount=0;tokenCount=0;usageKnown=false;userPaused=false;networkPaused=false;settingsError='';
    document.removeEventListener('mousemove',hovered);document.removeEventListener('mouseup',selection);document.removeEventListener('keyup',keyboard);window.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',onScroll);
  }
  state.__easyLearn={toggle(){if(active)stop();else void start();}};void start();
}
