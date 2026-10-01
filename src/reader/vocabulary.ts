import type { Candidate, Concept } from '../core/types';
import type { ReadingSection } from './document';
import { findAbbreviations, isOutsideCommonVocabulary, vocabularyForms } from '../content/candidates';
export type WordStatus = 'learning' | 'known';
export type WordRecord = {word:string;language:string;status:WordStatus;meaning?:string;summary?:string;expansion?:string;ambiguity?:string};
export type ReadingWord = Candidate & {start:number;end:number;sectionId:string;key:string;page?:number};
export function wordKey(word:string, language:string) { return `${language.toLowerCase()}:${word.normalize('NFKC').toLocaleLowerCase(language)}`; }
export function scanVocabulary(section:ReadingSection, language:string, common:Set<string>, known:Set<string>, max=6, frequency?:ReadonlyMap<string,number>):ReadingWord[] {
  const words: ReadingWord[] = [], seen = new Set<string>();
  const knownWords = new Set([...known].filter(k=>k.startsWith(language.toLowerCase()+':')).map(k=>k.slice(k.indexOf(':')+1)));
  const abbreviations=new Map(findAbbreviations(section.title+'\n'+section.text).filter(c=>c.start>section.title.length).map(c=>[c.start-section.title.length-1,c.anchor]));
  const segmenter = new Intl.Segmenter(language, {granularity:'word'});
  for (const token of segmenter.segment(section.text)) {
    if (!token.isWordLike || !/\p{L}/u.test(token.segment) || token.segment.length > 60) continue;
    const word = token.segment, key = wordKey(word,language);
    if (known.has(key) || seen.has(key)) continue;
    const abbreviation=abbreviations.get(token.index)===word;
    if (language.startsWith('en') && !abbreviation && (word.length < 4 || !/^[a-z]+$/i.test(word) || /^[A-Z]+$/.test(word) || (!isOutsideCommonVocabulary(word,common) || !isOutsideCommonVocabulary(word,knownWords)))) continue;
    // Keep title-case vocabulary; capitalisation alone does not establish a proper name.
    seen.add(key);
    words.push({id:`c${words.length}`,anchor:word,kind:abbreviation?'abbreviation':'vocabulary',heading:section.title.slice(0,120),context:section.text.slice(Math.max(0,token.index-120), token.index+word.length+200).slice(0,420),start:token.index,end:token.index+word.length,sectionId:section.id,key,page:section.pageSpans?.find(p=>token.index>=p.start&&token.index<p.end)?.page});
  }
  if(language.startsWith('en')&&frequency){
    const rank=(w:ReadingWord)=>Math.min(...[...vocabularyForms(w.anchor)].map(f=>frequency.get(f)??frequency.size+1));
    words.sort((a,b)=>rank(b)-rank(a)||b.anchor.length-a.anchor.length||a.start-b.start);
  }
  return words.slice(0,Math.max(0,max));
}
export function wordOccurrences(text:string, words:ReadingWord[], language:string) {
  const byKey = new Map(words.map(w => [w.key,w]));
  return Array.from(new Intl.Segmenter(language,{granularity:'word'}).segment(text)).flatMap(token => {
    const word = token.isWordLike ? byKey.get(wordKey(token.segment,language)) : undefined;
    return word ? [{word,start:token.index,end:token.index+token.segment.length}] : [];
  });
}
export function exportVocabulary(records:WordRecord[]):string {
  // Anki can import tab-separated UTF-8 text; no plugin or account required.
  const clean=(s:string)=>s.replace(/[\t\r\n]+/g,' ').replace(/[<>]/g,'');
  return records.filter(r=>r.status==='learning').map(r=>[r.word,r.meaning??'',[r.expansion,r.summary,r.ambiguity].filter(Boolean).join(' · '),r.language].map(clean).join('\t')).join('\n');
}
export function recordWord(word:ReadingWord,language:string,status:WordStatus,concept?:Concept):WordRecord {
  return {word:word.anchor,language,status,meaning:concept?.meaning,summary:concept?.summary,expansion:concept?.expansion,ambiguity:concept?.ambiguity};
}
