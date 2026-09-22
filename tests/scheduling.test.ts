import {it,expect} from 'vitest';
import { Queue } from '../src/core/session';
import { readingPriority } from '../src/content/reading-order';
it('starts an interactive request before queued background work without exceeding two slots',async()=>{
 const queue=new Queue(),order:string[]=[];let a!:()=>void,b!:()=>void;
 const first=queue.run(()=>new Promise<void>(r=>{a=r;})),second=queue.run(()=>new Promise<void>(r=>{b=r;}));
 const background=queue.run(async()=>{order.push('background');});
 const interactive=queue.run(async()=>{order.push('interactive');},100);
 a();await first;await interactive;b();await Promise.all([second,background]);
 expect(order).toEqual(['interactive','background']);
});
it('prioritizes a partially visible paragraph, then forward text, and reorders after a chapter jump',()=>{
 const blocks=[{id:'previous',top:-800,bottom:-600},{id:'current',top:-100,bottom:100},{id:'next',top:800,bottom:1000},{id:'far',top:6000,bottom:6200}];
 const ordered=(scroll:number)=>[...blocks].sort((a,b)=>readingPriority(a.top-scroll,a.bottom-scroll,700)-readingPriority(b.top-scroll,b.bottom-scroll,700)).map(b=>b.id);
 expect(ordered(0)).toEqual(['current','next','far','previous']);
 expect(ordered(5900)[0]).toBe('far');
});
