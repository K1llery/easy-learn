import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configSchema, defaultProfile, endpoint, type Config, type Mastered } from '../core/types';
import { rpc } from './rpc';
import './style.css';
function Options() {
  const [form, setForm] = useState<Config>({ baseUrl: '', model: '', apiKey: '', profile: defaultProfile });
  const [codeAnnotations,setCodeAnnotations]=useState(false);
  const [mastered, setMastered] = useState<Mastered[]>([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function load() { const data = await rpc('GET_SETTINGS'); if (data.config) setForm(data.config); setMastered(data.mastered ?? []);setCodeAnnotations(data.reading?.codeAnnotations===true); }
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  const change = (key: 'baseUrl' | 'model' | 'apiKey', value: string) => { setForm(prev => ({ ...prev, [key]: value })); setMessage(''); };
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
  return <div className="settings-page"><div className="brand"><span className="brandmark">✦</span>Easy Learn <span className="muted">/ 阅读偏好</span></div>
    <header className="settings-heading"><div className="eyebrow">YOUR READING COMPANION</div><h1>让理解，多走一步。</h1><p>连接你选择的模型，按你的基础解释每一个难点。</p></header>
    <div className="settings-grid"><main><form className="card" onSubmit={save}><span className="tag">01 · 模型连接</span><h2 style={{marginTop:12}}>使用自己的 AI 服务</h2>
      <label htmlFor="base">API Base URL</label><input id="base" type="url" required placeholder="https://your-provider.example/v1" value={form.baseUrl} onChange={e => change('baseUrl', e.target.value)} autoComplete="off"/><p className="form-help">兼容 Chat Completions 的接口，路径通常以 /v1 结尾。</p>
      <label htmlFor="model">模型名称</label><input id="model" required placeholder="填写服务商提供的模型 ID" value={form.model} onChange={e => change('model', e.target.value)} autoComplete="off"/>
      <label htmlFor="key">API Key</label><input id="key" required type="password" value={form.apiKey} onChange={e => change('apiKey', e.target.value)} autoComplete="off" placeholder="仅保存在当前浏览器"/>
      <div className="section-line"><span className="tag">02 · 学习偏好</span><label htmlFor="domain">学习领域</label><input id="domain" required maxLength={80} value={form.profile.domain} onChange={e => setForm({...form, profile:{...form.profile, domain:e.target.value}})}/>
      <label htmlFor="level">熟悉程度</label><select id="level" value={form.profile.level} onChange={e => setForm({...form, profile:{...form.profile, level:e.target.value as Config['profile']['level']}})}><option>入门</option><option>熟悉</option><option>进阶</option></select><label><input type="checkbox" style={{display:'inline',width:'auto'}} checked={codeAnnotations} onChange={async e=>{const enabled=e.target.checked;try{await rpc('SET_CODE_ANNOTATIONS',{enabled});setCodeAnnotations(enabled);}catch(e){setError((e as Error).message);}}}/> 代码注释（不含命令行）</label><p className="form-help">默认关闭，立即生效。开启后自动预载代码解释，可能增加 API 用量。</p></div>
      <div className="notice">开启伴读后，相关网页正文会发送给你指定的模型服务，并可能产生 API 费用。密钥仅存本机；正文和问答不持久保存。请只在你愿意交给该服务处理的页面开启。</div>
      <div className="actions"><button type="submit" className="primary" disabled={busy}>保存并授权</button><button type="button" onClick={test} disabled={busy}>测试已保存的连接</button></div>
      {busy && <div className="busy" role="status"><span className="dot"/>正在处理…</div>}{error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
    </form>
    <section className="card"><span className="tag">03 · 不再显示</span><h2 style={{marginTop:12}}>不再显示的注解</h2><p className="muted">按领域与概念含义区分。恢复后，伴读会重新标注。</p>{mastered.length === 0 && <p className="notice">列表为空。在注解里点击“我懂了，不再显示”即可添加。</p>}{mastered.map(item => <div className="learned row" key={item.key}><div><p>{item.anchor} · {item.meaning}</p><small>{item.domain}</small></div><button onClick={async () => {try { await rpc('UNMASTER', {key:item.key}); await load(); } catch(e) {setError((e as Error).message);}}}>恢复显示</button></div>)}</section>
    <button className="quiet" onClick={async () => { if (confirm('清除本机模型配置和全部不再显示记录？')) { await rpc('CLEAR_SETTINGS'); setForm({baseUrl:'',model:'',apiKey:'',profile:defaultProfile}); setMastered([]); setCodeAnnotations(false); setMessage('本机数据已清除。'); } }}>清除本机数据</button>
    </main><aside><div className="side-note"><span className="note-number">01</span><h3>从正在读的地方开始</h3><p>打开文章，点击浏览器工具栏里的 Easy Learn。再次点击即可关闭。</p></div><div className="side-note"><span className="note-number">02</span><h3>解释有依据，也有边界</h3><p>缩写会结合上下文判断。缺少信息时，保留候选解释，不把猜测当结论。</p></div><div className="side-note"><span className="note-number">03</span><h3>按自己的节奏阅读</h3><p>读懂的注解可以隐藏，随时在设置中恢复。</p></div></aside></div><div className="footer">EASY LEARN · 读懂，再学会 · v0.4.0</div></div>;
}
createRoot(document.getElementById('root')!).render(<Options/>);
