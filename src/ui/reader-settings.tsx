import React, {useEffect,useState} from 'react';
import { providers } from '../core/providers';
import {configSchema,defaultProfile,type Config} from '../core/types';
import {rpc} from './rpc';
import {ModelControls} from './model-controls';
import {inExtension} from './reader-rpc';
export function ReaderSettings({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}) {
  const [config,setConfig]=useState<Config>({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'',api:'openai',profile:{...defaultProfile,domain:'外语阅读'},style:'concise'});
  const [prefs,setPrefs]=useState({batchSize:4,concurrency:2,maxPerBlock:6});
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void rpc('GET_SETTINGS').then(data=>{if(data.config)setConfig(data.config);setPrefs({batchSize:data.reading?.batchSize??4,concurrency:data.reading?.concurrency??2,maxPerBlock:data.reading?.maxPerBlock??6});}).catch(e=>setError(e.message));},[]);
  async function save(e:React.FormEvent) {
    e.preventDefault();setBusy(true);setError('');setMessage('');
    try {const parsed=configSchema.parse(config);await rpc('SAVE_SETTINGS',{config:parsed});await rpc('SET_READING_PREFS',{prefs});setMessage('连接已保存。');onSaved();}
    catch(e){setError((e as Error).name==='ZodError'?'请检查模型、密钥与参数范围。':(e as Error).message);}finally{setBusy(false);}
  }
  return <section className="reader-settings card" aria-label="工作台设置"><div className="row"><h2>模型连接</h2><button type="button" className="quiet" onClick={onClose}>完成</button></div>
    {inExtension?<><p className="muted">工作台使用扩展已保存的模型连接与请求偏好。</p><div className="actions"><button onClick={()=>void chrome.runtime.openOptionsPage()}>打开扩展设置</button></div></>:<form onSubmit={save}>
      <label htmlFor="reader-provider">服务方案</label><select id="reader-provider" onChange={e=>{const provider=providers.find(p=>p.id===e.target.value);if(provider)setConfig({...config,baseUrl:provider.baseUrl,model:provider.model,api:provider.api,apiKey:'',tuning:undefined});}} defaultValue=""><option value="">当前 / 自定义连接</option>{providers.filter(p=>!p.oauth).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <label htmlFor="reader-base">API Base URL</label><input id="reader-base" type="url" required value={config.baseUrl} onChange={e=>setConfig({...config,baseUrl:e.target.value})}/>
      <label htmlFor="reader-model">模型名称</label><input id="reader-model" required value={config.model} onChange={e=>setConfig({...config,model:e.target.value})}/>
      <label htmlFor="reader-key">API Key / CPA 访问密钥</label><input id="reader-key" type="password" required autoComplete="off" value={config.apiKey} onChange={e=>setConfig({...config,apiKey:e.target.value})}/>
      <div className="prefs-grid" style={{marginTop:20}}><label htmlFor="reader-concurrency">同时请求数</label><select id="reader-concurrency" value={prefs.concurrency} onChange={e=>setPrefs({...prefs,concurrency:Number(e.target.value)})}>{[1,2,3,4,6].map(n=><option key={n} value={n}>{n} 路</option>)}</select><label htmlFor="reader-batch">每批候选数</label><select id="reader-batch" value={prefs.batchSize} onChange={e=>setPrefs({...prefs,batchSize:Number(e.target.value)})}>{[2,4,6].map(n=><option key={n} value={n}>{n} 个</option>)}</select></div>
      <ModelControls config={config} onChange={tuning=>setConfig({...config,tuning})}/>
      <p className="form-help">保存后，连接信息存放在本机工作台的 .cache/workbench/settings.json。只发送候选词的短语境，不上传整份文件。</p>
      <div className="actions"><button className="primary" disabled={busy}>保存连接</button><button type="button" disabled={busy} onClick={()=>{setBusy(true);setError('');void rpc('TEST').then(setMessage).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>测试连接</button></div>
      {message&&<div className="success" role="status">{message}</div>}
    </form>}{error&&<div className="error" role="alert">{error}</div>}
  </section>;
}
