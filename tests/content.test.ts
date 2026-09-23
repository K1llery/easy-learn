import { beforeEach, afterEach, it, expect, vi } from 'vitest';
let request: ReturnType<typeof vi.fn>;
const rect={left:20,right:320,top:50,bottom:70,width:300,height:20,x:20,y:50,toJSON(){return {};}};
const concept={anchor:'API',category:'缩写',meaning:'应用程序编程接口',expansion:'Application Programming Interface',summary:'程序之间约定好的交流方式。',evidence:'',ambiguity:'',parts:[]};
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();
  request=vi.fn(async(msg:any)=>msg.type==='PUBLIC_SETTINGS'?{ok:true,data:{profile:{domain:'软件开发',level:'入门'},mastered:[]}}:{ok:true,data:{concepts:[concept]}});
  const port={postMessage:vi.fn(),disconnect:vi.fn(),onDisconnect:{addListener:vi.fn()},onMessage:{addListener:vi.fn()}};
  vi.stubGlobal('chrome',{runtime:{id:'test',getURL:(p:string)=>`chrome-extension://test/${p}`,sendMessage:request,connect:()=>port}});
  vi.stubGlobal('CSS',{highlights:new Map()});vi.stubGlobal('Highlight',class {ranges:Range[];constructor(...ranges:Range[]){this.ranges=ranges;}});
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(rect);
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[rect]});
  Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>rect});
  window.getSelection()?.removeAllRanges();
});
afterEach(()=>{
  (globalThis as any).__easyLearn?.toggle();delete (globalThis as any).__easyLearn;
  document.body.replaceChildren();vi.useRealTimers();vi.unstubAllGlobals();
});
function hover(){document.dispatchEvent(new MouseEvent('mousemove',{clientX:25,clientY:60,bubbles:true}));}
it('renders locally preloaded command tokens immediately on hover without a model call',async()=>{
  document.body.innerHTML='<article><h1>Install</h1><pre><code>uv init awesome-project --bare</code></pre></article>';
  await import('../src/content/index');await vi.advanceTimersByTimeAsync(300);
  const calls=request.mock.calls.length;hover();
  const tip=document.querySelector('[data-easy-learn]')!.shadowRoot?.querySelector<HTMLElement>('.tip') ?? document.querySelector('div[data-easy-learn]')!.shadowRoot!.querySelector<HTMLElement>('.tip')!;
  expect(tip.hidden).toBe(false);expect(tip.textContent).toContain('uv：管理 Python');expect(request.mock.calls.length).toBe(calls);
  expect(request.mock.calls.filter(([m])=>m.type==='AI')).toHaveLength(0);
  expect(document.querySelector('div[data-easy-learn]')!.shadowRoot!.querySelector('.badge')).toBeNull();
});
it('preloads explanations before marking and hover never requests them again',async()=>{
  document.body.innerHTML='<article><h1>Interfaces</h1><p>An API connects independent applications through a contract.</p></article>';
  await import('../src/content/index');await vi.advanceTimersByTimeAsync(300);
  const count=request.mock.calls.length;hover();
  const tip=document.querySelector('div[data-easy-learn]')!.shadowRoot!.querySelector<HTMLElement>('.tip')!;
  expect(tip.hidden).toBe(false);expect(tip.textContent).toContain('程序之间约定的调用方式');expect(request.mock.calls.length).toBe(count);
  window.dispatchEvent(new Event('scroll'));await vi.advanceTimersByTimeAsync(300);expect(request.mock.calls.length).toBe(count);
});
it('shows the specific command option under the pointer and preserves source code',async()=>{
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:function(this:Range){return [{...rect,left:20+this.startOffset*7,right:20+this.endOffset*7}];}});
  document.body.innerHTML='<article><pre><code>uv init awesome-project --bare</code></pre></article>';
  const original=document.querySelector('pre')!.innerHTML;
  await import('../src/content/index');await vi.advanceTimersByTimeAsync(300);
  const count=request.mock.calls.length;
  document.dispatchEvent(new MouseEvent('mousemove',{clientX:20+24*7,clientY:60,bubbles:true}));
  const tip=document.querySelector('div[data-easy-learn]')!.shadowRoot!.querySelector<HTMLElement>('.tip')!;
  expect(tip.textContent).toContain('--bare');expect(tip.textContent).toContain('pyproject.toml');
  expect(request.mock.calls.length).toBe(count);expect(document.querySelector('pre')!.innerHTML).toBe(original);
});
it('preloads code-line fragments and serves them on hover without another request',async()=>{
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:function(this:Range){return [{...rect,left:20+this.startOffset*7,right:20+this.endOffset*7}];}});
  request.mockImplementation(async(msg:any)=>msg.type==='PUBLIC_SETTINGS'?{ok:true,data:{profile:{domain:'软件开发',level:'入门'},mastered:[],codeAnnotations:true}}:{ok:true,data:{concepts:[{anchor:'app = FastAPI()',category:'代码',meaning:'创建应用',summary:'创建 FastAPI 应用，并保存到 app 变量。',expansion:'',evidence:'',ambiguity:'',parts:[{text:'app',explanation:'保存应用对象的变量名称。'},{text:'=',explanation:'把右边的值赋给左边的变量。'},{text:'FastAPI()',explanation:'调用 FastAPI 创建应用对象。'}]}]}});
  document.body.innerHTML='<article><pre><code>app = FastAPI()</code></pre></article>';
  await import('../src/content/index');await vi.advanceTimersByTimeAsync(300);const count=request.mock.calls.length;
  document.dispatchEvent(new MouseEvent('mousemove',{clientX:50,clientY:60,bubbles:true}));
  const tip=document.querySelector('div[data-easy-learn]')!.shadowRoot!.querySelector<HTMLElement>('.tip')!;
  expect(tip.textContent).toContain('赋给');expect(request.mock.calls.length).toBe(count);
});

it('leaves code disabled by default while still explaining shell commands',async()=>{
 document.body.innerHTML='<article><pre><code>app = FastAPI()\n# Create the project\nuv init example --bare</code></pre></article>';
 await import('../src/content/index');await vi.advanceTimersByTimeAsync(300);
 expect(request.mock.calls.filter(([m])=>m.type==='AI')).toHaveLength(0);
 const root=document.querySelector('div[data-easy-learn]')!.shadowRoot!;
 expect(root.querySelector<HTMLInputElement>('input[aria-label="代码注释（不含命令行）"]')!.checked).toBe(false);
 hover();expect(root.querySelector('.tip')!.textContent).toContain('uv');
});

it('emphasizes only the first repeated occurrence and keeps later occurrences quietly hoverable',async()=>{
 document.body.innerHTML='<article><h1>HTTP API guide</h1><p>An API links one service to another API.</p></article>';
 await import('../src/content/index');await vi.advanceTimersByTimeAsync(300);
 const registry=(globalThis.CSS as any).highlights as Map<string,{ranges:Range[]}>;
 const primary=registry.get('easy-learn-test-primary'),repeat=registry.get('easy-learn-test-repeat');
 expect(primary?.ranges.map(range=>range.toString())).toEqual(['API']);
 expect(repeat?.ranges.map(range=>range.toString())).toEqual(['API']);
 const count=request.mock.calls.filter(([msg])=>msg.type==='AI').length;hover();expect(request.mock.calls.filter(([msg])=>msg.type==='AI')).toHaveLength(count);
});
