import React, { useEffect, useState } from 'react';
import type { ChoiceQuiz, TextContext } from '../core/types';
import { findSourceEvidence } from '../core/source-evidence';
import { rpc } from './rpc';
import { ActionStatus } from './practice';
import { useAction } from './use-action';

export function QuickQuiz({ context, active }: { context: TextContext; active: boolean }) {
  const [quiz, setQuiz] = useState<ChoiceQuiz | null>(null), [answer, setAnswer] = useState(''), [started, setStarted] = useState(false);
  const { busy, error, run } = useAction();
  const questionContext: TextContext = { title: '', heading: '', text: context.text, before: '', after: '' };
  function generate() {
    setQuiz(null); setAnswer('');
    void run('正在根据选中文字出题…', () => rpc<ChoiceQuiz>('AI', { request: { operation: 'choice', context: questionContext } }), setQuiz);
  }
  useEffect(() => { if (active && !started) { setStarted(true); generate(); } }, [active, started]);
  const correct = quiz?.options.find(option => option.id === quiz.correctOption);
  const evidence = quiz && findSourceEvidence(context.text, quiz.evidence);
  return <section className="quick-quiz" aria-label="选段单选题">
    <div className="quiz-intro"><span className="eyebrow">选段快测</span><h2>考考我！</h2><p>根据你选中的内容出一道题。答题前不会显示答案。</p></div>
    {!answer && <details><summary>查看选段原文</summary><div className="quiz-source" aria-label="本次出题原文">{context.text}</div></details>}
    {!quiz && !error && <p className="busy" role="status"><span className="dot"/>正在准备一道简单的题目…</p>}
    {quiz && <><h3 className="quiz-question">{quiz.question}</h3>
      <div className="quiz-options" role="radiogroup" aria-label="选择一个答案">{quiz.options.map(option => <label key={option.id} className={`quiz-option${answer === option.id ? ' chosen' : ''}${answer && option.id === quiz.correctOption ? ' is-correct' : ''}${answer === option.id && option.id !== quiz.correctOption ? ' is-incorrect' : ''}`}>
        <input type="radio" name="quick-quiz-answer" value={option.id} checked={answer === option.id} disabled={!!answer || !!busy} onChange={() => setAnswer(option.id)}/>
        <span className="quiz-letter" aria-hidden="true">{option.id}</span><span>{option.text}</span>
      </label>)}</div>
      {answer && <div className={`quiz-result${answer === quiz.correctOption ? ' result-correct' : ' result-incorrect'}`} role="status" aria-live="polite">
        <strong>{answer === quiz.correctOption ? '答对了' : '再看一眼参考答案'}</strong>
        <p><b>正确答案 · {correct?.id}</b>{correct ? `　${correct.text}` : ''}</p>
        <p>{quiz.explanation}</p>
        {evidence ? <blockquote className="quiz-source">原文：{evidence.text}</blockquote> : <p>未找到可核对的原文引用，请自行对照选段检查这道题。</p>}
        <details><summary>查看选段原文</summary><div className="quiz-source">{context.text}</div></details>
      </div>}
    </>}
    <ActionStatus busy={busy} error={error}/>
    {error && <button className="primary" disabled={!!busy} onClick={generate}>重新出题</button>}
    {answer && <button className="quiet quiz-restart" onClick={generate}>再出一道 ↻</button>}
  </section>;
}
