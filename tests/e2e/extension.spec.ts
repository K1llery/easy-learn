import { test, expect, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir, cp, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
let server: Server, context: BrowserContext, worker: Worker, id: string, base: string, temp: string;
let calls: any[] = [];
let responseStatus = 200, inFlight=0,peakInFlight=0,completed=0;
let responseStyle='json',responseDelay=0;
function output(request: any) {
  const text = request.context?.text ?? '';
  if(request.candidates)return {items:request.candidates.map((c:any)=>({id:c.id,meaning:c.context.includes('daily run')?'每日运行':c.anchor==='API'?'应用程序编程接口':'灾难恢复',summary:'按当前语境解释：'+(c.context.includes('daily run')?'每日运行':c.anchor==='API'?'应用程序编程接口':'灾难恢复')}))};
  const concept = (anchor: string, meaning: string, expansion: string) => ({anchor,category:'缩写',meaning,expansion,evidence:'来自当前段落的用途描述。',ambiguity:'',summary:'按当前语境解释：'+meaning,parts:[]});
  if(request.operation === 'analyze') return {concepts: text.includes('DR') ? [concept('DR',text.includes('daily run') ? '每日运行' : '灾难恢复',text.includes('daily run') ? 'Daily Run' : 'Disaster Recovery')] : text.includes('API') ? [concept('API','应用程序编程接口','Application Programming Interface')] : []};
  if(request.operation === 'quiz') return {question:'为什么灾难恢复还需要异地副本？'};
  if(request.operation === 'evaluate') return {correct:'你理解了需要恢复服务。',gaps:'还需要说明单一区域故障时，本地副本可能一起不可用。',reference:'异地副本让另一个区域在主区域不可用时接管。'};
  return {meaning:request.concept?.meaning ?? '灾难恢复',expansion:request.concept?.expansion ?? 'Disaster Recovery',evidence:'原文提到 regional failure。',ambiguity:'',explanation:request.mode === 'followup' ? '普通备份保存数据；灾难恢复还包括切换服务与恢复流程。' : '灾难恢复让系统在整个区域不可用时，仍能从其他区域恢复服务。',example:'主机房断电时，备用机房继续提供服务。',prerequisites:[{term:'副本',explanation:'保存在另一处的数据拷贝。'}],translation:request.mode === 'translate' ? '使用灾难恢复（DR）应对区域故障。不要关闭复制。至少保留 3 个副本。' : ''};
}
async function rpc(type: string, fields: Record<string, unknown> = {}) { return worker.evaluate(async ({type,fields}) => { return chrome.runtime.sendMessage({type,...fields}); }, {type,fields}); }
async function inject(page: Page) { await worker.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(t=>t.url?.split('#')[0]===url.split('#')[0]); if(!tab)throw new Error('Fixture tab missing'); await chrome.scripting.executeScript({target:{tabId:tab.id!},files:['content.js']}); }, page.url()); }
test.beforeAll(async () => {
  server = createServer(async (req,res) => {
    if(req.url === '/v1/chat/completions') {
      let body=''; for await(const chunk of req) body+=chunk;
      const input = JSON.parse(body); const request=JSON.parse(input.messages[1].content); calls.push(request);
      inFlight++;peakInFlight=Math.max(peakInFlight,inFlight);
      if(responseDelay)await new Promise(r=>setTimeout(r,responseDelay));
      inFlight--;completed++;
      res.writeHead(responseStatus,{'Content-Type':'application/json'});
      res.end(responseStatus===200 ? JSON.stringify({choices:[{message:{content:responseStyle==='numbered'&&request.candidates?request.candidates.map((c:any)=>`${c.id}: 为这个技术概念预载的中文解释。`).join('\n'):JSON.stringify(output(request))}}]}) : '{}'); return;
    }
    res.writeHead(200,{'Content-Type':'text/html'}); res.end(await readFile('tests/fixtures/article.html'));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
  await mkdir('.cache',{recursive:true}); temp = await mkdtemp(path.resolve('.cache/e2e-'));
  const extension=path.join(temp,'extension'); await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
  // Fixture-only host grant lets tests trigger injection without automating browser toolbar UI.
  manifest.host_permissions=['http://127.0.0.1/*']; await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',executablePath:process.env.EASY_LEARN_CHROMIUM,headless:process.env.EASY_LEARN_HEADED!=='1',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1360,height:1000}});
  worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); id=new URL(worker.url()).host;
});
test.beforeEach(async () => {
  responseStatus=200;responseStyle='json';responseDelay=0;
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
  await settings.evaluate(async base => { await chrome.runtime.sendMessage({type:'SET_LOCAL_ONLY',enabled:false}); await chrome.runtime.sendMessage({type:'SET_CODE_ANNOTATIONS',enabled:false}); await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',config:{baseUrl:base+'/v1',model:'fixture-model',apiKey:'fixture-key',profile:{domain:'软件开发',level:'入门'}}}); },base);
  await settings.close();
});
test.afterEach(async ({},info)=>{
 if(info.status!==info.expectedStatus){
  const snapshots=[];
  for(const page of context.pages())await page.screenshot({path:'test-results/failure-'+context.pages().indexOf(page)+'.png'});
  for(const page of context.pages())for(const frame of page.frames())snapshots.push({url:frame.url(),text:await frame.locator('body').innerText().catch(()=>'<closed>')});
  await writeFile('test-results/browser-state.json',JSON.stringify({calls:calls.slice(-8),snapshots},null,2));
  await info.attach('browser-state',{body:JSON.stringify({calls:calls.slice(-8),snapshots},null,2),contentType:'application/json'});
 }
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(resolve => server?.close(()=>resolve())); if(temp) await rm(temp,{recursive:true,force:true}); });

test('complete reading, translation, followup and hiding flow in a real extension', async () => {
  const settings=await context.newPage(); await settings.goto(`chrome-extension://${id}/options.html`);
  await settings.getByLabel('API Base URL').fill(`${base}/v1`); await settings.getByLabel('模型名称').fill('fixture-model'); await settings.getByLabel('API Key',{exact:true}).fill('fixture-key');
  await settings.getByRole('button',{name:'保存并授权'}).click(); await expect(settings.getByRole('status')).toContainText('设置已保存');
  await settings.getByRole('button',{name:'测试已保存的连接'}).click(); await expect(settings.getByRole('status')).toContainText('连接成功');
  const page=await context.newPage(); await page.goto(`${base}/article`); const original=await page.locator('article').innerHTML();
  await inject(page); await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 [1-9]/);
  expect(await page.locator('article').evaluate(el=>{const copy=el.cloneNode(true) as Element;copy.querySelectorAll('[data-easy-learn]').forEach(n=>n.remove());return copy.innerHTML;})).toBe(original);
  // Content script cannot read the API key via local extension storage.
  const access = await worker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({url});
    return chrome.scripting.executeScript({target:{tabId:tab.id!},func:async()=>{try {await chrome.storage.local.get('config');return 'exposed';}catch{return 'blocked';}}});
  },page.url()); expect(access[0].result).toBe('blocked');
  await expect.poll(()=>page.getByRole('status').innerText()).toContain('当前内容已处理');
  const callsBeforeHover=calls.length;
  await page.locator('#dr').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toContainText('按当前语境解释：灾难恢复');
  expect(calls.length).toBe(callsBeforeHover);
  await page.getByRole('button',{name:'深入理解 / 翻译'}).click(); const panel=page.frameLocator('iframe[title="Easy Learn 学习面板"]');
  await expect(panel.getByRole('heading',{name:'灾难恢复',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'翻译这一段',exact:true}).click(); await expect(panel.getByLabel('段落翻译')).toContainText('不要关闭复制。至少保留 3 个副本');
  await expect(panel.getByRole('button',{name:'检查理解'})).toHaveCount(0);
  await panel.getByLabel('还有哪里没弄明白？').fill('它和普通备份有什么区别？'); /* Exercise keyboard submission: Chromium's synthetic pointer can hit the outer iframe after inner scrolling. */ await panel.getByRole('button',{name:'继续追问'}).press('Enter'); await expect(panel.getByText('普通备份保存数据；灾难恢复还包括切换服务与恢复流程。')).toBeVisible();
  await panel.getByRole('button',{name:'我懂了，不再显示',exact:true}).click(); await expect(panel.getByRole('button',{name:'恢复显示'})).toBeVisible(); await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 [1-9]/);
  await panel.getByRole('button',{name:'恢复显示'}).click(); await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 [1-9]/);
  await page.screenshot({path:'test-results/reading-panel.png',caret:'initial'});
  await panel.getByRole('button',{name:'关闭学习面板'}).click(); await expect(page.locator('iframe')).toHaveCount(0);
  await page.locator('a').click(); expect(page.url()).toContain('#next');
  await inject(page); await expect(page.locator('[data-easy-learn]')).toHaveCount(0); expect(await page.locator('article').innerHTML()).toBe(original);
  await page.close(); await settings.close();
});

test('dynamic context invalidation, selection, pasted text, and recoverable model failure', async () => {
  const page=await context.newPage(); await page.goto(`${base}/article?dynamic=1`); await inject(page);
  await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 [1-9]/);
  const before=calls.length;
  await page.locator('#recovery').evaluate(el=>{el.textContent='DR is the daily run job. Here DR stands for daily run and begins at 08:00.';});
  await expect.poll(()=>calls.slice(before).some(c=>c.candidates?.some((x:any)=>x.context.includes('begins at 08:00')))).toBe(true);
  await page.locator('#api').evaluate(el=>{const selection=window.getSelection()!;const range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup'));});
  await page.getByRole('button',{name:'解释 / 翻译所选文字'}).click(); const panel=page.frameLocator('iframe[title="Easy Learn 学习面板"]');
  await expect(panel.getByRole('heading',{name:'理解这一段'})).toBeVisible(); await expect(panel.getByLabel('概念解释')).toBeVisible();
  await panel.getByRole('button',{name:'新文本',exact:true}).click(); await panel.getByLabel('粘贴想理解的内容').fill('A different text with enough context to exercise the model failure boundary.');
  responseStatus=429; await panel.getByRole('button',{name:'帮我理解'}).click(); await expect(panel.getByRole('alert')).toContainText('限流');
  responseStatus=200;responseStyle='json';responseDelay=0; await panel.getByRole('button',{name:'重试',exact:true}).click(); await expect(panel.getByLabel('概念解释')).toBeVisible();
  await page.close();
});

test('scrolls through repeated content and real reference excerpts without charging for repeat hovers',async()=>{
 const page=await context.newPage();await page.goto(`${base}/long`);
 const refs=await Promise.all(['python-classes','fastapi-readme','attention-paper'].map(async name=>JSON.parse(await readFile(`tests/fixtures/references/${name}.json`,'utf8'))));
 await page.evaluate(refs=>{
  document.body.innerHTML='<article><h1>Reading references</h1><div id="scroller" style="height:650px;overflow:auto"></div></article>';
  const container=document.querySelector('#scroller')!;
  for(let i=0;i<40;i++){const p=document.createElement('p');p.style.marginBottom='160px';p.innerHTML=`An <span id="term${i}">API</span> connects applications through a contract.`;container.append(p);}
  for(const [i,ref] of refs.entries()){const p=document.createElement('p');p.id=`ref${i}`;p.textContent=ref.text;container.append(p);}
 },refs);
 const start=calls.length;await inject(page);
 await expect.poll(()=>calls.slice(start).filter(c=>c.operation==='analyze').length).toBe(1);
 await page.locator('#term0').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toBeVisible();
 await page.locator('#term35').scrollIntoViewIfNeeded();await page.locator('#term35').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toBeVisible();
 expect(calls.slice(start).filter(c=>c.operation==='analyze')).toHaveLength(1);
 await page.locator('#ref2').scrollIntoViewIfNeeded();
 await expect.poll(()=>calls.slice(start).flatMap(c=>c.candidates??[]).some(c=>c.context.includes('attention')||c.context.includes('recurrent'))).toBe(true);
 await expect(page.getByRole('status')).toContainText('未完成 0');
 await page.screenshot({path:'test-results/reference-scroll.png'});await page.close();
});

test('preloads the entire document without scrolling or stopping after eight batches',async()=>{
 const page=await context.newPage();await page.goto(`${base}/whole-page`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Whole page</h1>'+Array.from({length:80},(_,i)=>`<p style="margin:150px 0">The DR connects applications in scenario number ${i}.</p>`).join('')+'</article>';});
 const start=calls.length;await inject(page);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(calls.slice(start).filter(c=>c.operation==='analyze')).toHaveLength(10);
 expect(await page.evaluate(()=>window.scrollY)).toBe(0);
 expect(calls.slice(start).flatMap(c=>c.candidates??[]).some(c=>c.context.includes('number 79'))).toBe(true);
 await page.close();
});

test('ordinary documentation words produce no marks and no model requests',async()=>{
 const page=await context.newPage();await page.goto(`${base}/ordinary`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Getting Started</h1><p>IMPORTANT: Read the Documentation for Installation, Examples and Performance. This project supports Python and FastAPI. <code>app</code> <code>name</code></p><pre>DO NOT ANALYZE THIS CODE BLOCK</pre></article>';});
 const start=calls.length;await inject(page);await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(calls.slice(start)).toHaveLength(0);await expect(page.getByRole('status')).toContainText('本地识别 0');await page.close();
});

test('shows ongoing progress and accepts numbered plain text without a paid repair',async()=>{
 responseStyle='numbered';responseDelay=500;
 const page=await context.newPage();await page.goto(`${base}/numbered`);const start=calls.length;await inject(page);
 await expect(page.getByRole('status')).toContainText('正在生成解释');
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(calls.slice(start)).toHaveLength(1);
 await page.locator('#dr').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toContainText('为这个技术概念预载的中文解释。');
 await page.screenshot({path:'test-results/preloaded-hover.png'});await page.close();
});

test('side settings toggle code independently of commands and remember the choice',async()=>{
 const page=await context.newPage();await page.goto(`${base}/code-toggle`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Code and commands</h1><pre><code>app = FastAPI()</code></pre><pre><code>uv init awesome-project --bare</code></pre></article>';});
 const start=calls.length;await inject(page);await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(calls.slice(start)).toHaveLength(0);
 await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 1 /);
 await page.getByRole('button',{name:'✦ 伴读设置',exact:true}).click();
 const dock=page.getByRole('dialog',{name:'伴读设置',exact:true});const checkbox=dock.getByRole('checkbox',{name:'代码注释（不含命令行）'});
 await expect(checkbox).not.toBeChecked();await checkbox.check();
 await expect.poll(()=>calls.slice(start).flatMap(c=>c.candidates??[]).some(c=>c.kind==='code')).toBe(true);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 const count=calls.length;await checkbox.uncheck();await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 1 /);
 await checkbox.check();await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 2 /);expect(calls.length).toBe(count);
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);await expect(settings.getByRole('checkbox',{name:'代码注释（不含命令行）'})).toBeChecked();
 await page.screenshot({path:'test-results/side-settings.png',caret:'initial'});await settings.close();await page.close();
});

test('hides an annotation directly from the tooltip and restores it from settings',async()=>{
 const page=await context.newPage();await page.goto(`${base}/hide`);await inject(page);await expect(page.getByRole('status')).toContainText('当前内容已处理');
 const count=calls.length;await page.locator('#dr').hover();await page.getByRole('button',{name:'我懂了，不再显示',exact:true}).click();await expect(page.getByRole('dialog',{name:'阅读注释'})).toBeHidden();
 await page.locator('#dr').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toBeHidden();
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);await expect(settings.getByRole('heading',{name:'不再显示的注解'})).toBeVisible();await settings.getByRole('button',{name:'恢复显示'}).click();await expect(settings.getByRole('button',{name:'恢复显示'})).toHaveCount(0);
 await page.bringToFront();await page.locator('#dr').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toBeVisible();expect(calls.length).toBe(count);
 await page.screenshot({path:'test-results/highlight-and-hide.png',caret:'initial'});await settings.close();await page.close();
});

test('500 paragraphs get instant local marks with zero API requests',async()=>{
 const page=await context.newPage();await page.goto(`${base}/local-speed`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Local glossary benchmark</h1>'+Array.from({length:500},(_,i)=>`<p>The API exchanges JSON data for this application number ${i}.</p>`).join('')+'</article>';});
 const count=calls.length,start=Date.now();await inject(page);
 await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 1000 /);
 const elapsedMs=Date.now()-start;expect(calls.length).toBe(count);
 await writeFile('test-results/local-speed.json',JSON.stringify({paragraphs:500,annotations:1000,elapsedMs,apiRequests:0}));
 await page.close();
});

test('two remote batches run concurrently and local marks appear before either returns',async()=>{
 responseDelay=300;peakInFlight=0;const initialCompleted=completed;
 const page=await context.newPage();await page.goto(`${base}/parallel-speed`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Concurrent benchmark</h1><p>The API exchanges JSON data with independent services.</p>'+Array.from({length:48},(_,i)=>`<p>DR means the recovery strategy in scenario number ${i}.</p>`).join('')+'</article>';});
 await page.evaluate(()=>{(window as any).__completedAt=0;const observer=new MutationObserver(()=>{if(document.querySelector('[role=status]')?.textContent?.includes('当前内容已处理')){(window as any).__completedAt=Date.now();observer.disconnect();}});observer.observe(document.body,{childList:true,characterData:true,subtree:true});});
 const count=calls.length,start=Date.now();await inject(page);
 await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 2 /);
 expect(completed).toBe(initialCompleted);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(peakInFlight).toBe(2);expect(calls.length-count).toBe(6);
 expect((await page.evaluate(()=>(window as any).__completedAt))-start).toBeGreaterThanOrEqual(900);
 await writeFile('test-results/parallel-speed.json',JSON.stringify({batches:6,delayPerBatchMs:300,elapsedMs:(await page.evaluate(()=>(window as any).__completedAt))-start,peakInFlight,serialDelayAloneMs:1800}));
 await page.close();
});

test('free presets clear credentials on provider changes and offline mode is usable',async()=>{
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 const count=calls.length;
 await settings.getByLabel('服务方案').selectOption('zhipu');await expect(settings.getByLabel('模型名称')).toHaveValue('glm-4.7-flash');
 await settings.getByLabel('服务方案').selectOption('groq');await expect(settings.getByLabel('API Base URL')).toHaveValue('https://api.groq.com/openai/v1');await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
 await settings.getByLabel('API Key',{exact:true}).fill('fixture-not-real');await settings.getByLabel('服务方案').selectOption('openrouter');await expect(settings.getByLabel('模型名称')).toHaveValue('openrouter/free');await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
 await settings.getByLabel('服务方案').selectOption('gemini');await expect(settings.getByLabel('模型名称')).toHaveValue('gemini-2.5-flash-lite');expect(calls.length).toBe(count);
 await settings.getByLabel('离线模式（不调用 AI）').check();
 const page=await context.newPage();await page.goto(`${base}/offline`);await inject(page);await expect(page.getByRole('status')).toContainText('离线模式');expect(calls.length).toBe(count);
 await page.locator('#api').hover({position:{x:50,y:10}});await settings.screenshot({path:'test-results/free-provider-settings.png'});
 await page.close();await settings.close();
});
