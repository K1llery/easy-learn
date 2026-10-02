// @vitest-environment node
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer,type Server} from 'node:http';
import {startDesktop} from '../src/workbench/desktop';

const servers:Server[]=[],directories:string[]=[];
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function directory(){const dir=await mkdtemp(path.join(tmpdir(),'easy-learn-desktop-'));directories.push(dir);return dir;}
async function occupied(){const server=createServer((_,res)=>res.end('foreign service'));servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return (server.address() as {port:number}).port;}
async function launch(dir:string,port:number){const result=await startDesktop(process.cwd(),dir,'test-version',port);if(result.server)servers.push(result.server);return result;}
test('simultaneous desktop launches reuse one authenticated instance without revealing the launch token',async()=>{
 const dir=await directory(),port=(await occupied())+1;
 const [first,second]=await Promise.all([launch(dir,port),launch(dir,port)]);
 expect(first.url).toBe(second.url);expect([first.reused,second.reused].sort()).toEqual([false,true]);
 expect((await fetch(first.url+'desktop/status')).status).toBe(404);
 const settings=await fetch(first.url+'api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'GET_SETTINGS'})});const data=await settings.json();expect(data.data.desktop).toBe(true);expect(JSON.stringify(data)).not.toContain('token');
});
test('foreign occupied ports fall back safely and the chosen browser origin survives restart',async()=>{
 const dir=await directory(),port=await occupied();const first=await launch(dir,port);expect(first.url).not.toBe(`http://127.0.0.1:${port}/`);
 const post=(type:string,origin?:string)=>fetch(first.url+'api/rpc',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({type})});
 const config={baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'fixture-key',profile:{domain:'外语阅读',level:'入门'}};
 expect((await (await fetch(first.url+'api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'SAVE_SETTINGS',config})})).json()).ok).toBe(true);
 expect((await post('QUIT_DESKTOP')).status).toBe(403);expect((await post('QUIT_DESKTOP','https://foreign.test')).status).toBe(403);
 await expect(startDesktop(process.cwd(),dir,'different-version',port)).rejects.toThrow('另一个版本');
 expect((await post('QUIT_DESKTOP',new URL(first.url).origin)).status).toBe(200);
 await new Promise<void>(r=>first.server!.listening?first.server!.once('close',r):r());
 const second=await launch(dir,port);expect(second.url).toBe(first.url);expect(second.reused).toBe(false);
 const restored=await (await fetch(second.url+'api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'GET_SETTINGS'})})).json();expect(restored.data.config).toMatchObject(config);
 const state=JSON.parse(await readFile(path.join(dir,'desktop-instance.json'),'utf8'));expect(state.token).toMatch(/^[a-f0-9]{64}$/);
});
test('quitting cancels an in-flight connection test at the provider boundary',async()=>{
 let aborted=false;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 const model=createServer((_,response)=>{response.once('close',()=>{aborted=true;});entered();});servers.push(model);await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));
 const result=await launch(await directory(),(await occupied())+1),origin=new URL(result.url).origin;
 const post=(body:unknown)=>fetch(result.url+'api/rpc',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 await post({type:'SAVE_SETTINGS',config:{baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}/v1`,model:'fixture-model',apiKey:'fixture-key',profile:{domain:'外语阅读',level:'入门'}}});
 const testing=post({type:'TEST'}).catch(()=>undefined);await started;await post({type:'QUIT_DESKTOP'});await testing;await expect.poll(()=>aborted,{timeout:1000}).toBe(true);
});
