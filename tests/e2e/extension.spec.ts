import { test, expect, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir, cp, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import {paperPdf} from './pdf-fixture';
let server: Server, context: BrowserContext, worker: Worker, id: string, base: string, temp: string;
let calls: any[] = [];
let responseStatus = 200, inFlight=0,peakInFlight=0,completed=0;
let responseStyle='json',responseDelay=0;
function outlinePdf() {
  const first='BT /F1 14 Tf 72 720 Td (Introduction to this paper.) Tj ET';
  const second='BT /F1 14 Tf 72 720 Td (Methods explain the regional failure.) Tj '+Array.from({length:24},()=> '0 -18 Td (The replica remains available in another region for recovery.) Tj ').join('')+'ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /PageMode /UseOutlines >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    '<< /Type /Outlines /First 9 0 R /Last 10 0 R /Count 2 >>',
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
    '<< /Title (Introduction) /Parent 7 0 R /Next 10 0 R /Dest [3 0 R /Fit] >>',
    '<< /Title (Methods) /Parent 7 0 R /Prev 9 0 R /Dest [4 0 R /Fit] >>',
  ];
  let pdf='%PDF-1.4\n';
  const offsets=[0];
  for (const [index, body] of objects.entries()) { offsets.push(pdf.length); pdf+=`${index+1} 0 obj\n${body}\nendobj\n`; }
  const xref=pdf.length;
  pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,'ascii');
}
function output(request: any) {
  const text = request.context?.text ?? '';
  if(request.candidates)return {items:request.candidates.map((c:any)=>({id:c.id,meaning:c.context.includes('daily run')?'每日运行':c.anchor==='API'?'应用程序编程接口':'灾难恢复',summary:'按当前语境解释：'+(c.context.includes('daily run')?'每日运行':c.anchor==='API'?'应用程序编程接口':'灾难恢复')}))};
  const concept = (anchor: string, meaning: string, expansion: string) => ({anchor,category:'缩写',meaning,expansion,evidence:'来自当前段落的用途描述。',ambiguity:'',summary:'按当前语境解释：'+meaning,parts:[]});
  if(request.operation === 'analyze') return {concepts: text.includes('DR') ? [concept('DR',text.includes('daily run') ? '每日运行' : '灾难恢复',text.includes('daily run') ? 'Daily Run' : 'Disaster Recovery')] : text.includes('API') ? [concept('API','应用程序编程接口','Application Programming Interface')] : []};
  if(request.operation === 'quiz') return {question:'为什么灾难恢复还需要异地副本？',application:'为自己的服务画一张异地恢复流程图，标出故障点与接管步骤。'};
  if(request.operation === 'evaluate') return {correct:'你理解了需要恢复服务。',gaps:'还需要说明单一区域故障时，本地副本可能一起不可用。',reference:'异地副本让另一个区域在主区域不可用时接管。',evidence:request.answer?.includes('无效引文测试')?'Invented unsupported source quote.':text.includes('When a regional failure happens, the replica takes over.')?'When a regional failure happens, the replica takes over.':text.slice(0,80)};
  if(request.operation === 'choice') return {question:'根据正文，灾难恢复的关键保证是什么？',options:[{id:'A',text:'区域故障时由其他区域恢复服务'},{id:'B',text:'更快的磁盘'},{id:'C',text:'更低的存储成本'},{id:'D',text:'更多的日志'}],correctOption:'A',explanation:'原文说明区域故障时由其他区域恢复服务。'};
  if(request.operation === 'pageQuiz') return {questions:[
    {question:'灾难恢复的主要目的是什么？',options:[{id:'A',text:'在区域故障后从其他区域恢复服务'},{id:'B',text:'提高写入速度'},{id:'C',text:'减少存储成本'},{id:'D',text:'简化部署'}],correctOption:'A',explanation:'原文说明 DR 让系统在整个区域不可用时，仍能从其他区域恢复服务。',evidence:request.context.text.includes('Disaster recovery keeps')?'Disaster recovery keeps a second copy of data in another region.':'Use DR to recover from a regional failure.'},
    {question:'为什么副本不能只放在本机房？',options:[{id:'A',text:'本机房磁盘更贵'},{id:'B',text:'单一区域故障时本地副本可能一起不可用'},{id:'C',text:'副本协议限制'},{id:'D',text:'备份窗口不够'}],correctOption:'B',explanation:'正文提到区域故障时本地副本可能一起不可用。'}
  ]};
  const translation = request.context?.translationMarker
    ? request.context.text.replace(/⟦(EL\d*):(\d+)⟧([\s\S]*?)⟦\/\1:\2⟧/g,
      (_: string, marker: string, id: string, text: string) => `⟦${marker}:${id}⟧中文：${text}⟦/${marker}:${id}⟧`)
    : '使用灾难恢复（DR）应对区域故障。不要关闭复制。至少保留 3 个副本。';
  return {meaning:request.concept?.meaning ?? '灾难恢复',expansion:request.concept?.expansion ?? 'Disaster Recovery',evidence:'原文提到 regional failure。',ambiguity:'',explanation:request.mode === 'followup' ? '普通备份保存数据；灾难恢复还包括切换服务与恢复流程。' : '灾难恢复让系统在整个区域不可用时，仍能从其他区域恢复服务。',example:'主机房断电时，备用机房继续提供服务。',prerequisites:[{term:'副本',explanation:'保存在另一处的数据拷贝。'}],translation:request.mode === 'translate' ? translation : ''};
}
async function currentWorker():Promise<Worker> { const active=context.serviceWorkers()[0];if(active){worker=active;return active;}worker=await context.waitForEvent('serviceworker');return worker; }
async function rpc(type: string, fields: Record<string, unknown> = {}) { return (await currentWorker()).evaluate(async ({type,fields}) => { return chrome.runtime.sendMessage({type,...fields}); }, {type,fields}); }
async function inject(page: Page) { await (await currentWorker()).evaluate(async url => { const tab = (await chrome.tabs.query({})).find(t=>t.url?.split('#')[0]===url.split('#')[0]); if(!tab)throw new Error('Fixture tab missing'); await chrome.scripting.executeScript({target:{tabId:tab.id!},files:['content.js']}); }, page.url()); }
async function highlightedRanges(page:Page) { return (await currentWorker()).evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(t=>t.url?.split('#')[0]===url.split('#')[0]);if(!tab)return [];const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id!},func:()=>{const registry=(CSS as any).highlights as Map<string,any>|undefined;return registry?[...registry.entries()].filter(([key])=>key.endsWith('-primary')||key.endsWith('-repeat')).map(([key,value])=>({key,text:[...value].map((range:any)=>range.toString())})):[];}});return result?.result??[];},page.url()); }
test.beforeAll(async () => {
  server = createServer(async (req,res) => {
    if(req.url === '/v1/chat/completions') {
      if (req.headers.authorization !== 'Bearer fixture-key') {
        res.writeHead(401,{'Content-Type':'application/json'}); res.end('{}'); return;
      }
      let body=''; for await(const chunk of req) body+=chunk;
      const input = JSON.parse(body); const request=JSON.parse(input.messages[1].content); calls.push(request);
      inFlight++;peakInFlight=Math.max(peakInFlight,inFlight);
      if(responseDelay)await new Promise(r=>setTimeout(r,responseDelay));
      if(responseStyle==='stream'&&request.candidates&&responseStatus===200){
        res.writeHead(200,{'Content-Type':'text/event-stream'});
        const items=output(request).items!;
        const write=(content:string)=>res.write('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');
        write('{"items":['+JSON.stringify(items[0]));
        await new Promise(r=>setTimeout(r,1600));
        write(items.slice(1).map((item:any)=>','+JSON.stringify(item)).join('')+']}');
        res.end('data: {"choices":[],"usage":{"total_tokens":80}}\n\ndata: [DONE]\n\n');
        inFlight--;completed++;return;
      }
      inFlight--;completed++;
      res.writeHead(responseStatus,{'Content-Type':'application/json'});
      const completion={choices:[{message:{content:responseStyle==='numbered'&&request.candidates?request.candidates.map((c:any)=>`${c.id}: 为这个技术概念预载的中文解释。`).join('\n'):JSON.stringify(output(request))}}]};
      res.end(responseStatus===200 ? JSON.stringify(responseStyle==='envelope'?{success:true,data:completion}:completion) : '{}'); return;
    }
    if(req.url === '/sample.pdf') { res.writeHead(200,{'Content-Type':'application/pdf'}); res.end(await readFile('tests/fixtures/sample.pdf')); return; }
    if(req.url === '/outline.pdf') { res.writeHead(200,{'Content-Type':'application/pdf'}); res.end(outlinePdf()); return; }
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
  await settings.evaluate(async base => { await chrome.storage.local.remove('learningCardsV1');await chrome.runtime.sendMessage({type:'CLEAR_ANNOTATION_CACHE'});await chrome.runtime.sendMessage({type:'SET_LOCAL_ONLY',enabled:false}); await chrome.runtime.sendMessage({type:'SET_CODE_ANNOTATIONS',enabled:false}); await chrome.runtime.sendMessage({type:'SET_ANNOTATION_TYPES',types:['abbreviation','term','command']}); await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',config:{baseUrl:base+'/v1',model:'fixture-model',apiKey:'fixture-key',profile:{domain:'软件开发',level:'入门'}}}); },base);
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
  await settings.evaluate(()=>chrome.runtime.sendMessage({type:'CLEAR_SETTINGS'}));await settings.reload();
  await expect(settings.getByLabel('服务方案')).toHaveValue('deepseek');await expect(settings.getByLabel('API Base URL')).not.toBeVisible();await expect(settings.getByLabel('API Key',{exact:true})).toBeVisible();await settings.getByLabel('服务方案').selectOption('custom');
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

test('authenticated gateway envelopes work for saved connection tests and pasted-text translation',async()=>{
  responseStyle='envelope';
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
  await settings.getByRole('button',{name:'测试已保存的连接'}).click();
  await expect(settings.getByRole('status')).toContainText('连接成功');
  const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/panel.html`);
  await panel.getByLabel('粘贴想理解的内容').fill('Use DR to recover from a regional failure. Do not disable replication. Keep at least 3 replicas.');
  await panel.getByRole('button',{name:'翻译成中文',exact:true}).click();
  await expect(panel.getByLabel('段落翻译')).toContainText('不要关闭复制。至少保留 3 个副本');
  await panel.close();await settings.close();
});

test('dynamic context invalidation, selection, pasted text, and recoverable model failure', async () => {
  const page=await context.newPage(); await page.goto(`${base}/article?dynamic=1`); await inject(page);
  await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 [1-9]/);
  const before=calls.length;
  await page.locator('#recovery').evaluate(el=>{el.textContent='DR is the daily run job. Here DR stands for daily run and begins at 08:00.';});
  await expect.poll(()=>calls.slice(before).some(c=>c.candidates?.some((x:any)=>x.context.includes('begins at 08:00')))).toBe(true);
  await page.locator('#api').evaluate(el=>{const selection=window.getSelection()!;const range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup'));});
  await page.getByRole('button',{name:'解释',exact:true}).click(); const panel=page.frameLocator('iframe[title="Easy Learn 学习面板"]');
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
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 const preparedCalls=calls.slice(start).filter(c=>c.operation==='analyze').length;expect(preparedCalls).toBeGreaterThan(0);
 await page.locator('#term0').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toBeVisible();
 await page.locator('#term35').scrollIntoViewIfNeeded();await page.locator('#term35').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toBeVisible();
 expect(calls.slice(start).filter(c=>c.operation==='analyze')).toHaveLength(preparedCalls);
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
 await page.getByRole('button',{name:'阅读注释',exact:true}).hover();
 const dock=page.getByRole('dialog',{name:'伴读设置',exact:true});await expect(dock).toBeVisible();const checkbox=dock.getByRole('checkbox',{name:'代码注释（不含命令行）'});
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

test('six remote batches run concurrently and local marks appear before either returns',async()=>{
 responseDelay=300;peakInFlight=0;const initialCompleted=completed;
 const page=await context.newPage();await page.goto(`${base}/parallel-speed`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Concurrent benchmark</h1><p>The API exchanges JSON data with independent services.</p>'+Array.from({length:48},(_,i)=>`<p>DR means the recovery strategy in scenario number ${i}.</p>`).join('')+'</article>';});
 await page.evaluate(()=>{(window as any).__completedAt=0;(window as any).__statusTrace=[];const observer=new MutationObserver(()=>{const text=document.querySelector('[role=status]')?.textContent;(window as any).__statusTrace.push({at:Date.now(),text});if(text?.includes('当前内容已处理')&&text.includes('已解释 50')){(window as any).__completedAt=Date.now();observer.disconnect();}});observer.observe(document.body,{childList:true,characterData:true,subtree:true});});
 const count=calls.length,start=performance.now();await inject(page);
 await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 2 /);
 expect(completed).toBe(initialCompleted);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(peakInFlight).toBe(6);expect(calls.length-count).toBe(6);
 await writeFile('test-results/status-timeline.json',JSON.stringify(await page.evaluate(()=>(window as any).__statusTrace)));
 const elapsedMs=performance.now()-start;expect(elapsedMs).toBeGreaterThanOrEqual(300);
 await writeFile('test-results/parallel-speed.json',JSON.stringify({batches:6,delayPerBatchMs:300,elapsedMs,peakInFlight,serialDelayAloneMs:1800}));
 await page.close();
});

test('new provider presets start without another provider key and offline mode is usable',async()=>{
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 const count=calls.length;
 await expect(settings.locator('#provider optgroup[label="订阅账户登录"] option')).toHaveCount(2);
 await expect(settings.locator('#provider optgroup[label="本机与局域网"] option')).toHaveCount(4);
 await settings.getByLabel('服务方案').selectOption('local-cpa');
 await expect(settings.getByLabel('模型名称')).toHaveValue('gpt-6-luna');
 await expect(settings.getByLabel('API Base URL')).toHaveValue('http://127.0.0.1:8317/v1');
 await expect(settings.locator('#provider optgroup[label="中国大陆服务"] option')).toHaveCount(6);
 await expect(settings.locator('#provider optgroup[label="海外 / 国际服务"] option')).toHaveCount(12);
 await settings.getByLabel('服务方案').selectOption('qwen');
 await expect(settings.getByLabel('模型名称')).toHaveValue('qwen3.8-flash');
 await expect(settings.getByLabel('API Base URL')).toHaveValue('https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
 await settings.getByLabel('模型名称').fill('custom-model');
 await settings.getByLabel('API Key',{exact:true}).fill('fixture-not-real');
 await settings.getByRole('button',{name:'保存并授权'}).click();
 await expect(settings.getByRole('alert')).toContainText('YOUR_WORKSPACE_ID');
 await settings.getByLabel('服务方案').selectOption('zhipu');await expect(settings.getByLabel('模型名称')).toHaveValue('glm-4.7-flash');
 await settings.getByLabel('服务方案').selectOption('groq');await expect(settings.getByLabel('API Base URL')).toHaveValue('https://api.groq.com/openai/v1');await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
 await settings.getByLabel('API Key',{exact:true}).fill('fixture-not-real');await settings.getByLabel('服务方案').selectOption('openrouter');await expect(settings.getByLabel('模型名称')).toHaveValue('openrouter/free');await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
 await settings.getByLabel('服务方案').selectOption('cline');await expect(settings.getByLabel('模型名称')).toHaveValue('cline-pass/deepseek-v4.1-flash');await expect(settings.getByLabel('API Base URL')).toHaveValue('https://api.cline.bot/api/v1');
 await settings.getByLabel('服务方案').selectOption('gemini');await expect(settings.getByLabel('模型名称')).toHaveValue('gemini-2.5-flash-lite');expect(calls.length).toBe(count);
 await settings.getByLabel('离线模式（不调用 AI）').check();
 const page=await context.newPage();await page.goto(`${base}/offline`);await inject(page);await expect(page.getByRole('status')).toContainText('离线模式');expect(calls.length).toBe(count);
 await page.locator('#api').hover({position:{x:50,y:10}});await settings.screenshot({path:'test-results/free-provider-settings.png'});
 await page.close();await settings.close();
});

test('provider drafts restore keys, edited addresses and models across switches and reloads',async()=>{
 await worker.evaluate(async()=>chrome.storage.local.remove('providerSettingsV1'));
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('fixture-key');
 await settings.getByLabel('服务方案').selectOption('groq');
 await settings.getByLabel('API Base URL').fill(`${base}/groq-v1`);
 await settings.getByLabel('模型名称').fill('my-groq-model');
 await settings.getByLabel('API Key',{exact:true}).fill('groq-draft-key');
 await settings.getByLabel('服务方案').selectOption('deepseek');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
 await settings.getByLabel('API Key',{exact:true}).fill('deepseek-draft-key');
 await settings.getByLabel('服务方案').selectOption('groq');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('groq-draft-key');
 await expect(settings.getByLabel('API Base URL')).toHaveValue(`${base}/groq-v1`);
 await expect(settings.getByLabel('模型名称')).toHaveValue('my-groq-model');
 expect(await settings.evaluate(async()=> (await chrome.runtime.sendMessage({type:'GET_SETTINGS'})).data.config)).toMatchObject({model:'fixture-model',apiKey:'fixture-key'});
 await settings.getByLabel('服务方案').selectOption('custom');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('fixture-key');
 await settings.getByLabel('模型名称').fill('saved-custom-model');
 await settings.getByRole('button',{name:'保存并授权'}).click();
 await expect(settings.getByRole('status')).toContainText('设置已保存');
 await settings.reload();
 await expect(settings.getByLabel('模型名称')).toHaveValue('saved-custom-model');
 await settings.getByLabel('服务方案').selectOption('groq');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('groq-draft-key');
 await settings.getByRole('button',{name:'保存并授权'}).click();
 await expect(settings.getByRole('status')).toContainText('设置已保存');
 await settings.reload();
 await expect(settings.getByLabel('服务方案')).toHaveValue('groq');
 await expect(settings.getByLabel('模型名称')).toHaveValue('my-groq-model');
 await expect(settings.getByLabel('API Base URL')).toHaveValue(`${base}/groq-v1`);
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('groq-draft-key');
 await settings.getByLabel('服务方案').selectOption('deepseek');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('deepseek-draft-key');
 await settings.getByLabel('服务方案').selectOption('chatgpt-oauth');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveCount(0);
 await settings.getByLabel('服务方案').selectOption('groq');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('groq-draft-key');
 settings.once('dialog',dialog=>dialog.accept());
 await settings.getByRole('button',{name:'清除本机数据',exact:true}).click();
 await expect(settings.getByRole('status')).toContainText('本机数据已清除');
 expect(await worker.evaluate(async()=> (await chrome.storage.local.get('providerSettingsV1')).providerSettingsV1)).toBeUndefined();
 await settings.getByLabel('服务方案').selectOption('groq');
 await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
 await expect(settings.getByLabel('模型名称')).toHaveValue('qwen/qwen3.8-27b');
 await settings.close();
});


test('FastAPI headings and short HTTP method lists have instant explanations without AI',async()=>{
 const page=await context.newPage();await page.goto(`${base}/fastapi-concepts`);
 await page.evaluate(()=>{document.title='FastAPI tutorial';document.body.innerHTML='<article><h1>FastAPI tutorial</h1><h2><span id="pydantic">Pydantic</span></h2><p>Validate input data with type annotations.</p><h2>Web requests</h2><p>The <span id="http">http</span> protocol defines request methods:</p><ul><li><code id="get">get</code></li><li><span id="post">POST</span></li></ul><p>You can get started and write a post about your project.</p><pre>def example():\n    return 42</pre></article>';});
 const count=calls.length;await inject(page);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 for(const [selector,meaning] of [['#pydantic','Python 数据校验库'],['#http','超文本传输协议'],['#get','HTTP GET 方法'],['#post','HTTP POST 方法']]){
  await page.mouse.move(1200,900);await page.locator(selector).hover();
  await expect(page.getByRole('dialog',{name:'阅读注释'})).toContainText(meaning);
 }
 expect(calls.length).toBe(count);
 await page.screenshot({path:'test-results/fastapi-concepts.png'});await page.close();
});

test('a streamed annotation is readable before its batch finishes and a reload reuses local results',async()=>{
 responseStyle='stream';const initialCompleted=completed;
 const page=await context.newPage();await page.goto(`${base}/stream-reading`);
 const setArticle=()=>page.evaluate(()=>{document.body.innerHTML='<article><h1>Streaming tutorial</h1><p><span id="dr">DR</span> restores service after a regional failure.</p><p>SLO defines a service availability objective.</p></article>';});
 await setArticle();const start=calls.length;
 await inject(page);
 await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 1 /);
 await expect.poll(async()=> (await highlightedRanges(page)).some(item=>item.key.endsWith('-primary')&&item.text.includes('DR'))).toBe(true);
 await page.locator('#dr').hover();
 await expect(page.getByRole('dialog',{name:'阅读注释'})).toContainText('灾难恢复');
 expect(completed).toBe(initialCompleted);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 const after=calls.length;expect(after).toBeGreaterThan(start);
 await page.reload();await setArticle();await inject(page);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(calls.length).toBe(after);
 await page.locator('#dr').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toContainText('灾难恢复');
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.getByRole('button',{name:'清除术语缓存',exact:true}).click();await expect(settings.getByRole('status')).toContainText('缓存已清除');
 await page.reload();await setArticle();await inject(page);await expect(page.getByRole('status')).toContainText('当前内容已处理');expect(calls.length).toBeGreaterThan(after);
 await settings.close();await page.close();
});

test('jumping ahead prioritizes the new reading position in the next available batch',async()=>{
 const settings = await context.newPage();
 await settings.goto(`chrome-extension://${id}/options.html`);
 const saved = await settings.evaluate(() => chrome.runtime.sendMessage({type: 'SET_READING_PREFS', prefs: {concurrency: 2, batchSize: 4}}));
 expect(saved.ok).toBe(true);
 await settings.close();
 responseDelay=600;const page=await context.newPage();await page.goto(`${base}/jump-reading`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Chapter jump</h1>'+Array.from({length:30},(_,i)=>`<p id="chapter-${i}" style="height:200px">DR means the recovery strategy in scenario number ${i}.</p>`).join('')+'</article>';});
 const start=calls.length;await inject(page);
 await expect.poll(()=>calls.length-start).toBe(2);
 await page.locator('#chapter-25').scrollIntoViewIfNeeded();
 await expect.poll(()=>calls.length-start).toBeGreaterThan(2);
 expect(calls[start+2].candidates.some((c:any)=>c.context.includes('number 25'))).toBe(true);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');await page.close();
});

test('toolbar action uses the popup and hover reveals persistent annotation settings',async()=>{
 const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));expect(manifest.action.default_popup).toBe('popup.html');
 const page=await context.newPage();await page.goto(`${base}/vocabulary-toggle`);
 await page.evaluate(()=>{document.body.innerHTML='<article><h1>Vocabulary toggle</h1><p>The transient scheduler reroutes requests during failover.</p></article>';});
 const start=calls.length;await inject(page);await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toBeVisible();await expect(page.getByRole('status')).toContainText('当前内容已处理');expect(calls.length).toBe(start);
 await page.getByRole('button',{name:'阅读注释',exact:true}).hover();
 const settings=page.getByRole('dialog',{name:'伴读设置',exact:true});await expect(settings).toBeVisible();
 await expect(settings.getByLabel('英文缩写')).toBeChecked();await expect(settings.getByLabel('专有名词与技术术语')).toBeChecked();await expect(settings.getByLabel('CLI 命令')).toBeChecked();await expect(settings.getByLabel('扩展词汇（试验）')).not.toBeChecked();
 await settings.getByLabel('专有名词与技术术语').uncheck();await settings.getByLabel('扩展词汇（试验）').check();
 await expect.poll(()=>calls.slice(start).flatMap(call=>call.candidates??[]).some(candidate=>candidate.kind==='vocabulary'&&candidate.anchor==='transient')).toBe(true);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 expect(calls.slice(start).flatMap(call=>call.candidates??[]).filter(candidate=>candidate.kind==='vocabulary')).toHaveLength(1);
 await page.reload();await page.evaluate(()=>{document.body.innerHTML='<article><h1>Vocabulary toggle</h1><p>The transient scheduler reroutes requests during failover.</p></article>';});await inject(page);
 await expect(page.getByRole('status')).toContainText('当前内容已处理');await page.getByRole('button',{name:'阅读注释',exact:true}).hover();
 await expect(settings.getByLabel('专有名词与技术术语')).not.toBeChecked();await expect(settings.getByLabel('扩展词汇（试验）')).toBeChecked();
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await expect(options.getByLabel('专有名词与技术术语')).not.toBeChecked();await expect(options.getByLabel('扩展词汇（常用词表外，试验）')).toBeChecked();
 await expect(options.locator('section.card').first().getByLabel('代码注释（不含命令行）')).toBeVisible();
 await options.close();await page.close();
});

test('selected text is consumed once and only that excerpt reaches the PDF reading side panel',async()=>{
 const source=await context.newPage();await source.goto(`${base}/paper-preview`);
 const tabId=await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({url}))[0];if(tab?.id===undefined)throw new Error('Source tab missing');return tab.id;},source.url());
 const excerpt='The selected paragraph describes attention as a way to route information.';
 await worker.evaluate(async ({tabId,excerpt})=>chrome.storage.session.set({[`pdfSelection:${tabId}`]:{id:'selection-test',mode:'translate',text:excerpt,title:'Attention Paper',truncated:false}}),{tabId,excerpt});
 const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html?sourceTab=${tabId}`);
 await expect(panel.getByRole('heading',{name:'翻译所选文字'})).toBeVisible();
 await expect(panel.getByLabel('段落翻译')).toContainText('使用灾难恢复（DR）应对区域故障。');
 const request=calls.at(-1);expect(request.mode).toBe('translate');expect(request.context).toEqual({title:'Attention Paper',heading:'',text:excerpt,before:'',after:''});
 await expect(panel.getByRole('button',{name:'清空当前内容'})).toBeVisible();
 await panel.getByRole('button',{name:'清空当前内容'}).click();
 await expect(panel.getByText(/在网页或 PDF 中选中文字/)).toBeVisible();
 const remaining=await worker.evaluate(async tabId=>(await chrome.storage.session.get(`pdfSelection:${tabId}`))[`pdfSelection:${tabId}`],tabId);expect(remaining).toBeUndefined();
 await panel.close();
 const explanationText='The selected sentence describes recovery across regions.';
 await worker.evaluate(async ({tabId,text})=>chrome.storage.session.set({[`pdfSelection:${tabId}`]:{id:'explain-selection-test',mode:'explain',text,title:'Recovery Paper',truncated:false}}),{tabId,text:explanationText});
 const explainPanel=await context.newPage();await explainPanel.goto(`chrome-extension://${id}/sidepanel.html?sourceTab=${tabId}`);
 await expect(explainPanel.getByRole('heading',{name:'理解这一段'})).toBeVisible();
 await expect(explainPanel.getByLabel('概念解释')).toContainText('灾难恢复让系统在整个区域不可用时，仍能从其他区域恢复服务。');
 const explainRequest=calls.at(-1);expect(explainRequest.mode).toBe('explain');expect(explainRequest.context).toEqual({title:'Recovery Paper',heading:'',text:explanationText,before:'',after:''});
 await explainPanel.close();await source.close();
});

test('opening the toolbar popup auto-injects the reader into the active article',async()=>{
 const page=await context.newPage();await page.goto(`${base}/popup-startup`);
 const popupTabId=await worker.evaluate(async()=>{const tab=await chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false});return tab.id;});
 await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('当前内容已处理');
 if(popupTabId!==undefined)await worker.evaluate(tabId=>chrome.tabs.remove(tabId),popupTabId).catch(()=>{});
 await page.close();
});

test('restricted pages keep the popup open with retry and paste-panel options',async()=>{
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/popup.html`);
 await expect(page.getByRole('heading',{name:'当前页面无法开启伴读'})).toBeVisible();
 await expect(page.getByRole('button',{name:'重试'})).toBeVisible();
 await expect(page.getByRole('button',{name:'打开粘贴文本面板'})).toBeVisible();
 await expect(page.getByText(/文本型 PDF.*扫描版 PDF.*粘贴面板/)).toBeVisible();
 await page.close();
});

test('offline documentation fixtures cover repeated terms, shell prompts, sed and common CLI commands',async()=>{
 const files=['fastapi-python-types','missing-semester-course-shell','python-cli','http-methods','noise-exclusions'];
 for(const name of files){
  const html=await readFile(`tests/fixtures/sites/${name}.html`,'utf8');
  const page=await context.newPage();await page.goto(`${base}/site-fixture/${name}`);
  await page.evaluate(markup=>{document.body.innerHTML=markup;},html);
  const start=calls.length;await inject(page);
  await expect(page.getByRole('status')).toContainText('当前内容已处理');
  const requests=calls.slice(start).filter(call=>call.operation==='analyze');
  if(name==='fastapi-python-types'){
   const registry=await highlightedRanges(page);
   expect(registry.find(item=>item.key.endsWith('-primary'))?.text.map((text:string)=>text.toLowerCase())).toContain('type hints');
   expect(registry.find(item=>item.key.endsWith('-repeat'))?.text.map((text:string)=>text.toLowerCase())).toContain('type hints');
   const beforeHover=calls.length;await page.locator('#repeat-type-hints').hover();await expect(page.getByRole('dialog',{name:'阅读注释'})).toContainText('类型提示');expect(calls.length).toBe(beforeHover);
  }
  if(name==='missing-semester-course-shell'){
   const candidates=requests.flatMap(call=>call.candidates??[]);
   expect(candidates.some(candidate=>candidate.kind==='command'&&candidate.anchor.startsWith('sed -i'))).toBe(true);
   expect(candidates.some(candidate=>candidate.kind==='command'&&candidate.anchor.startsWith('sed -n'))).toBe(true);
   expect(candidates.every(candidate=>!candidate.anchor.includes('missing:~$')&&!candidate.context.includes('\npattern/replacement/g'))).toBe(true);
  }
  if(name==='python-cli'){
   await expect(page.getByRole('button',{name:'阅读注释',exact:true})).toHaveAttribute('title',/已准备 3 条注释/);
  }
  if(name==='http-methods'){
   expect(requests.flatMap(call=>call.candidates??[]).some(candidate=>candidate.kind==='command'&&candidate.anchor.startsWith('curl -I'))).toBe(true);
  }
  if(name==='noise-exclusions'){
   const candidates=requests.flatMap(call=>call.candidates??[]);
   expect(candidates.some(candidate=>candidate.anchor==='PKCE')).toBe(true);
   expect(candidates.some(candidate=>/src\/content|README\.md|fastapi\.tiangolo|docs\.example/i.test(candidate.anchor))).toBe(false);
  }
  await page.close();
 }
});

test('practices before seeing explanations, retains failed attempts, and saves only on demand', async () => {
  const panel=await context.newPage();await panel.setViewportSize({width:410,height:1000});await panel.goto(`chrome-extension://${id}/panel.html`);
  const start=calls.length;
  const source='DR restores service after a regional failure. Copies in another region can remain available.';
  await panel.getByLabel('粘贴想理解的内容').fill(source);await panel.getByRole('button',{name:'先练再看',exact:true}).click();
  await expect(panel.getByLabel('主动练习')).toBeVisible();expect(calls.length).toBe(start);
  await expect(panel.locator('.source')).toBeHidden();await expect(panel.getByLabel('概念解释')).toHaveCount(0);
  await panel.getByLabel('这段内容，你想拿来做什么？').fill('为自己的项目设计恢复方案');
  responseStatus=429;await panel.getByRole('button',{name:'出一道练习题'}).click();await expect(panel.getByRole('alert')).toContainText('限流');
  await expect(panel.getByLabel('这段内容，你想拿来做什么？')).toHaveValue('为自己的项目设计恢复方案');expect(calls.length-start).toBe(1);
  responseStatus=200;await panel.getByRole('button',{name:'出一道练习题'}).click();
  await expect(panel.getByText('为什么灾难恢复还需要异地副本？')).toBeVisible();await expect(panel.getByLabel('练习反馈')).toHaveCount(0);await expect(panel.getByLabel('应用小任务')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'请 AI 找出理解缺口'})).toBeDisabled();
  await panel.getByLabel('我的回答',{exact:true}).fill('因为发生故障时需要恢复服务。');
  responseStatus=429;await panel.getByRole('button',{name:'请 AI 找出理解缺口'}).click();await expect(panel.getByRole('alert')).toContainText('限流');
  await expect(panel.getByLabel('我的回答',{exact:true})).toHaveValue('因为发生故障时需要恢复服务。');
  responseStatus=200;await panel.getByRole('button',{name:'请 AI 找出理解缺口'}).click();
  await expect(panel.getByLabel('练习反馈')).toContainText('本地副本可能一起不可用');await expect(panel.getByLabel('应用小任务')).toContainText('标出故障点与接管步骤');
  const sent=calls.slice(start);expect(sent.map(call=>call.operation)).toEqual(['quiz','quiz','evaluate','evaluate']);
  for(const call of sent){expect(call.context).toMatchObject({text:source,before:'',after:''});expect(call.context.section).toBeUndefined();expect(call.goal).toBe('为自己的项目设计恢复方案');}
  const readCards=()=>panel.evaluate(async()=> (await chrome.storage.local.get('learningCardsV1')).learningCardsV1??[]);
  expect(await readCards()).toEqual([]);
  await panel.screenshot({path:'test-results/active-practice.png',fullPage:true});
  await panel.getByRole('button',{name:'保存练习，明天复习'}).click();await expect(panel.getByRole('status')).toContainText('明天再回忆');
  const cards=await readCards();expect(cards).toHaveLength(1);expect(cards[0]).toMatchObject({sourceText:source,answer:'因为发生故障时需要恢复服务。',reviewCount:0});
  expect(cards[0].dueAt-cards[0].createdAt).toBe(86400000);expect(calls.length-start).toBe(4);
  await panel.getByRole('button',{name:'解释',exact:true}).click();await expect(panel.getByLabel('概念解释')).toBeVisible();expect(calls.length-start).toBe(5);expect(calls.at(-1).operation).toBe('explain');
  await panel.reload();await panel.getByRole('button',{name:'我的复习',exact:true}).click();
  await expect(panel.getByText('为自己的项目设计恢复方案',{exact:true})).toBeVisible();await panel.close();
});

async function seedPractice(panel: Page) {
  return panel.evaluate(async()=>{
    const result=await chrome.runtime.sendMessage({type:'LEARNING_SAVE',draft:{id:crypto.randomUUID(),title:'灾难恢复 · 公开测试选段',sourceText:'DR restores service after a regional failure.',goal:'设计一个可靠的恢复方案',question:'为什么需要异地副本？',application:'画一张恢复流程图，标出故障点。',answer:'为了恢复服务。',feedback:{correct:'理解了恢复服务。',gaps:'要说明故障范围。',reference:'异地副本在区域故障后仍可用。'}}});
    if(!result.ok)throw new Error(result.error);
    await chrome.storage.local.set({learningCardsV1:[{...result.data,dueAt:Date.now()-1000}]});
    return result.data;
  });
}
test('offline review hides references until an attempt, records practice, exports and deletes',async()=>{
  const panel=await context.newPage();await panel.setViewportSize({width:380,height:1000});await panel.goto(`chrome-extension://${id}/panel.html?view=review`);
  await expect(panel.getByText('先练会一个小知识点',{exact:true})).toBeVisible();await seedPractice(panel);
  await panel.evaluate(()=>chrome.runtime.sendMessage({type:'SET_LOCAL_ONLY',enabled:true}));const start=calls.length;
  await panel.getByRole('button',{name:'开始复习',exact:true}).click();
  await expect(panel.getByLabel('复习参考')).toHaveCount(0);await expect(panel.getByRole('button',{name:'写好了，对照参考'})).toBeDisabled();
  await panel.getByLabel('这次我能想起什么？').fill('本地区域故障可能影响所有本地副本。');await panel.getByRole('button',{name:'写好了，对照参考'}).click();
  await expect(panel.getByLabel('复习参考')).toContainText('异地副本在区域故障后仍可用。');await expect(panel.getByText('DR restores service after a regional failure.',{exact:true})).toBeHidden();
  await panel.getByRole('button',{name:'能独立解释 · 3 天后',exact:true}).click();await expect(panel.getByRole('status')).toContainText('已记录这次回忆');
  await panel.getByRole('button',{name:'应用记录',exact:true}).click();await panel.getByLabel('我做了什么，结果怎样？').fill('画了两地切换图，下一步做故障演练。');await panel.getByRole('button',{name:'保存实践记录'}).click();await expect(panel.getByRole('status')).toContainText('实践记录已保存');
  await panel.getByRole('button',{name:'返回复习列表'}).click();await expect(panel.getByText('今天没有到期的练习。',{exact:false})).toBeVisible();await expect(panel.getByText('已复习 1 次')).toBeVisible();
  const downloadPromise=panel.waitForEvent('download');await panel.getByRole('button',{name:'导出学习记录'}).click();const download=await downloadPromise;
  const exported=await readFile((await download.path())!,'utf8');expect(exported).toContain('画了两地切换图，下一步做故障演练。');expect(exported).toContain('本地区域故障可能影响所有本地副本。');expect(exported).not.toContain('fixture-key');
  await panel.reload();await expect(panel.getByText('已留下实践记录')).toBeVisible();
  expect(await panel.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await panel.screenshot({path:'test-results/learning-review.png',fullPage:true});
  panel.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'删除练习：为什么需要异地副本？',exact:true}).click();await expect(panel.getByText('先练会一个小知识点',{exact:true})).toBeVisible();
  expect(calls.length).toBe(start);await panel.close();
});

test('late quiz responses never replace a new text session',async()=>{
  const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/panel.html`);
  await panel.getByLabel('粘贴想理解的内容').fill('The first document discusses disaster recovery.');await panel.getByRole('button',{name:'先练再看',exact:true}).click();
  await panel.getByLabel('这段内容，你想拿来做什么？').fill('旧目标');responseDelay=700;const initialCompleted=completed;
  await panel.getByRole('button',{name:'出一道练习题'}).click();await expect(panel.getByRole('status')).toContainText('正在根据选段');
  await panel.getByRole('button',{name:'新文本',exact:true}).click();await panel.getByLabel('粘贴想理解的内容').fill('A new document discusses API design.');await panel.getByRole('button',{name:'先练再看',exact:true}).click();
  await expect.poll(()=>completed).toBeGreaterThan(initialCompleted);
  await expect(panel.getByRole('button',{name:'出一道练习题'})).toBeVisible();await expect(panel.getByLabel('这段内容，你想拿来做什么？')).toHaveValue('');await expect(panel.getByText('为什么灾难恢复还需要异地副本？')).toHaveCount(0);
  await panel.close();
});

test('whole-page quiz scans the page, grades choices in place and reports the score', async () => {
  const page=await context.newPage(); await page.goto(`${base}/article`);
  await inject(page);
  await expect(page.getByRole('status')).toContainText('当前内容已处理');
  const start=calls.length;
  await page.getByRole('button',{name:'整页测验',exact:true}).click();
  const dialog=page.getByRole('region',{name:'整页测验'});
  await expect(dialog.getByText('灾难恢复的主要目的是什么？')).toBeVisible();
  await page.getByRole('radio',{name:'在区域故障后从其他区域恢复服务'}).check();
  await expect(dialog.getByText('答对了')).toBeVisible();
  await dialog.getByRole('button',{name:'下一题'}).click();
  await expect(dialog.getByText('为什么副本不能只放在本机房？')).toBeVisible();
  await page.getByRole('radio',{name:'单一区域故障时本地副本可能一起不可用'}).check();
  await dialog.getByRole('button',{name:'查看成绩'}).click();
  await expect(dialog.locator('.elq-score')).toContainText('2 / 2');
  await expect(dialog.getByText('可以试着不用选项，自己解释一个关键概念。')).toBeVisible();
  const request=calls.at(-1); expect(request.operation).toBe('pageQuiz'); expect(request.count).toBe(5);
  expect(request.context.text).toContain('Disaster recovery');
  await page.screenshot({path:'test-results/page-quiz.png'});
  await dialog.getByRole('button',{name:'完成'}).click();
  await expect(dialog).toHaveCount(0);
  await page.close();
});

test('PDF companion extracts text, quizzes the whole document and quizzes a single page', async () => {
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/pdf.html?url=${encodeURIComponent(base+'/sample.pdf')}&title=${encodeURIComponent('Disaster Recovery Paper')}`);
  await expect(page.getByText('Disaster recovery keeps a second copy of data in another region.')).toBeVisible();
  const start=calls.length;
  await page.getByRole('button',{name:'开始抽样测验'}).click();
  const dialog=page.getByRole('region',{name:'整份 PDF 抽样测验'});
  await expect(dialog.getByText('灾难恢复的主要目的是什么？')).toBeVisible();
  await page.getByRole('radio',{name:'在区域故障后从其他区域恢复服务'}).check();
  await expect(dialog.getByText('答对了')).toBeVisible();
  const request=calls.at(-1); expect(request.operation).toBe('pageQuiz');
  expect(request.context).toMatchObject({title:'Disaster Recovery Paper'});
  await expect(dialog.getByRole('button',{name:'查看第 1 页原文'})).toBeVisible();
  await dialog.getByRole('button',{name:'查看第 1 页原文'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region',{name:'第 1 页'})).toBeVisible();
  await page.getByRole('button',{name:'考考这一页'}).click();
  await expect(page.getByLabel('选段单选题')).toBeVisible();
  await expect(page.getByRole('region',{name:'第 1 页'}).locator('.source')).toHaveCount(0);
  await expect(page.getByText('根据正文，灾难恢复的关键保证是什么？')).toBeVisible({timeout:15000});
  expect(calls.slice(start).map(call=>call.operation)).toContain('choice');
  await page.screenshot({path:'test-results/pdf-reader.png',fullPage:true});
  await page.close();
});

test('PDF companion navigates embedded bookmarks and opens the corresponding original page', async () => {
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/pdf.html?url=${encodeURIComponent(base+'/outline.pdf')}&title=${encodeURIComponent('Outline Paper')}`);
  const navigation=page.getByRole('region',{name:'PDF 导航'});
  await expect(navigation.getByText('文档自带目录 · 2 项')).toBeVisible();
  const before=calls.length;
  await navigation.getByText('文档自带目录 · 2 项').click();
  await navigation.getByRole('button',{name:'Methods · 第 2 页'}).click();
  await expect(navigation.getByLabel('跳到页码（共 2 页）')).toHaveValue('2');
  await expect(page.getByRole('region',{name:'第 2 页'})).toContainText('Methods explain the regional failure.');
  await page.getByRole('region',{name:'第 2 页'}).getByRole('button',{name:'展开本页文字'}).click();
  await expect(page.getByRole('region',{name:'第 2 页'}).getByRole('button',{name:'收起本页文字'})).toHaveAttribute('aria-expanded','true');
  const originalPromise=context.waitForEvent('page');
  await navigation.getByRole('button',{name:'在原 PDF 查看这一页'}).click();
  const original=await originalPromise;
  expect(original.url()).toBe(`${base}/outline.pdf#page=2`);
  expect(calls.length).toBe(before);
  await original.close();
  await page.close();
});

test('PDF companion reads a user-selected local file without asking for site access or sending it to AI', async () => {
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/pdf.html`);
  await page.getByLabel('URL').fill('file:///papers/example.pdf');
  await page.getByRole('button',{name:'提取网址中的 PDF'}).click();
  await expect(page.getByRole('alert')).toContainText('本机 PDF 请使用下方的文件选择入口');
  const before=calls.length;
  await page.getByLabel('或选择本机 PDF').setInputFiles('tests/fixtures/sample.pdf');
  await expect(page.getByRole('region',{name:'第 1 页'})).toContainText('When a regional failure happens');
  await expect(page.getByRole('region',{name:'PDF 导航'})).toBeVisible();
  await expect(page.getByRole('region',{name:'PDF 导航'})).toContainText('当前文档 · sample.pdf');
  await expect(page.getByRole('button',{name:'在原 PDF 查看这一页'})).toHaveCount(0);
  expect(calls.length).toBe(before);
  await page.getByLabel('URL').fill(`${base}/outline.pdf`);
  await page.getByRole('button',{name:'提取网址中的 PDF'}).click();
  await expect(page.getByRole('region',{name:'PDF 导航'})).toContainText('当前文档 · outline.pdf');
  expect(calls.length).toBe(before);
  await page.close();
});

test('PDF page drafts and quiz choices stay independent across multiple pages', async () => {
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/pdf.html?url=${encodeURIComponent(base+'/outline.pdf')}`);
  const first=page.getByRole('region',{name:'第 1 页'}), second=page.getByRole('region',{name:'第 2 页'});
  await expect(second).toContainText('Methods explain the regional failure.');
  for (const card of [first,second]) {
    await card.locator('.source').first().evaluate(element => {
      const node=element.firstChild!;
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,Math.min(30,node.textContent!.length));
      const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    });
    await card.getByRole('button',{name:'先试着理解'}).click();
  }
  await first.getByLabel('我的理解').fill('这是对第一部分的理解。');
  await second.getByText('我的理解',{exact:true}).click();
  await page.keyboard.type('这是对第二部分的理解。');
  await expect(first.getByLabel('我的理解')).toHaveValue('这是对第一部分的理解。');
  await expect(second.getByLabel('我的理解')).toHaveValue('这是对第二部分的理解。');
  for (const card of [first,second]) {
    await card.getByRole('button',{name:'考考这一页'}).click();
    await card.getByRole('radio',{name:'区域故障时由其他区域恢复服务'}).check();
  }
  await expect(first.getByRole('radio',{name:'区域故障时由其他区域恢复服务'})).toBeChecked();
  await expect(second.getByRole('radio',{name:'区域故障时由其他区域恢复服务'})).toBeChecked();
  await page.close();
});

test('PDF reader explains only the selected difficult sentence', async () => {
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/pdf.html?url=${encodeURIComponent(base+'/sample.pdf')}&title=${encodeURIComponent('Disaster Recovery Paper')}`);
  const pageCard=page.getByRole('region',{name:'第 1 页'});
  const source=pageCard.locator('.source').first();
  await expect(source).toContainText('When a regional failure happens');
  await source.evaluate(element => {
    const node=element.firstChild!;
    const text=node.textContent!;
    const start=text.indexOf('When a regional failure happens');
    const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+'When a regional failure happens, the replica takes over.'.length);
    const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  });
  await expect(pageCard.getByRole('button',{name:'解释选中内容'})).toBeVisible();
  const start=calls.length;
  await pageCard.getByRole('button',{name:'解释选中内容'}).click();
  await expect(pageCard.getByRole('region',{name:'选段解释'})).toBeVisible();
  expect(calls.slice(start).at(-1)).toMatchObject({operation:'explain',mode:'explain',context:{heading:'第 1 页',text:'When a regional failure happens, the replica takes over.',before:'',after:''}});
  await pageCard.getByRole('button',{name:'翻译选中内容'}).click();
  await expect(pageCard.getByRole('region',{name:'选段翻译'})).toBeVisible();
  expect(calls.at(-1)).toMatchObject({operation:'explain',mode:'translate',context:{text:'When a regional failure happens, the replica takes over.'}});
  await page.close();
});

test('PDF reader asks for my interpretation before requesting feedback for a selected sentence', async () => {
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/pdf.html?url=${encodeURIComponent(base+'/sample.pdf')}&title=${encodeURIComponent('Disaster Recovery Paper')}`);
  const pageCard=page.getByRole('region',{name:'第 1 页'});
  const source=pageCard.locator('.source').first();
  await expect(source).toContainText('When a regional failure happens');
  const excerpt='When a regional failure happens, the replica takes over.';
  await source.evaluate((element, excerpt) => {
    const node=element.firstChild!;
    const start=node.textContent!.indexOf(excerpt);
    const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+excerpt.length);
    const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  }, excerpt);
  const start=calls.length;
  await pageCard.getByRole('button',{name:'先试着理解'}).click();
  const check=pageCard.getByRole('region',{name:'选段理解核对'});
  await expect(check).toContainText(excerpt);
  expect(calls.length).toBe(start);
  await expect(check.getByRole('region',{name:'理解反馈'})).toHaveCount(0);
  await check.getByLabel('我的理解').fill('发生区域故障时，副本会接管。');
  expect(calls.length).toBe(start);
  await check.getByRole('button',{name:'核对我的理解'}).click();
  await expect(check.getByRole('region',{name:'理解反馈'})).toBeVisible();
  await expect(check.getByText('已在所选原文中找到这段引文')).toBeVisible();
  expect(calls.slice(start)).toHaveLength(1);
  expect(calls.at(-1)).toMatchObject({operation:'evaluate',context:{title:'Disaster Recovery Paper',heading:'第 1 页',text:excerpt,before:'',after:''},answer:'发生区域故障时，副本会接管。'});
  expect(calls.at(-1).question).toContain('对照原文');
  await pageCard.getByRole('button',{name:'清除选段'}).click();
  await expect(check).toHaveCount(0);
  await source.evaluate((element, excerpt) => {
    const node=element.firstChild!;
    const start=node.textContent!.indexOf(excerpt);
    const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+excerpt.length);
    const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  }, excerpt);
  await pageCard.getByRole('button',{name:'先试着理解'}).click();
  const secondCheck=pageCard.getByRole('region',{name:'选段理解核对'});
  await secondCheck.getByLabel('我的理解').fill('无效引文测试：这段讨论区域故障。');
  await secondCheck.getByRole('button',{name:'核对我的理解'}).click();
  await expect(secondCheck.getByText('模型给出的引文未在所选原文中找到')).toBeVisible();
  await page.close();
});

test('reads local documents in the trusted extension workbench and preloads meanings without hover calls',async()=>{
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/reader.html`);
 const text='The ephemeral lantern reveals a serendipitous discovery.';
 await page.locator('#reader-file').setInputFiles({name:'public-reader.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
 await expect(page.getByTestId('reader-prose')).toHaveText(text);const before=calls.length;
 await page.locator('.reader-word').first().hover();expect(calls.length).toBe(before);
 await page.getByRole('button',{name:'开启伴读',exact:true}).click();await expect(page.locator('.reader-word.is-ready').first()).toBeVisible();
 await expect.poll(()=>page.locator('.reader-progress').innerText()).not.toContain('正在准备');const count=calls.length;
 await page.locator('.reader-word.is-ready').first().hover();await expect(page.getByRole('complementary',{name:'词语释义'})).toContainText('按当前语境解释');expect(calls.length).toBe(count);await expect(page.getByTestId('reader-prose')).toHaveText(text);
 const refreshed=await page.evaluate(()=>chrome.runtime.sendMessage({type:'SET_READING_PREFS',prefs:{concurrency:1,batchSize:2}}));expect(refreshed.ok).toBe(true);await expect(page.getByText('阅读设置已更新，点击开启伴读继续。')).toBeVisible();await expect(page.locator('.reader-word.is-ready')).toHaveCount(0);expect(calls.length).toBe(count);await page.close();
});


test('extension workbench uses the PDF viewer for zoom and continuous page navigation without model calls',async()=>{
 const page=await context.newPage(),failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));await page.goto(`chrome-extension://${id}/reader.html`);const before=calls.length;
 await page.locator('#reader-file').setInputFiles({name:'public-controls.pdf',mimeType:'application/pdf',buffer:paperPdf()});await expect(page.getByTestId('pdf-canvas').first()).toBeVisible();await expect(page.getByRole('checkbox',{name:'连续阅读'})).toBeChecked();
 await page.getByRole('combobox',{name:'缩放模式'}).selectOption('page-actual');await expect(page.locator('.pdf-zoom-slider output')).toHaveText('100%');await page.getByRole('slider',{name:'缩放比例'}).fill('125');
 await page.getByRole('textbox',{name:'跳转页码'}).fill('2');await page.getByRole('button',{name:'跳转',exact:true}).click();await expect(page.locator('.page[data-page-number="2"] canvas').first()).toHaveAttribute('data-rendered-page','2');await expect(page.getByTestId('pdf-scroll-container')).toHaveAttribute('data-current-page','2');expect(calls.length).toBe(before);expect(failures).toEqual([]);await page.close();
});


test('extension workbench preserves selected PDF text for learning and exports native annotations',async()=>{
 const page=await context.newPage(),failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));await page.goto(`chrome-extension://${id}/reader.html`);
 await page.locator('#reader-file').setInputFiles({name:'extension-notes.pdf',mimeType:'application/pdf',buffer:paperPdf()});await page.getByRole('button',{name:'选择文字',exact:true}).click();
 const line=page.locator('.page[data-page-number="1"] .textLayer span[role="presentation"]').filter({hasText:'The ephemeral assumption'}).first();await line.scrollIntoViewIfNeeded();const box=await line.boundingBox();await page.mouse.move(box!.x+1,box!.y+box!.height/2);await page.mouse.down();await page.mouse.move(box!.x+box!.width-1,box!.y+box!.height/2,{steps:12});await page.mouse.up();
 await page.getByRole('button',{name:'解释',exact:true}).click();await expect(page.getByRole('region',{name:'选段学习'})).toContainText('灾难恢复');const input=calls.at(-1);expect(input.context.text).toContain('ephemeral assumption');await page.getByRole('button',{name:'关闭选段学习'}).click();const before=calls.length;
 await page.getByRole('button',{name:'文字批注',exact:true}).click();await page.locator('.page[data-page-number="1"] .annotationEditorLayer').click({position:{x:120,y:320}});await page.locator('.freeTextEditor [contenteditable="true"]').fill('Extension note');const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'导出含批注 PDF',exact:true}).click();const bytes=await readFile((await (await waiting).path())!);expect(bytes.toString()).toContain('/Contents (Extension note)');expect(calls.length).toBe(before);expect(failures).toEqual([]);await page.close();
});

test('full-page bilingual translation preserves source, reacts to new prose, and restores cached results', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/article?full-translation=1`);
  const original = await page.locator('article').innerHTML();
  const started = calls.length;
  await inject(page);
  await expect(page.getByRole('status')).toContainText('当前内容已处理');
  expect(calls.slice(started).filter(c => c.mode === 'translate')).toHaveLength(0);
  await page.getByRole('button', {name: '翻译全文', exact: true}).click();
  const translations = page.locator('[data-easy-learn="translation"]');
  await expect(translations).toHaveCount(8);
  await expect(page.getByRole('status').filter({hasText: '全文翻译'})).toContainText('8/8 段');
  expect(await page.locator('article').evaluate(el => {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll('[data-easy-learn]').forEach(node => node.remove());
    return copy.innerHTML;
  })).toBe(original);
  await expect(page.locator('pre')).toHaveText('DO NOT ANALYZE THIS CODE BLOCK');
  expect(calls.slice(started).filter(c => c.mode === 'translate').every(c => !c.context.text.includes('Private editable'))).toBe(true);
  await page.locator('article').evaluate(el => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'A dynamically loaded research paragraph.';
    el.append(paragraph);
  });
  await expect(translations).toHaveCount(9);
  await expect(page.getByRole('status').filter({hasText: '全文翻译'})).toContainText('9/9 段');
  const translatedCalls = calls.filter(c => c.mode === 'translate').length;
  await page.getByRole('button', {name: '还原原文', exact: true}).click();
  await expect(translations).toHaveCount(0);
  await page.getByRole('button', {name: '翻译全文', exact: true}).click();
  await expect(translations).toHaveCount(9);
  expect(calls.filter(c => c.mode === 'translate')).toHaveLength(translatedCalls);
  await page.locator('a').click();
  expect(page.url()).toContain('#next');
  await page.close();
});

test('translation pauses on rate limits and resumes only after the reader requests it', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/article?translation-rate-limit=1`);
  await inject(page);
  await expect(page.getByRole('status')).toContainText('当前内容已处理');
  responseStatus = 429;
  await page.getByRole('button', {name: '翻译全文', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: '全文翻译'})).toContainText('限流');
  await expect(page.getByRole('button', {name: '继续翻译', exact: true})).toBeVisible();
  const stopped = calls.length;
  responseStatus = 200;
  await page.getByRole('button', {name: '继续翻译', exact: true}).hover();
  expect(calls).toHaveLength(stopped);
  await page.getByRole('button', {name: '继续翻译', exact: true}).click();
  await expect(page.locator('[data-easy-learn="translation"]')).toHaveCount(8);
  await expect(page.getByRole('status').filter({hasText: '全文翻译'})).toContainText('8/8 段');
  await page.close();
});

test('full-page translation keeps source typography, nested emphasis and responsive styling', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/article?translation-format=1`);
  await page.evaluate(() => {
    document.head.insertAdjacentHTML('beforeend', `<style>
      .typography {font:19px/1.6 Georgia,serif;color:rgb(32,51,72)}
      .typography h1 {font:800 38px/1.15 Georgia,serif;color:rgb(120,40,90);letter-spacing:1px}
      .typography h2 {font-size:27px;font-weight:650;text-align:center}
      .typography strong {font-weight:800}
      .typography mark {background:rgb(255,225,90);color:rgb(80,45,10)}
      .typography .accent {color:rgb(10,100,170);font-size:22px;text-decoration:underline}
      .typography #format-body {opacity:.75;background:rgba(255,120,20,.1)}
      .typography li {font-size:21px;color:rgb(65,90,35);opacity:.8;background:rgba(100,180,60,.1)}
      .typography td {font-size:17px;font-style:italic}
      @media(max-width:800px) {.typography h1{font-size:30px}.typography .accent{font-size:18px}}
    </style>`);
    document.body.innerHTML = `<article class="typography">
      <h1 id="format-title">Reading with emphasis</h1><h2 id="format-section">Daily reading</h2>
      <p id="format-body">Read <strong id="format-bold">carefully</strong>, <mark id="format-mark"><strong><em id="format-nested">important</em></strong></mark>, <span id="format-accent" class="accent">colored</span>, <del id="format-deleted">old</del>, H<sub id="format-sub">2</sub>O.<br id="format-break"><span id="format-hidden-break" style="display:none"><br></span><a id="format-link" href="#format-section">Next section</a><span hidden>Hidden text</span></p>
      <ul><li id="format-list">Read <b id="format-list-bold">today</b>.</li></ul>
      <table><tbody><tr><td id="format-cell">A <mark id="format-cell-mark">notice</mark>.</td></tr></tbody></table>
    </article>`;
  });
  const original = await page.locator('article').innerHTML();
  const sourceNodes = await page.locator('article').evaluateHandle(el => [...el.querySelectorAll('*')]);
  await inject(page);
  await expect(page.getByRole('status')).toContainText('当前内容已处理');
  await page.getByRole('button', {name:'翻译全文',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'全文翻译'})).toContainText('5/5 段');
  const rootStyles = async () => page.evaluate(() => {
    const properties = ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','color','textAlign'];
    return ['format-title','format-section','format-body','format-list','format-cell'].map(id => {
      const source = document.getElementById(id)!;
      const translation = /^(LI|TD)$/.test(source.tagName) ? source.querySelector('[data-easy-learn="translation"]')! : source.nextElementSibling!;
      const pick = (el: Element) => Object.fromEntries(properties.map(key => [key,(getComputedStyle(el) as any)[key]]));
      return {source:pick(source),translation:pick(translation)};
    });
  });
  for (const pair of await rootStyles()) expect(pair.translation).toEqual(pair.source);
  const emphasis = await page.evaluate(() => {
    const pairs: Record<string,string[]> = {
      'format-bold':['fontWeight'], 'format-nested':['fontWeight','fontStyle','color'],
      'format-accent':['fontSize','color','textDecorationLine'], 'format-deleted':['textDecorationLine'],
      'format-sub':['fontSize','verticalAlign'], 'format-list-bold':['fontWeight'],
      'format-cell-mark':['backgroundColor','color'], 'format-link':['color','textDecorationLine'],
    };
    return Object.entries(pairs).map(([id,properties]) => {
      const source = document.getElementById(id)!;
      const translated = [...document.querySelectorAll('[data-easy-learn="translation"] span')]
        .find(el => el.textContent === `中文：${source.textContent}`)!;
      return properties.map(key => ({id,key,source:(getComputedStyle(source) as any)[key],translation:(getComputedStyle(translated) as any)[key]}));
    }).flat();
  });
  for (const pair of emphasis) expect(pair.translation,`${pair.id}: ${pair.key}`).toBe(pair.source);
  const nested = page.locator('[data-easy-learn="translation"] span').filter({hasText:'中文：important'});
  await expect(nested).toHaveCSS('background-color','rgb(255, 225, 90)');
  await expect(page.locator('#format-list > [data-easy-learn="translation"]')).toHaveCSS('opacity','1');
  await expect(page.locator('#format-list > [data-easy-learn="translation"]')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('#format-body + [data-easy-learn="translation"]')).toHaveCSS('opacity','0.75');
  await expect(page.locator('#format-body + [data-easy-learn="translation"]')).toHaveCSS('background-color','rgba(255, 120, 20, 0.1)');
  for (const selector of ['#format-body + [data-easy-learn="translation"]','#format-list > [data-easy-learn="translation"]']) {
    const spans = page.locator(`${selector} span`);
    await expect(spans.filter({hasText:'中文：Read'})).toHaveCSS('opacity','1');
    await expect(spans.filter({hasText:'中文：Read'})).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(spans.filter({hasText:selector.includes('body')?'中文：carefully':'中文：today'})).toHaveCSS('opacity','1');
  }
  await expect(page.locator('#format-body + [data-easy-learn="translation"] br')).toHaveCount(1);
  const translatedText = (await page.locator('[data-easy-learn="translation"]').allTextContents()).join('');
  expect(translatedText).not.toContain('⟦EL:');
  expect(translatedText).not.toContain('Hidden text');
  expect(await page.locator('article').evaluate((el,nodes) => {
    const copy=el.cloneNode(true) as Element;
    copy.querySelectorAll('[data-easy-learn]').forEach(node=>node.remove());
    return {html:copy.innerHTML,same:nodes.every(node=>el.contains(node))};
  },sourceNodes)).toEqual({html:original,same:true});
  const count = calls.filter(call=>call.mode==='translate').length;
  await page.locator('#format-break').evaluate(el=>(el as HTMLElement).style.display='none');
  await expect(page.locator('#format-body + [data-easy-learn="translation"] br')).toHaveCount(0);
  await page.locator('#format-hidden-break').evaluate(el=>(el as HTMLElement).style.display='inline');
  await expect(page.locator('#format-body + [data-easy-learn="translation"] br')).toHaveCount(1);
  await page.locator('#format-section').evaluate(el=>(el as HTMLElement).style.fontSize='32px');
  await expect(page.locator('#format-section + [data-easy-learn="translation"]')).toHaveCSS('font-size','32px');
  await page.setViewportSize({width:760,height:1000});
  await expect(page.locator('#format-title + [data-easy-learn="translation"]')).toHaveCSS('font-size','30px');
  for (const pair of await rootStyles()) expect(pair.translation).toEqual(pair.source);
  await page.getByRole('button',{name:'还原原文',exact:true}).click();
  await page.getByRole('button',{name:'翻译全文',exact:true}).click();
  await expect(page.locator('#format-title + [data-easy-learn="translation"]')).toHaveCSS('font-size','30px');
  expect(calls.filter(call=>call.mode==='translate')).toHaveLength(count);
  await page.screenshot({path:'test-results/full-page-translation-format.png',fullPage:true});
  await page.locator('#format-link').click();
  expect(page.url()).toContain('#format-section');
  await page.close();
});

test('restoring and showing translations retains the current source paragraph in a scrolling reader', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/article?translation-position=1`);
  await page.evaluate(() => {
    document.body.innerHTML = '<article><div id="reader" style="height:500px;overflow-y:auto;overflow-anchor:none"></div></article>';
    const reader = document.querySelector('#reader')!;
    for (let i = 0; i < 20; i++) {
      const paragraph = document.createElement('p');
      paragraph.id = `source-${i}`;
      paragraph.style.marginBottom = '80px';
      paragraph.textContent = `Research paragraph number ${i} explores regional recovery methods.`;
      reader.append(paragraph);
    }
  });
  await inject(page);
  await expect(page.getByRole('status')).toContainText('当前内容已处理');
  await page.getByRole('button', {name: '翻译全文', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: '全文翻译'})).toContainText('20/20 段');
  await page.locator('#reader').evaluate(el => {
    const anchor = document.querySelector('#source-10') as HTMLElement;
    el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - 30;
  });
  const top = await page.locator('#source-10').evaluate(el => el.getBoundingClientRect().top);
  await page.getByRole('button', {name: '还原原文', exact: true}).click();
  expect(Math.abs(await page.locator('#source-10').evaluate(el => el.getBoundingClientRect().top) - top)).toBeLessThan(2);
  await page.getByRole('button', {name: '翻译全文', exact: true}).click();
  expect(Math.abs(await page.locator('#source-10').evaluate(el => el.getBoundingClientRect().top) - top)).toBeLessThan(2);
  await page.close();
});
