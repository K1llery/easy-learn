import type { Block } from './document';
import type { Candidate } from '../core/types';

// Combine article topic, technical typography and explicit definition cues.
// Ordinary title case alone is never sufficient evidence of a concept.
const TECHNICAL = /\b(?:dependency injection|virtual environments?|type hints?|type annotations?|asynchronous|coroutines?|namespaces?|middleware|serialization|deserialization|idempotency|polymorphism|backpropagation|gradient descent|self-attention|attention mechanism|encoder-decoder|recurrent neural networks?|convolutional neural networks?|neural networks?|batch normalization|positional encoding|language model|context manager|garbage collection|race condition|deadlock|event loop|regular expressions?|hash tables?|load balanc(?:er|ing)|reverse proxy|distributed systems?|disaster recovery|daily run)\b/gi;
const ACRONYMS = /\b[A-Z][A-Z0-9]{1,9}s?\b/g;
const ECOSYSTEM = /\b(?:Pydantic|Starlette|Uvicorn|OpenAPI|Swagger(?: UI)?|JSON Schema|SQLAlchemy|pytest|OAuth2?|WebSockets?|BaseModel|APIRouter|CORS|request bod(?:y|ies)|path parameters?|query parameters?|status codes?|endpoints?|decorators?)\b/gi;
const METHODS=/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gi;
const TECH_CONTEXT=/\b(?:FastAPI|Pydantic|HTTP|API|Python|server|framework|protocol|authentication|database|compiler|neural|model|training|algorithm|library|package|function|endpoint|request)\b/i;
const WEB_CONTEXT=/\b(?:FastAPI|HTTP|REST|OpenAPI|web server|web framework|request method|path operation)\b/i;
export type CandidateEnvironment={technical:boolean;web:boolean;nearby?:string;unknownVocabulary?:boolean;commonWords?:ReadonlySet<string>};
export function candidateEnvironment(blocks:Block[],title=''):CandidateEnvironment{
 const sample=title+' '+blocks.slice(0,50).map(b=>b.heading+' '+b.text.slice(0,300)).join(' ');
 return {technical:TECH_CONTEXT.test(sample),web:WEB_CONTEXT.test(sample)};
}
const KNOWN_ACRONYMS = new Set('AI ML DR DB OS IP UI IO API HTTP HTTPS REST RPC JSON XML HTML CSS SQL CLI SDK CPU GPU RAM URL URI DNS TCP UDP TLS SSL SSH JWT OAuth ORM CRUD ASGI WSGI MVC MVT OOP IDE LLM NLP RNN CNN RAG CUDA SIMD UTF ASCII YAML TOML PEP'.split(' '));
const IGNORE = new Set(['THE','AND','FOR','NOT','TODO','NOTE','IMPORTANT','WARNING','INFO','ERROR','DEBUG','README','LICENSE','CONTRIBUTING','INSTALL','GETTING','STARTED','TRUE','FALSE','NULL','NONE','RELEASE','CHANGES','FAQ','TIP','VS','ALL','YOU','NEED','WMT2014','GREAT','NEWS','AVAILABLE','SOON','DEFAULT','GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','SET','READ','WRITE','OK']);
const COMMON = new Set(['python','fastapi','installation','example','examples','project','projects','name','value','data','code','usage','features','performance','documentation','test','tests','run','install','true','false','none','null','main','app','return','def','import']);
export type LocalCandidate = Omit<Candidate,'id'> & { start:number };
export function isOutsideCommonVocabulary(word:string,commonWords:ReadonlySet<string>):boolean {
  const value=word.toLowerCase();if(commonWords.has(value))return false;
  const forms=new Set<string>();
  if(value.endsWith('ies')&&value.length>5)forms.add(value.slice(0,-3)+'y');
  if(value.endsWith('es')&&value.length>5)forms.add(value.slice(0,-2));
  if(value.endsWith('s')&&!/(ss|us|is|ous)$/.test(value)&&value.length>4)forms.add(value.slice(0,-1));
  if(value.endsWith('ied')&&value.length>5)forms.add(value.slice(0,-3)+'y');
  if(value.endsWith('ed')&&value.length>5){const stem=value.slice(0,-2);forms.add(stem);forms.add(stem+'e');if(/([b-df-hj-np-tv-z])\1$/.test(stem))forms.add(stem.slice(0,-1));}
  if(value.endsWith('ing')&&value.length>6){const stem=value.slice(0,-3);forms.add(stem);forms.add(stem+'e');if(/([b-df-hj-np-tv-z])\1$/.test(stem))forms.add(stem.slice(0,-1));}
  return ![...forms].some(form=>commonWords.has(form));
}
function snippet(text:string,start:number,length:number) {
  const left=Math.max(0,start-120),right=Math.min(text.length,start+length+200);
  return text.slice(left,right).slice(0,420);
}
export function findCandidates(block:Block,environment:CandidateEnvironment=candidateEnvironment([block])):LocalCandidate[] {
  const found:LocalCandidate[]=[];
  const technical=environment.technical||TECH_CONTEXT.test(block.text+' '+block.heading),web=environment.web||WEB_CONTEXT.test(block.text+' '+block.heading);
  const inlineTerms=new Set([...block.element.querySelectorAll('code')].map(el=>el.textContent?.trim()??''));
  function add(anchor:string,start:number,kind:Candidate['kind'],method=false) {
    if(!anchor.trim()||anchor.length>300||(!method&&IGNORE.has(anchor))||COMMON.has(anchor.toLowerCase()))return;
    if(found.some(c=>c.anchor.toLowerCase()===anchor.toLowerCase()))return;
    if(found.some(c=>start<c.start+c.anchor.length&&start+anchor.length>c.start))return;
    found.push({anchor,start,kind,heading:block.heading.slice(0,120),context:snippet(block.text,start,anchor.length)+(block.text.length<120&&environment.nearby?'\n'+environment.nearby.slice(0,250):'')});
  }
  if(block.kind==='command'){add(block.text,0,'command');return found;}
  if(block.kind==='code') {
    let offset=0;for(const line of block.text.split('\n')) {
      const trimmed=line.trim();
      if(trimmed&&(/[=(){}[\].:;+*/<>]|\b(?:import|from|return|raise|yield|await|break|continue|pass)\b/.test(trimmed))&&!/^(?:#|\/\/|\/\*|\*|[{}\]\);,]+$)/.test(trimmed))add(trimmed,offset+line.indexOf(trimmed),'code');
      offset+=line.length+1;
    }
    return found.slice(0,8);
  }
  for(const match of block.text.matchAll(TECHNICAL))add(match[0],match.index!,'term');
  for(const match of block.text.matchAll(ECOSYSTEM))add(match[0],match.index!,'term');
  for(const match of block.text.matchAll(METHODS)){
    const anchor=match[0], before=block.text.slice(Math.max(0,match.index!-25),match.index!), after=block.text.slice(match.index!+anchor.length,match.index!+anchor.length+30);
    const explicit=/\b(?:HTTP|method|request|operation)\s+["'`]?$/i.test(before)||/^["'`]?\s+(?:request|method|operation)\b/i.test(after);
    if(web&&(anchor===anchor.toUpperCase()||inlineTerms.has(anchor)||explicit))add(anchor,match.index!,'term',true);
  }
  // Known initialisms are case tolerant on technical pages (http, json, asgi).
  if(technical)for(const match of block.text.matchAll(new RegExp('\\b(?:'+[...KNOWN_ACRONYMS].join('|')+')s?\\b','gi')))add(match[0],match.index!,'abbreviation');
  for(const match of block.text.matchAll(ACRONYMS)){
    const anchor=match[0], nearby=block.text.slice(Math.max(0,match.index!-100),match.index!+anchor.length+100);
    // Unknown capitals alone are not evidence of a technical concept.
    if(technical||KNOWN_ACRONYMS.has(anchor.replace(/s$/,''))||nearby.includes(`(${anchor})`)||new RegExp(`${anchor}\\s+(?:stands for|means|is short for)\\b`,'i').test(nearby))add(anchor,match.index!,'abbreviation');
  }
  // Unlisted library names are candidates when the sentence describes their role.
  for(const match of block.text.matchAll(/\b([A-Z][A-Za-z0-9_-]{2,40})\s+(?:is|provides|implements)\s+(?:(?:a|an|the)\s+)?(?:[\w-]+\s+){0,3}(?:library|framework|validator|protocol|serializer|database|toolkit|package)\b/g))add(match[1],match.index!,'term');
  for(const inline of block.element.querySelectorAll('code,a,strong,em')) {
    const text=inline.textContent?.trim()??'';
    // Only shaped identifiers, filenames, or explicit commands; not arbitrary inline words.
    if(/^[\w./:-]{3,80}$/.test(text)&&(/[_.:/]|[a-z][A-Z]/.test(text)||(technical&&inline.matches('code,a')&&/\b(?:library|package|framework|install|validator|serializer|import)\b/i.test(block.text))))add(text,block.text.indexOf(text),'term');
  }
  let extraVocabulary=false;
  if(environment.unknownVocabulary&&environment.commonWords) {
    for(const match of block.text.matchAll(/\b[a-z][a-z'-]{4,23}\b/gi)) {
      const anchor=match[0],start=match.index!;
      if(/[A-Z]/.test(anchor)||!isOutsideCommonVocabulary(anchor,environment.commonWords))continue;
      const before=block.text.slice(Math.max(0,start-1),start),after=block.text.slice(start+anchor.length,start+anchor.length+1);
      if(/[A-Za-z0-9_]/.test(before)||/[A-Za-z0-9_]/.test(after))continue;
      const previousCount=found.length;add(anchor,start,'vocabulary');
      if(found.length>previousCount){extraVocabulary=true;break;}
    }
  }
  return found.filter(c=>c.start>=0).sort((a,b)=>a.start-b.start).slice(0,extraVocabulary?7:6);
}
export function candidateKey(c:LocalCandidate,profileKey:string) {
  // Context retained for ambiguous abbreviations. No blind global acronym reuse.
  return JSON.stringify([profileKey,c.kind,c.anchor.toLowerCase(),c.heading,c.context]);
}
export function packCandidates<T extends { candidate:Candidate }>(pending:T[],limit=8):T[] {
  const batch:T[]=[];let chars=0;
  for(const item of pending) {
    const size=JSON.stringify(item.candidate).length;
    if(batch.length>=limit||chars+size>5000)break;
    chars+=size;batch.push(item);
  }
  return batch;
}
