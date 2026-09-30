import React, { useEffect, useState } from 'react';
import { LEARNING_KEY, REVIEW_DAYS, learningMarkdown, type LearningCard } from '../core/learning';
import { rpc } from './rpc';
import { useAction } from './use-action';
import { ActionStatus, Feedback } from './practice';

const date = (value: number) => new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
function ReviewCard({ initial, initialMode, onBack, onChange }: { initial: LearningCard; initialMode: 'recall' | 'apply'; onBack: () => void; onChange: (card: LearningCard) => void }) {
  const [card, setCard] = useState(initial), [mode, setMode] = useState(initialMode);
  const [answer, setAnswer] = useState(''), [revealed, setRevealed] = useState(false), [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState(initial.actionNote), [noteSaved, setNoteSaved] = useState(false);
  const { busy, error, run } = useAction();
  const update = (next: LearningCard) => { setCard(next); onChange(next); };
  function review(rating: 'again' | 'remembered') {
    if (!revealed || !answer.trim() || reviewed) return;
    void run('正在记录这次回忆…', () => rpc<LearningCard>('LEARNING_REVIEW', { id: card.id, revision: card.revision, rating, answer: answer.trim() }), next => { update(next); setReviewed(true); });
  }
  return <section aria-label="复习练习">
    <button className="quiet" onClick={onBack}>← 返回复习列表</button>
    <p className="eyebrow learning-source-title">{card.title}</p>
    {card.goal && <p className="learning-goal">目标 · {card.goal}</p>}
    <div className="learning-tabs" aria-label="复习方式"><button aria-pressed={mode === 'recall'} onClick={() => setMode('recall')}>回忆练习</button><button aria-pressed={mode === 'apply'} onClick={() => setMode('apply')}>应用记录</button></div>
    <div hidden={mode !== 'recall'}>
      <div className="card"><span className="tag">先回忆，再看参考</span><p className="learning-question">{card.question}</p>
        <label htmlFor="review-answer">这次我能想起什么？</label><textarea id="review-answer" rows={5} value={answer} maxLength={5000} disabled={revealed || !!busy} onChange={e => setAnswer(e.target.value)} placeholder="尽量不看原文；如果想不起来，也可以写下卡住的地方。"/>
        {!revealed && <button className="primary" disabled={!answer.trim() || !!busy} onClick={() => setRevealed(true)}>写好了，对照参考</button>}
      </div>
      {revealed && <>
        <section className="card" aria-label="复习参考"><span className="tag">第一次练习时的 AI 反馈</span><Feedback value={card.feedback} sourceText={card.sourceText}/><details><summary>核对原文选段</summary><p>{card.sourceText}</p></details><details><summary>回看第一次回答</summary><p>{card.answer}</p></details></section>
        {reviewed ? <div className="success" role="status">已记录这次回忆，下次复习：{date(card.dueAt)}。</div> : <div className="card"><h3>对照后，给自己一个诚实的判断</h3><p className="muted">这里不调用 AI。依据自己是否能独立解释来安排下次回忆。</p><div className="actions">
          <button disabled={!!busy} onClick={() => review('again')}>还需练习 · 1 天后</button>
          <button className="primary" disabled={!!busy} onClick={() => review('remembered')}>能独立解释 · {REVIEW_DAYS[Math.min(card.step + 1, REVIEW_DAYS.length - 1)]} 天后</button>
        </div></div>}
      </>}
    </div>
    <div hidden={mode !== 'apply'}>
      <section className="card application-card"><span className="tag">花十分钟，用一次</span><p className="learning-question">{card.application}</p></section>
      <form className="card" onSubmit={event => { event.preventDefault(); void run('正在保存实践记录…', () => rpc<LearningCard>('LEARNING_NOTE', { id: card.id, revision: card.revision, note }), next => { update(next); setNote(next.actionNote); setNoteSaved(true); }); }}>
        <label htmlFor="action-note">我做了什么，结果怎样？</label><textarea id="action-note" rows={6} maxLength={3000} value={note} disabled={!!busy} onChange={e => { setNote(e.target.value); setNoteSaved(false); }} placeholder="例如：画了两个机房的恢复流程图。发现只有数据副本还不够，还需要验证服务切换。下一步做一次演练。"/>
        <p className="muted">可以写做法、结果、作品位置和下一步。只保存在本机，不发送给 AI。</p><button className="primary" type="submit" disabled={!!busy || note.trim() === card.actionNote}>保存实践记录</button>
        {noteSaved && <p className="success" role="status">实践记录已保存。</p>}
      </form>
    </div>
    <ActionStatus busy={busy} error={error}/>
  </section>;
}
export function ReviewDesk({ active, onRead }: { active: boolean; onRead: () => void }) {
  const [cards, setCards] = useState<LearningCard[]>([]), [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<{ card: LearningCard; mode: 'recall' | 'apply' } | null>(null);
  const [now, setNow] = useState(Date.now());
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (!active) return;
    let disposed = false, sequence = 0;
    async function load() {
      const current = ++sequence;
      try {
        const next = await rpc<LearningCard[]>('LEARNING_LIST');
        if (!disposed && sequence === current) { setCards(next); setLoaded(true); setLoadError(''); setNow(Date.now()); setSelected(prev => prev && next.some(card => card.id === prev.card.id) ? prev : null); }
      } catch (e) { if (!disposed && sequence === current) setLoadError((e as Error).message); }
    }
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && LEARNING_KEY in changes) void load(); };
    void load(); chrome.storage.onChanged.addListener(changed);
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => { disposed = true; clearInterval(timer); chrome.storage.onChanged.removeListener(changed); };
  }, [active]);
  function exportCards() {
    const url = URL.createObjectURL(new Blob([learningMarkdown(cards)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'easy-learn-learning.md'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const due = cards.filter(card => card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
  const later = cards.filter(card => card.dueAt > now).sort((a, b) => a.dueAt - b.dueAt);
  function renderCard(card: LearningCard) {
    return <article className="card review-item" key={card.id}>
      <div className="row"><span className="tag">{card.dueAt <= now ? '到时间了' : `${date(card.dueAt)}再回忆`}</span><small>已复习 {card.reviewCount} 次</small></div>
      <h3>{card.goal || card.title}</h3><p>{card.question}</p><p className="muted">{card.actionRecordedAt ? '已留下实践记录' : '还可以做一次应用练习'}</p>
      <div className="actions"><button className="primary" onClick={() => setSelected({ card, mode: 'recall' })}>{card.dueAt <= now ? '开始复习' : '提前练一次'}</button><button onClick={() => setSelected({ card, mode: 'apply' })}>记录实践</button><button className="quiet" disabled={!!busy} aria-label={`删除练习：${card.question}`} onClick={() => {
        if (window.confirm('删除这条练习和实践记录？需要保留时，请先导出。')) void run('正在删除…', () => rpc('LEARNING_DELETE', { id: card.id }), () => setCards(prev => prev.filter(item => item.id !== card.id)));
      }}>删除</button></div>
    </article>;
  }
  return <div className="review-desk">
    {selected ? <ReviewCard key={selected.card.id} initial={selected.card} initialMode={selected.mode} onBack={() => setSelected(null)} onChange={next => { setCards(prev => prev.map(card => card.id === next.id ? next : card)); setSelected(prev => prev ? { ...prev, card: next } : null); }}/>
    : <><div className="intro"><div className="eyebrow">我的学习记录</div><h1>让昨天读过的，<br/>成为今天会用的。</h1><p>每天找几分钟，先独立回忆，再去做一件小事。</p></div>
      <div className="learning-stats"><div><strong>{due.length}</strong><span>到期复习</span></div><div><strong>{cards.length}</strong><span>保存的练习</span></div><div><strong>{cards.filter(card => !!card.actionRecordedAt).length}</strong><span>有实践记录</span></div></div>
      {loadError && <div className="error" role="alert">{loadError}<button onClick={() => void run('正在重新读取…', () => rpc<LearningCard[]>('LEARNING_LIST'), next => { setCards(next); setLoaded(true); setLoadError(''); })}>重新读取</button></div>}
      {!loaded && !loadError && <p className="busy" role="status">正在读取本机练习…</p>}
      {loaded && !cards.length && <div className="card learning-empty"><span className="empty-symbol" aria-hidden="true">↗</span><h2>先练会一个小知识点</h2><p>从网页、PDF 或粘贴文本开始。打开“练会这一段”，回答一道问题，再保存到这里。</p><button className="primary" onClick={onRead}>从一段文字开始</button></div>}
      {!!cards.length && <><div className="row section-line"><h2>现在可以复习</h2><button className="quiet" onClick={exportCards}>导出学习记录</button></div>
        {due.length ? due.map(renderCard) : <p className="notice">今天没有到期的练习。可以记录一次实践，也可以提前练一次。</p>}
        {!!later.length && <><h2 className="section-line">接下来再回忆</h2>{later.map(renderCard)}</>}
      </>}
      <p className="muted section-line">记录只存在此浏览器，可随时导出或删除。复习与实践记录可离线使用，不调用模型。复习间隔为 1 / 3 / 7 / 14 / 30 天，由你的自评调整；它是复习建议，不是记忆能力测量。</p>
      <ActionStatus busy={busy} error={error}/>
    </>}
  </div>;
}
