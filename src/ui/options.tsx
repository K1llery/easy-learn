import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { annotationTypeValues, configSchema, defaultAnnotationTypes, defaultProfile, endpoint, type AnnotationType, type Config, type Mastered } from '../core/types';
import { providers, providerFor } from '../core/providers';
import { rpc } from './rpc';
import './style.css';
function Options() {
  const [form, setForm] = useState<Config>({ baseUrl: '', model: '', apiKey: '', profile: defaultProfile });
  const [preset,setPreset]=useState('custom'),[localOnly,setLocalOnly]=useState(false);
  const selected=providers.find(p=>p.id===preset);
  const [codeAnnotations,setCodeAnnotations]=useState(false);
  const [annotationTypes,setAnnotationTypes]=useState<AnnotationType[]>(defaultAnnotationTypes);
  const [rememberAnnotations,setRememberAnnotations]=useState(true);
  const [mastered, setMastered] = useState<Mastered[]>([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function load() { const data = await rpc('GET_SETTINGS'); if (data.config) {setForm(data.config);setPreset(providerFor(data.config.baseUrl,data.config.model)?.id??'custom');}setRememberAnnotations(data.reading?.rememberAnnotations!==false);setLocalOnly(data.reading?.localOnly===true); setMastered(data.mastered ?? []);setCodeAnnotations(data.reading?.codeAnnotations===true);setAnnotationTypes(data.reading?.annotationTypes??defaultAnnotationTypes); }
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  const change = (key: 'baseUrl' | 'model' | 'apiKey', value: string) => { setForm(prev => ({ ...prev, [key]: value })); setMessage(''); if(key!=='apiKey')setPreset('custom'); };
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    try {
      const cfg = configSchema.parse(form); const origin = endpoint(cfg.baseUrl).origin + '/*';
      // Request immediately inside the user gesture, before any other awaited operation.
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error('未授权访问模型服务器，设置没有保存。可以再次点击保存并授权。');
      setBusy(true); await rpc('SAVE_SETTINGS', { config: cfg }); setMessage('设置已保存，已开启的页面将按新设置重新分析。');
    } catch (e) { setError((e as Error).name === 'ZodError' ? '请填写模型地址、模型名称、API Key 和学习领域。' : (e as Error).message); }
    finally { setBusy(false); }
  }
  async function test() { setBusy(true); setError(''); setMessage(''); try { setMessage(await rpc('TEST')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function changeAnnotationType(type:AnnotationType,enabled:boolean) { const next=enabled?[...new Set([...annotationTypes,type])]:annotationTypes.filter(item=>item!==type);setAnnotationTypes(next);try{await rpc('SET_ANNOTATION_TYPES',{types:next});setMessage('注释类型已保存，已开启的页面会立即更新。');}catch(e){setAnnotationTypes(annotationTypes);setError((e as Error).message);} }
  const annotationLabels:Record<AnnotationType,string>={abbreviation:'英文缩写',term:'专有名词与技术术语',command:'CLI 命令',vocabulary:'扩展词汇（常用词表外，试验）'};
  return <div className="settings-page"><div className="brand"><span className="brandmark">✦</span>Easy Learn <span className="muted">/ 阅读偏好</span></div>
    <header className="settings-heading"><div className="eyebrow">YOUR READING COMPANION</div><h1>让理解，多走一步。</h1><p>连接你选择的模型，按你的基础解释每一个难点。</p></header>
    <section className="card"><span className="tag">01 · 注释类型</span><h2 style={{marginTop:12}}>选择需要的注释</h2><p className="muted">工具栏图标会先打开类型选择。这里保存的类型会用于之后打开的页面。</p><div className="annotation-options">{annotationTypeValues.map(type=><label className="check-row" key={type}><input type="checkbox" checked={annotationTypes.includes(type)} onChange={e=>void changeAnnotationType(type,e.target.checked)}/><span>{annotationLabels[type]}</span></label>)}</div><p className="form-help">“扩展词汇”是可选试验功能：依据公开的英语词频表近似筛选，不等同于官方四级词表；开启后每段最多多出一个候选，可能增加 API 用量。默认关闭。</p></section>
    <section className="card"><h2>先用免费的本地释义</h2><p>常见技术词和已支持的命令即时注释，不等待 AI、不消耗额度。歧义缩写和未知概念才需要模型。</p><label className="check-row"><input type="checkbox" checked={localOnly} onChange={async e=>{const enabled=e.target.checked;setLocalOnly(enabled);try{await rpc('SET_LOCAL_ONLY',{enabled});}catch(e){setLocalOnly(!enabled);setError((e as Error).message);}}}/><span>离线模式（不调用 AI）</span></label></section>
    <div className="settings-grid"><main><form className="card" onSubmit={save}><span className="tag">02 · 模型连接</span><h2 style={{marginTop:12}}>使用自己的 AI 服务</h2>
      <label htmlFor="provider">服务方案</label><select id="provider" value={preset} onChange={e=>{const id=e.target.value;setPreset(id);setMessage('');const p=providers.find(p=>p.id===id);if(p)setForm(prev=>({...prev,baseUrl:p.baseUrl,model:p.model,apiKey:prev.baseUrl===p.baseUrl?prev.apiKey:''}));}}><option value="custom">自定义服务</option>{providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      {selected&&<div className="notice"><p>{selected.note}</p><a href={selected.signup} target="_blank" rel="noreferrer">注册 / 获取 API Key ↗</a>{' · '}<a href={selected.docs} target="_blank" rel="noreferrer">官方用量说明 ↗</a><p className="muted">DeepSeek 配置核查于 2026-09-22；其他预设核查于 2026-09-20。付费与免费方案均受服务商规则约束。内置的是接口配置，不是共享密钥。选择后仍需保存授权。</p></div>}
      <label htmlFor="base">API Base URL</label><input id="base" type="url" required placeholder="https://your-provider.example/v1" value={form.baseUrl} onChange={e => change('baseUrl', e.target.value)} autoComplete="off"/><p className="form-help">兼容 Chat Completions 的接口，路径通常以 /v1 结尾。</p>
      <label htmlFor="model">模型名称</label><input id="model" required placeholder="填写服务商提供的模型 ID" value={form.model} onChange={e => change('model', e.target.value)} autoComplete="off"/>
      <label htmlFor="key">API Key</label><input id="key" required type="password" value={form.apiKey} onChange={e => change('apiKey', e.target.value)} autoComplete="off" placeholder="仅保存在当前浏览器"/>
      <details className="section-line"><summary>解释偏好（高级）</summary><label htmlFor="domain">学习领域</label><input id="domain" required maxLength={80} value={form.profile.domain} onChange={e => setForm({...form, profile:{...form.profile, domain:e.target.value}})}/>
      <label htmlFor="level">熟悉程度</label><select id="level" value={form.profile.level} onChange={e => setForm({...form, profile:{...form.profile, level:e.target.value as Config['profile']['level']}})}><option>入门</option><option>熟悉</option><option>进阶</option></select><label className="check-row"><input type="checkbox" checked={codeAnnotations} onChange={async e=>{const enabled=e.target.checked;setCodeAnnotations(enabled);try{await rpc('SET_CODE_ANNOTATIONS',{enabled});}catch(e){setCodeAnnotations(!enabled);setError((e as Error).message);}}}/><span>代码注释（不含命令行）</span></label><p className="form-help">默认关闭，命令行注释不受此开关影响。开启代码注释会增加候选和 API 用量。</p></details>
      <div className="notice">开启伴读后，相关网页正文会发送给你指定的模型服务，并可能产生 API 费用。密钥仅存本机；正文和问答不持久保存。默认在本机保留术语释义 30 天以加速重复阅读，可在下方关闭或清除。请只在你愿意交给该服务处理的页面开启。</div>
      <div className="actions"><button type="submit" className="primary" disabled={busy}>保存并授权</button><button type="button" onClick={test} disabled={busy}>测试已保存的连接</button></div>
      {busy && <div className="busy" role="status"><span className="dot"/>正在处理…</div>}{error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
    </form>
    <section className="card"><h2>重复阅读更快</h2><label><input type="checkbox" style={{display:'inline',width:'auto'}} checked={rememberAnnotations} onChange={async e=>{const enabled=e.target.checked;try{await rpc('SET_REMEMBER_ANNOTATIONS',{enabled});setRememberAnnotations(enabled);setMessage(enabled?'已开启术语缓存。':'已关闭并清除术语缓存。');}catch(e){setError((e as Error).message);}}}/> 在本机保留术语释义</label><p className="muted">最多 500 条、保留 30 天。保存术语与解释，不保存整段正文、代码或问答；解释本身可能包含原文短语。只在语境、模型与学习偏好一致时复用，不混用缩写含义。</p><button onClick={async()=>{try{await rpc('CLEAR_ANNOTATION_CACHE');setMessage('术语缓存已清除；当前页面已显示的注释仍可阅读。');}catch(e){setError((e as Error).message);}}}>清除术语缓存</button></section>
    <section className="card"><span className="tag">03 · 不再显示</span><h2 style={{marginTop:12}}>不再显示的注解</h2><p className="muted">按领域与概念含义区分。恢复后，伴读会重新标注。</p>{mastered.length === 0 && <p className="notice">列表为空。在注解里点击“我懂了，不再显示”即可添加。</p>}{mastered.map(item => <div className="learned row" key={item.key}><div><p>{item.anchor} · {item.meaning}</p><small>{item.domain}</small></div><button onClick={async () => {try { await rpc('UNMASTER', {key:item.key}); await load(); } catch(e) {setError((e as Error).message);}}}>恢复显示</button></div>)}</section>
    <button className="quiet" onClick={async () => { if (confirm('清除本机模型配置、术语缓存和全部不再显示记录？')) { await rpc('CLEAR_SETTINGS'); setForm({baseUrl:'',model:'',apiKey:'',profile:defaultProfile}); setMastered([]); setCodeAnnotations(false);setAnnotationTypes(defaultAnnotationTypes); setLocalOnly(false);setRememberAnnotations(true);setPreset('custom'); setMessage('本机数据已清除。'); } }}>清除本机数据</button>
    </main><aside><div className="side-note"><span className="note-number">01</span><h3>从正在读的地方开始</h3><p>点击工具栏图标，选好注释类型后开启当前页面；再点一次可关闭。</p></div><div className="side-note"><span className="note-number">02</span><h3>解释有依据，也有边界</h3><p>缩写会结合上下文判断。缺少信息时，保留候选解释，不把猜测当结论。</p></div><div className="side-note"><span className="note-number">03</span><h3>按自己的节奏阅读</h3><p>读懂的注解可以隐藏，随时在设置中恢复。</p></div></aside></div><div className="footer">EASY LEARN · 读懂，再学会 · v0.8.0</div></div>;
}
createRoot(document.getElementById('root')!).render(<Options/>);
