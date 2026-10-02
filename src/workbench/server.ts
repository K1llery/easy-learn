import {createServer,type IncomingMessage} from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {aiRequestSchema,configSchema,readingPrefsSchema,endpoint,defaultProfile,type Config} from '../core/types';
import {callModel,type AnalysisProgress} from '../core/ai';
import {Queue,SessionCache,cacheKey} from '../core/session';
import {AnnotationCache} from '../core/annotation-cache';

export type DesktopControl={version:string;token:string;onQuit:()=>void};
export function createWorkbench(root=process.cwd(), dataDir=path.join(root,'.cache/workbench'), desktop?:DesktopControl) {
  const queue=new Queue(),session=new SessionCache<any>();
  let settings:{config?:Config;reading?:Record<string,any>}={},persisted:Record<string,unknown>={},epoch=0;
  let mutations:Promise<unknown>=Promise.resolve();
  const ready=readFile(path.join(dataDir,'settings.json'),'utf8').then(text=>{
    const data=JSON.parse(text);const config=configSchema.safeParse(data.config);settings={config:config.success?config.data:undefined,reading:readingPrefsSchema.parse(data.reading??{})};
  }).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw new Error('工作台设置无法读取，请检查本机设置文件或恢复备份。');});
  const annotations=new AnnotationCache({get:async key=>({[key]:persisted[key]}),set:async value=>{Object.assign(persisted,value);}});
  async function saveSettings(next:typeof settings){await mkdir(dataDir,{recursive:true,mode:0o700});const file=path.join(dataDir,'settings.json');await writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(file+'.tmp',file);}
  async function readBody(req:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>150000)throw new Error('请求内容过大。');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  function requireConfig(){if(!settings.config)throw new Error('请在设置中连接模型服务，再开启伴读。');return settings.config;}
  async function ai(raw:unknown,signal?:AbortSignal,progress?:(p:AnalysisProgress)=>void) {
    const request=aiRequestSchema.parse(raw),config=requireConfig();queue.setLimit(settings.reading?.concurrency??2);
    const generation=epoch,key=cacheKey(request,{profile:config.profile,tuning:config.tuning,style:config.style},config.model,config.baseUrl);
    const cached=session.get(key);if(cached){if('concepts' in cached)progress?.(cached);return {...cached,__cached:true};}
    const keys=request.candidates?await Promise.all(request.candidates.map(c=>annotations.key(config,request.context.title,c))):[];
    const stored=await annotations.get(keys);
    const hits=request.candidates?.flatMap((c,i)=>stored[i]?[{...stored[i],id:c.id,anchor:c.anchor}]:[])??[];
    if(hits.length)progress?.({concepts:hits,skipped:[]});
    const missing=request.candidates?.filter(c=>!hits.some(h=>h.id===c.id));
    if(missing&&!missing.length)return {concepts:hits,skipped:[],missing:[],__usage:0,__cached:true};
    const result:any=await queue.run(async()=>{if(signal?.aborted)throw new Error('请求已取消。');return callModel(config,missing?{...request,candidates:missing}:request,signal,progress);},request.operation==='analyze'?0:100);
    if('concepts' in result){await annotations.put(result.concepts.flatMap((concept:any)=>{const index=request.candidates?.findIndex(c=>c.id===concept.id)??-1;return keys[index]?[{key:keys[index]!,concept}]:[];}),()=>epoch===generation&&!signal?.aborted);result.concepts=[...hits,...result.concepts];}
    if(!result.missing?.length&&generation===epoch)session.set(key,result);return result;
  }
  const server=createServer(async(req,res)=>{
    let origin='';try {
      await ready;
      const address=server.address();if(!address||typeof address==='string')throw new Error('服务尚未启动。');
      origin=`http://127.0.0.1:${address.port}`;
      const allowedHosts=new Set([`127.0.0.1:${address.port}`,`localhost:${address.port}`]);
      if(!allowedHosts.has(req.headers.host??'')){res.writeHead(403);res.end();return;}
      const url=new URL(req.url??'/',origin);
      if(url.pathname==='/desktop/status'){
        if(!desktop||req.method!=='GET'||req.headers['x-easy-learn-instance']!==desktop.token){res.writeHead(404);res.end();return;}
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({app:'easy-learn',version:desktop.version}));return;
      }
      if(url.pathname.startsWith('/api/')) {
        const allowedOrigins=new Set([origin,`http://localhost:${address.port}`]);
        if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')||(req.headers.origin&&!allowedOrigins.has(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
        const msg=await readBody(req);
        if(url.pathname==='/api/analyze') {
          const controller=new AbortController();res.on('close',()=>controller.abort());
          res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
          try{const result=await ai(msg.request,controller.signal,p=>{if(!res.destroyed)res.write(JSON.stringify({progress:p})+'\n');});if(!res.destroyed)res.end(JSON.stringify({result})+'\n');}
          catch(e){if(!res.destroyed)res.end(JSON.stringify({error:publicError(e)})+'\n');}return;
        }
        if(url.pathname!=='/api/rpc')throw new Error('未知接口。');
        let data:unknown;
        if(msg.type==='GET_SETTINGS')data={...settings,desktop:!!desktop};
        else if(msg.type==='PUBLIC_SETTINGS')data={profile:settings.config?.profile??defaultProfile,mastered:[],batchSize:settings.reading?.batchSize??4,concurrency:settings.reading?.concurrency??2,maxPerBlock:settings.reading?.maxPerBlock??6};
        else if(msg.type==='SAVE_SETTINGS'||msg.type==='SET_READING_PREFS') {
          const change=mutations.then(async()=>{
            let next:typeof settings;
            if(msg.type==='SAVE_SETTINGS'){const config=configSchema.parse(msg.config);if(!['openai','anthropic'].includes(config.api??'openai'))throw new Error('独立工作台请使用 API Key 或 CPA 接口。');endpoint(config.baseUrl);next={...settings,config};}
            else next={...settings,reading:{...settings.reading,...readingPrefsSchema.parse(msg.prefs)}};
            await saveSettings(next);settings=next;epoch++;session.clear();await annotations.clear();return null;
          });mutations=change.catch(()=>undefined);data=await change;
        } else if(msg.type==='AI'){const controller=new AbortController();res.on('close',()=>controller.abort());data=await ai(msg.request,controller.signal);}
        else if(msg.type==='TEST'){const controller=new AbortController();res.on('close',()=>controller.abort());await ai({operation:'explain',context:{title:'连接测试',heading:'',text:'An API is an application programming interface.',before:'',after:''}},controller.signal);data='连接成功，模型返回了可用的结果。';}
        else if(msg.type==='QUIT_DESKTOP'&&desktop){if(req.headers.origin!==origin){res.writeHead(403);res.end();return;}res.once('finish',desktop.onQuit);data=null;}
        else throw new Error('未知操作。');
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,data}));return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
      const publicRoot=path.resolve(root,'dist-workbench');
      const filename=path.resolve(publicRoot,'.'+decodeURIComponent(url.pathname==='/'?'/reader.html':url.pathname));
      if(!filename.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return;}
      const body=await readFile(filename);const mime:Record<string,string>={'.html':'text/html;charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.txt':'text/plain;charset=utf-8','.json':'application/json','.bcmap':'application/octet-stream','.ttf':'font/ttf','.wasm':'application/wasm'};
      res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:body);
    } catch(e){if(!res.headersSent){res.writeHead((e as NodeJS.ErrnoException).code==='ENOENT'?404:400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:false,error:publicError(e)}));}else res.end();}
  });
  return server;
}
function publicError(error:unknown){return error instanceof Error&&error.name!=='ZodError'&&!('code' in error)?error.message:'设置或请求格式无效，请检查输入。';}
