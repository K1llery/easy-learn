import type { AIRequest, Concept, Candidate } from './types';
import { analyzeSchema, explainSchema, quizSchema, choiceQuizSchema, pageQuizSchema, evaluationSchema } from './types';
const text=(v:unknown,max=1200)=>typeof v==='string'?v.trim().slice(0,max):'';
function jsonValues(raw:string):unknown[] {
  const clean=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return [JSON.parse(clean)];}catch{/* Allow prose surrounding fenced JSON. */}
  const values:unknown[]=[];
  // Extract balanced objects/arrays without executing or guessing truncated JSON.
  for(let start=0;start<clean.length;start++) {
    if(clean[start]!=='{'&&clean[start]!=='[')continue;
    let depth=0,inString=false,escape=false;
    for(let i=start;i<clean.length;i++) {
      const ch=clean[i];
      if(inString){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')inString=false;continue;}
      if(ch==='"'){inString=true;continue;}
      if(ch==='{'||ch==='[')depth++;if(ch==='}'||ch===']')depth--;
      if(depth===0){try{values.push(JSON.parse(clean.slice(start,i+1)));start=i;}catch{}break;}
    }
  }
  return values;
}
function normalizeConcept(row:any,candidate?:Candidate):Concept|null {
  if(!row||typeof row!=='object'||row.skip===true||row.relevant===false)return null;
  const summary=text(row.summary??row.explanation??row.description??row.definition);
  const anchor=candidate?.anchor??text(row.anchor??row.term,500);
  if(!summary||!anchor)return null;
  const kind=candidate?.kind;
  const expansion=text(row.expansion,300);
  const ambiguity=text(row.ambiguity,1500)||(kind==='abbreviation'&&!expansion?'未提供英文全称，需结合更多上下文确认。':'');
  const parts=Array.isArray(row.parts)?row.parts.flatMap((p:any)=>{const t=text(p?.text,300),e=text(p?.explanation??p?.description,600);return t&&e&&anchor.includes(t)?[{text:t,explanation:e}]:[];}).slice(0,16):[];
  return {anchor,id:candidate?.id,category:kind==='command'?'命令':kind==='code'?'代码':kind==='abbreviation'?'缩写':kind==='vocabulary'?'词汇':['缩写','术语','词汇','背景','命令','代码'].includes(row.category)?row.category:'术语',meaning:text(row.meaning,300)||anchor,summary,expansion,evidence:text(row.evidence,1500),ambiguity,parts};
}
export function parseModelOutput(operation:AIRequest['operation'],raw:string,request?:AIRequest) {
  const values=jsonValues(raw);const root:any=values[0];
  if(operation==='analyze') {
    const candidates=request?.candidates;
    let rows:any[]=Array.isArray(root)?root:Array.isArray(root?.items)?root.items:Array.isArray(root?.concepts)?root.concepts:Array.isArray(root?.results)?root.results:root?.id||root?.anchor?[root]:[];
    if(values.length>1&&values.every((v:any)=>v?.id||v?.anchor))rows=values as any[];
    // Keyed maps {"c0":"..."} and numbered plain-text explanations are common.
    if(!rows.length&&root&&typeof root==='object')rows=Object.entries(root).filter(([key])=>/^c\d+$/.test(key)).map(([id,v]:[string,any])=>typeof v==='string'?{id,summary:v}:{...v,id});
    if(!rows.length&&!values.length&&candidates) {
      rows=raw.split(/\n(?=\s*(?:[-*]\s*)?c\d+\b)/).map(line=>{const match=line.trim().match(/^(?:[-*]\s*)?(c\d+)\s*[:：.)-]\s*([\s\S]+)$/);return match?{id:match[1],summary:match[2]}:null;}).filter(Boolean);
      if(!rows.length&&candidates.length===1&&!/[{}\[\]]/.test(raw))rows=[{id:candidates[0].id,summary:raw}];
    }
    const concepts:Concept[]=[],skipped:string[]=[];const seen=new Set<string>();
    for(const row of rows) {
      const candidate=candidates?.find(c=>c.id===row?.id)??candidates?.find(c=>c.anchor===row?.anchor||c.anchor===row?.term);
      if(candidates&&!candidate)continue;
      if(candidate&&seen.has(candidate.id))continue;
      if(candidate&&(row.skip===true||row.relevant===false)){skipped.push(candidate.id);seen.add(candidate.id);continue;}
      const concept=normalizeConcept(row,candidate);if(concept){concepts.push(concept);if(candidate)seen.add(candidate.id);}
    }
    if(!candidates){if(!values.length||(rows.length&&!concepts.length))throw new Error('无法读取分析结果');return analyzeSchema.parse({concepts:concepts.slice(0,12)});}
    if(!concepts.length&&!skipped.length)throw new Error('未能读取这批候选的解释，未自动重试或再次扣费。可手动重试。');
    return {concepts,skipped,missing:candidates.filter(c=>!seen.has(c.id)).map(c=>c.id)};
  }
  const plain=raw.trim().replace(/^```(?:\w+)?\s*/,'').replace(/\s*```$/,'');
  if(operation==='explain') {
    const obj=root&&typeof root==='object'?root:{};
    const explanation=text(obj.explanation??obj.summary??obj.answer??obj.translation,6000)||(!root&&!/^[{\[]/.test(plain)?text(plain,6000):'');
    return explainSchema.parse({meaning:text(obj.meaning,2000),expansion:text(obj.expansion,500),evidence:text(obj.evidence,2000),ambiguity:text(obj.ambiguity,2000),explanation,example:text(obj.example,2000),prerequisites:Array.isArray(obj.prerequisites)?obj.prerequisites.filter((p:any)=>typeof p?.term==='string'&&typeof p?.explanation==='string').slice(0,5).map((p:any)=>({term:text(p.term,200),explanation:text(p.explanation,2000)})):[],translation:text(obj.translation,10000)||(request?.mode==='translate'?explanation:'')});
  }
  if(operation==='choice')return choiceQuizSchema.parse({question:text(root?.question,1200),options:Array.isArray(root?.options)?root.options.map((option:any)=>({id:option?.id,text:text(option?.text,500)})):[],correctOption:root?.correctOption,explanation:text(root?.explanation,1500),evidence:text(root?.evidence,500)});
  if(operation==='pageQuiz') {
    const rows:any[]=Array.isArray(root?.questions)?root.questions:Array.isArray(root)?root:[];
    return pageQuizSchema.parse({questions:rows.map((row:any)=>({question:text(row?.question,1200),options:Array.isArray(row?.options)?row.options.map((option:any)=>({id:option?.id,text:text(option?.text,500)})):[],correctOption:row?.correctOption,explanation:text(row?.explanation,1500),evidence:text(row?.evidence,500)}))});
  }
  if(operation==='quiz')return quizSchema.parse({question:text(root?.question,2000),application:text(root?.application,2000)});
  return evaluationSchema.parse({correct:text(root?.correct,3000),gaps:text(root?.gaps,3000),reference:text(root?.reference??root?.feedback,4000),evidence:text(root?.evidence,500)});
}
