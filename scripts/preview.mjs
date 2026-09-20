// Local UI-only preview. Never included in the extension bundle; no external API calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const mock = `
let config, mastered=[];
window.chrome={permissions:{request:async()=>true},runtime:{
 connect:()=>({postMessage(){},disconnect(){},onDisconnect:{addListener(){}},onMessage:{addListener(){}}}),
 sendMessage:async msg=>{let data=null;
 if(msg.type==='GET_SETTINGS') data={config,mastered};
 if(msg.type==='SAVE_SETTINGS') config=msg.config;
 if(msg.type==='TEST') data='连接成功（界面预览：模拟结果，未调用模型）。';
 if(msg.type==='OPEN_OPTIONS'){location.href='/options.html';}
 if(msg.type==='MASTER'){data={key:msg.concept.meaning,anchor:msg.concept.anchor,meaning:msg.concept.meaning,domain:'软件开发'};mastered.push(data);}
 if(msg.type==='UNMASTER')mastered=mastered.filter(x=>x.key!==msg.key);
 if(msg.type==='CLEAR_SETTINGS'){config=undefined;mastered=[];}
 if(msg.type==='AI') {const r=msg.request;
 if(r.operation==='quiz')data={question:'如果主区域不可用，为什么仅在本地保存副本还不够？'};
 else if(r.operation==='evaluate')data={correct:'你指出了需要恢复服务。',gaps:'还需要解释本地副本可能随主区域一起不可用。',reference:'异地副本在不同故障域保存数据，使备用区域能够恢复服务。'};
 else data={meaning:'灾难恢复',expansion:'Disaster Recovery',evidence:'原文提到 regional failure，因此这里的 DR 指灾难恢复。',ambiguity:'',explanation:r.mode==='followup'?'备份负责保留数据，而灾难恢复还包括备用区域、恢复流程和切换演练。':'灾难恢复是一套让系统在重大故障后恢复服务的安排。它不仅要有数据副本，还要提前知道如何切换到可用的环境。',example:'当主机房断电时，备用区域利用已有副本接管服务。',prerequisites:[{term:'故障域',explanation:'可能因同一个故障同时失效的一组资源。'}],translation:r.mode==='translate'?'使用灾难恢复（DR）应对区域故障。不要关闭复制。至少保留 3 个副本。':''};}
 return {ok:true,data};}}};
document.addEventListener('DOMContentLoaded',()=>{const note=document.createElement('div');note.textContent='界面预览 · 使用固定模拟结果 · 不调用真实模型';note.style='padding:7px 14px;background:#fff0d2;color:#715727;font:12px system-ui;text-align:center';document.body.prepend(note);});
`;
createServer(async(req,res)=>{
 const route=new URL(req.url,'http://localhost').pathname;
 if(route==='/mock.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(mock);return;}
 const file=route==='/'?'panel.html':route.slice(1);
 if(!['panel.html','options.html'].includes(file)&&!/^assets\/[\w.-]+$/.test(file)){res.writeHead(404);res.end();return;}
 try{let data=await readFile(path.join('dist',file));
 if(file.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><script src="/mock.js"></script>'));
 res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript'});res.end(data);
 }catch{res.writeHead(404);res.end('先运行 pnpm build');}
}).listen(4173,'127.0.0.1',()=>console.log('UI preview: http://127.0.0.1:4173 (mock only)'));
