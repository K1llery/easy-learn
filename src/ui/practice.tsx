import React, { useState } from 'react';
import type { Concept, Evaluation, Quiz, TextContext } from '../core/types';
import type { LearningCard } from '../core/learning';
import { rpc } from './rpc';
import { useAction } from './use-action';

export function Feedback({ value }: { value: Evaluation }) {
  return <div className="learning-feedback">
    <h3>你已经理解的</h3><p>{value.correct || '暂未识别出足够依据，请对照原文判断。'}</p>
    <h3>还差哪一步</h3><p>{value.gaps || '本次未指出具体缺口，请继续用实际例子检验。'}</p>
    <h3>参考解释</h3><p>{value.reference}</p>
    <p className="muted">这是 AI 对本次回答的反馈，不是掌握证明；有疑问时回到原文核对。</p>
  </div>;
}
export function ActionStatus({ busy, error }: { busy: string; error: string }) {
  return <>{busy && <p className="busy" role="status"><span className="dot"/>{busy}</p>}{error && <p className="error" role="alert">{error}</p>}</>;
}
export function Practice({ context, concept, onReview }: { context: TextContext; concept?: Concept; onReview: () => void }) {
  const [goal, setGoal] = useState(''), [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answer, setAnswer] = useState(''), [feedback, setFeedback] = useState<Evaluation | null>(null);
  const [saved, setSaved] = useState<LearningCard | null>(null);
  const [id] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useAction();
  // Keep the practice tied to the selected paragraph. Neighbors and entire sections are not needed.
  const selected: TextContext = { title: context.title, heading: context.heading, text: context.text, before: '', after: '', kind: context.kind };
  return <section className="practice" aria-label="主动练习">
    <div className="practice-heading"><span className="eyebrow">TURN READING INTO ABILITY</span><h2>读懂之后，让自己说一遍。</h2><p className="muted">先回忆，再对照，最后把它用在一个小场景里。原文和解释已收起，可随时返回阅读。</p></div>
    <ol className="learning-steps" aria-label="练习步骤"><li className={!quiz ? 'current' : ''}>定目标</li><li className={quiz && !feedback ? 'current' : ''}>先回答</li><li className={feedback ? 'current' : ''}>反馈与应用</li></ol>
    {!quiz ? <form className="card" onSubmit={event => {
      event.preventDefault();
      void run('正在根据选段准备练习…', () => rpc<Quiz>('AI', { request: { operation: 'quiz', context: selected, concept, goal } }), setQuiz);
    }}>
      <label htmlFor="learning-goal">这段内容，你想拿来做什么？（可选）</label>
      <input id="learning-goal" maxLength={300} value={goal} disabled={!!busy} onChange={e => setGoal(e.target.value)} placeholder="例如：给自己的项目设计一个可靠的备份方案"/>
      <p className="form-help">不填也可以，先练习解释这段内容的核心原理。</p>
      <button className="primary" type="submit" disabled={!!busy}>出一道练习题</button>
      <p className="muted">点击后，将本段原文和目标发送给你配置的模型；提交回答时再请求一次反馈。</p>
    </form> : <>
      {goal && <p className="learning-goal">我的目标 · {goal}</p>}
      <form className="card" onSubmit={event => {
        event.preventDefault(); if (!answer.trim() || feedback) return;
        void run('正在对照原文，找出理解中的缺口…', () => rpc<Evaluation>('AI', { request: { operation: 'evaluate', context: selected, concept, goal, question: quiz.question, answer: answer.trim() } }), setFeedback);
      }}>
        <span className="tag">01 · 先用自己的话回答</span><p className="learning-question">{quiz.question}</p>
        <label htmlFor="learning-answer">我的回答</label>
        <textarea id="learning-answer" rows={5} maxLength={5000} value={answer} disabled={!!busy || !!feedback} onChange={e => setAnswer(e.target.value)} placeholder="先写出自己的理解。不确定的部分也可以写下来。"/>
        {!feedback && <button className="primary" disabled={!!busy || !answer.trim()} type="submit">请 AI 找出理解缺口</button>}
      </form>
      {feedback && <>
        <section className="card" aria-label="练习反馈"><span className="tag">02 · 对照与补充</span><Feedback value={feedback}/></section>
        <section className="card application-card" aria-label="应用小任务"><span className="tag">03 · 花十分钟，用一次</span><p className="learning-question">{quiz.application}</p><p className="muted">在真实项目或自己的例子里尝试。保存后，可以在“我的复习”记录做法、结果和仍未解决的问题。</p></section>
        <section className="save-practice">
          {saved ? <><p className="success" role="status">已保存，明天再回忆一次。也可以现在留下实践记录。</p><button onClick={onReview}>去我的复习</button></> : <>
            <button className="primary" disabled={!!busy} onClick={() => void run('正在保存到本机…', () => rpc<LearningCard>('LEARNING_SAVE', { draft: { id, title: selected.title || '我的练习', sourceText: selected.text, goal, question: quiz.question, application: quiz.application, answer: answer.trim(), feedback } }), setSaved)}>保存练习，明天复习</button>
            <p className="muted">仅点击保存后，本段原文、目标、回答和反馈才会留在此浏览器。最多 50 条，可导出或删除。</p>
          </>}
        </section>
      </>}
    </>}
    <ActionStatus busy={busy} error={error}/>
  </section>;
}
