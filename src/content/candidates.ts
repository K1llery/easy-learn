import type { Block } from './document';
import type { Candidate } from '../core/types';

// Conservative, inspectable local rules. Ordinary English nouns and title case
// are intentionally not candidates; selection remains available for omissions.
const TECHNICAL = /\b(?:dependency injection|virtual environments?|type hints?|type annotations?|asynchronous|coroutines?|namespaces?|middleware|serialization|deserialization|idempotency|polymorphism|backpropagation|gradient descent|self-attention|attention mechanism|encoder-decoder|recurrent neural networks?|convolutional neural networks?|neural networks?|batch normalization|positional encoding|language model|context manager|garbage collection|race condition|deadlock|event loop|regular expressions?|hash tables?|load balanc(?:er|ing)|reverse proxy|distributed systems?|disaster recovery|daily run)\b/gi;
const ACRONYMS = /\b(?:[A-Z][A-Z0-9]{2,9}s?|AI|ML|DR|DB|OS|IP|UI|IO)\b/g;
const KNOWN_ACRONYMS = new Set('AI ML DR DB OS IP UI IO API HTTP HTTPS REST RPC JSON XML HTML CSS SQL CLI SDK CPU GPU RAM URL URI DNS TCP UDP TLS SSL SSH JWT OAuth ORM CRUD ASGI WSGI MVC MVT OOP IDE LLM NLP RNN CNN RAG CUDA SIMD UTF ASCII YAML TOML PEP'.split(' '));
const IGNORE = new Set(['THE','AND','FOR','NOT','TODO','NOTE','IMPORTANT','WARNING','INFO','ERROR','DEBUG','README','LICENSE','CONTRIBUTING','INSTALL','GETTING','STARTED','TRUE','FALSE','NULL','NONE','RELEASE','CHANGES','FAQ','TIP','VS','ALL','YOU','NEED','WMT2014','GET','POST','PUT','PATCH','DELETE','SET','READ','WRITE','OK']);
const COMMON = new Set(['python','fastapi','installation','example','examples','project','projects','name','value','data','code','usage','features','performance','documentation','test','tests','run','install','true','false','none','null','main','app','return','def','import']);
export type LocalCandidate = Omit<Candidate,'id'> & { start:number };
function snippet(text:string,start:number,length:number) {
  const left=Math.max(0,start-120),right=Math.min(text.length,start+length+200);
  return text.slice(left,right).slice(0,420);
}
export function findCandidates(block:Block):LocalCandidate[] {
  const found:LocalCandidate[]=[];
  function add(anchor:string,start:number,kind:Candidate['kind']) {
    if(!anchor.trim()||anchor.length>300||IGNORE.has(anchor)||COMMON.has(anchor.toLowerCase()))return;
    if(found.some(c=>start<c.start+c.anchor.length&&start+anchor.length>c.start))return;
    found.push({anchor,start,kind,heading:block.heading.slice(0,120),context:snippet(block.text,start,anchor.length)});
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
  for(const match of block.text.matchAll(ACRONYMS)){
    const anchor=match[0], nearby=block.text.slice(Math.max(0,match.index!-100),match.index!+anchor.length+100);
    // Unknown capitals alone are not evidence of a technical concept.
    if(KNOWN_ACRONYMS.has(anchor.replace(/s$/,''))||nearby.includes(`(${anchor})`)||new RegExp(`${anchor}\\s+(?:stands for|means|is short for)\\b`,'i').test(nearby))add(anchor,match.index!,'abbreviation');
  }
  for(const inline of block.element.querySelectorAll('code')) {
    const text=inline.textContent?.trim()??'';
    // Only shaped identifiers, filenames, or explicit commands; not arbitrary inline words.
    if(/^[\w./:-]{3,80}$/.test(text)&&/[_.:/]|[a-z][A-Z]/.test(text))add(text,block.text.indexOf(text),'term');
  }
  return found.filter(c=>c.start>=0).sort((a,b)=>a.start-b.start).slice(0,2);
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
