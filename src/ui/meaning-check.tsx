import React, { useId, useState } from 'react';
import type { Evaluation, TextContext } from '../core/types';
import { Feedback, ActionStatus } from './practice';
import { rpc } from './rpc';
import { useAction } from './use-action';

const QUESTION = '请用自己的话解释所选文字的意思。对照原文检查回答中的概念、因果、条件、否定、比较和数值；反馈时指出对应的原文短语，不补充原文没有的信息。';

export function MeaningCheck({ context }: { context: TextContext }) {
  const answerId = useId();
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Evaluation | null>(null);
  const { busy, error, run } = useAction();

  return <section className="card" aria-label="选段理解核对">
    <span className="tag">先试着理解</span>
    <p className="source">{context.text}</p>
    <p className="muted">先用自己的话说说这段在讲什么。可以写下不确定的地方；提交后才会请求 AI 对照原文反馈。</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!answer.trim() || feedback) return;
      void run('正在对照原文核对理解…', () => rpc<Evaluation>('AI', { request: { operation: 'evaluate', context, question: QUESTION, answer: answer.trim() } }), setFeedback);
    }}>
      <label htmlFor={answerId}>我的理解</label>
      <textarea id={answerId} rows={4} maxLength={5000} value={answer} disabled={!!busy || !!feedback} onChange={event => setAnswer(event.target.value)} placeholder="例如：作者提出了什么判断？这个判断在什么条件下成立？"/>
      {!feedback && <div className="actions"><button className="primary" type="submit" disabled={!!busy || !answer.trim()}>核对我的理解</button></div>}
    </form>
    {feedback && <section aria-label="理解反馈"><Feedback value={feedback} sourceText={context.text}/></section>}
    <ActionStatus busy={busy} error={error}/>
  </section>;
}
