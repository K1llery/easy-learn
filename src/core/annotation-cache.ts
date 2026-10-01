import { conceptSchema, endpoint, type Candidate, type Concept, type Config } from './types';

type Entry={key:string;at:number;concept:Concept};
type Storage={get(key:string):Promise<Record<string,any>>;set(value:Record<string,unknown>):Promise<void>};
const STORE='annotationCacheV1',TTL=30*24*60*60*1000;
/** Only term results persist. Context is hashed, never stored as a readable cache key. */
export class AnnotationCache {
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private storage:Storage){}
  private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn);this.tail=next.catch(()=>undefined);return next;}
  async key(config:Config,title:string,candidate:Candidate){
    if(!['term','abbreviation','vocabulary'].includes(candidate.kind)||candidate.anchor.length>80)return null;
    const {id,...context}=candidate;
    const data=JSON.stringify(['short-explanation-v1',endpoint(config.baseUrl).href,config.model,config.profile,config.style,config.tuning,title,context]);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
    return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  }
  private async entries(){
    const data=(await this.storage.get(STORE))[STORE];
    return (Array.isArray(data)?data:[]).filter((e:any)=>typeof e?.key==='string'&&typeof e.at==='number'&&Date.now()-e.at<TTL&&e.at<=Date.now()&&conceptSchema.safeParse(e.concept).success) as Entry[];
  }
  get(keys:(string|null)[]){return this.serial(async()=>{const entries=await this.entries();return keys.map(key=>entries.find(e=>e.key===key)?.concept);});}
  put(values:{key:string;concept:Concept}[],valid:()=>boolean=()=>true){return this.serial(async()=>{
    if(!valid())return;
    const entries=await this.entries();
    for(const value of values){if(!value.concept.summary)continue;const index=entries.findIndex(e=>e.key===value.key);if(index>=0)entries.splice(index,1);const {id,...concept}=value.concept;entries.push({...value,concept,at:Date.now()});}
    while(entries.length>500||JSON.stringify(entries).length>500000)entries.shift();
    if(valid())await this.storage.set({[STORE]:entries});
  });}
  clear(){return this.serial(()=>this.storage.set({[STORE]:[]}));}
}
