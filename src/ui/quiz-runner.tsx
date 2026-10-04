import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PageQuiz } from '../core/types';
import { findSourceEvidence } from '../core/source-evidence';
import { rpc } from './rpc';
import { ActionStatus } from './practice';
import { useAction } from './use-action';

// Self-contained styles: the runner renders inside page overlays (content-script
// shadow DOM) as well as extension pages, so it cannot rely on style.css.
const QUIZ_CSS = `.elq-shell{font:14px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f;background:#fff;border-radius:18px;padding:22px 22px 18px;box-shadow:0 18px 60px #0004;box-sizing:border-box}
.elq-shell *{box-sizing:border-box}
.elq-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.elq-eyebrow{font-size:11px;letter-spacing:.14em;color:#5a7268;font-weight:600}
.elq-count{font-size:12px;color:#5a7268}
.elq-title{margin:4px 0 2px;font-size:20px}
.elq-hint{margin:0 0 12px;color:#5a7268;font-size:12.5px}
.elq-question{margin:14px 0 10px;font-size:16.5px;line-height:1.5}
.elq-options{display:flex;flex-direction:column;gap:8px;margin:0 0 12px;padding:0;list-style:none}
.elq-option{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid #d9ded9;border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s;background:#fbfcfb}
.elq-option:hover{border-color:#2f6f57}
.elq-option.is-picked{border-color:#2f6f57;background:#eef5f0}
.elq-option.is-correct{border-color:#2e7d32;background:#e9f5ea}
.elq-option.is-incorrect{border-color:#c04c3e;background:#faece9}
.elq-option input{margin:3px 0 0;accent-color:#2f6f57}
.elq-letter{font-weight:700;color:#2f6f57;min-width:16px}
.elq-result{border-radius:12px;padding:12px 14px;margin:0 0 12px}
.elq-result.result-correct{background:#e9f5ea}
.elq-result.result-incorrect{background:#faece9}
.elq-result p{margin:6px 0}
.elq-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.elq-button{font:inherit;cursor:pointer;border-radius:999px;padding:9px 16px;border:1px solid #cfd6cf;background:#fff}
.elq-button:hover{background:#f0f4f0}
.elq-button.primary{background:#206452;border-color:#206452;color:#fff}
.elq-button.primary:hover{background:#18503f}
.elq-score{font-size:26px;margin:8px 0}
.elq-miss{border:1px solid #e3e7e2;border-radius:12px;padding:10px 14px;margin:8px 0;background:#fbfcfb}
.elq-miss p{margin:5px 0}
.elq-busy{display:flex;align-items:center;gap:8px;color:#3f5a4e;margin:10px 0}
.elq-dot{width:9px;height:9px;border-radius:50%;background:#2f6f57;animation:elq-pulse 1s infinite alternate}
@keyframes elq-pulse{from{opacity:.35}to{opacity:1}}
.elq-error{color:#a54236;background:#faece9;border-radius:10px;padding:10px 12px;margin:10px 0}
.elq-source{max-height:110px;overflow:auto;font-size:12.5px;color:#4a5a52;background:#f6f8f6;border-radius:10px;padding:9px 11px;margin:0 0 10px;white-space:pre-wrap}
.elq-reference{border-left:3px solid #2f6f57;padding:8px 10px;margin:8px 0;background:#f6f8f6;color:#334a3e;white-space:pre-wrap}
@media(prefers-color-scheme:dark){.elq-shell{background:#242426;color:#f5f5f7;box-shadow:0 18px 60px #000a}.elq-eyebrow,.elq-count,.elq-hint{color:#9fb0a8}.elq-option{background:#2c2c2e;border-color:#48484a}.elq-option.is-picked{background:#1f3a2e;border-color:#3f8f6f}.elq-option.is-correct{background:#1e3323;border-color:#4e9b57}.elq-option.is-incorrect{background:#3c2622;border-color:#b0574a}.elq-letter{color:#7fc39f}.elq-result.result-correct{background:#1e3323}.elq-result.result-incorrect{background:#3c2622}.elq-button{background:#2c2c2e;border-color:#48484a;color:#f5f5f7}.elq-button:hover{background:#3a3a3c}.elq-button.primary{background:#2f6f57;border-color:#2f6f57;color:#fff}.elq-miss{background:#2c2c2e;border-color:#48484a}.elq-source{background:#1c1c1e;color:#c9d2cc}.elq-reference{background:#1c1c1e;color:#c9d2cc}.elq-error{background:#3c2622;color:#f2b8b0}.elq-busy{color:#9fb0a8}}`;

export type QuizSource = { title: string; text: string; count: number };
export function QuizRunner({
  source,
  onClose,
  onNavigatePage,
  label = '整页测验',
  hint,
}: {
  source: QuizSource;
  onClose?: () => void;
  onNavigatePage?: (page: number) => void;
  label?: string;
  hint?: string;
}) {
  const [quiz, setQuiz] = useState<PageQuiz | null>(null);
  const [index, setIndex] = useState(0),
    [picked, setPicked] = useState(''),
    [revealed, setRevealed] = useState(false);
  const [misses, setMisses] = useState<PageQuiz['questions']>([]),
    [finished, setFinished] = useState(false);
  const [sourceOpened, setSourceOpened] = useState(false),
    [assistedCorrect, setAssistedCorrect] = useState(0);
  const [practiceQuestions, setPracticeQuestions] = useState<PageQuiz['questions']>([]);
  const [retryRound, setRetryRound] = useState(false);
  const [firstResult, setFirstResult] = useState<{
    correct: number;
    total: number;
    independent: number;
  } | null>(null);
  const { busy, error, run } = useAction();
  const started = useRef(false);
  const generate = useCallback(() => {
    setQuiz(null);
    setIndex(0);
    setPicked('');
    setRevealed(false);
    setMisses([]);
    setFinished(false);
    setSourceOpened(false);
    setAssistedCorrect(0);
    setPracticeQuestions([]);
    setRetryRound(false);
    setFirstResult(null);
    void run(
      '正在扫描正文并出题…',
      () =>
        rpc<PageQuiz>('AI', {
          request: {
            operation: 'pageQuiz',
            count: source.count,
            context: {
              title: source.title.slice(0, 500),
              heading: '',
              text: source.text,
              before: '',
              after: '',
            },
          },
        }),
      setQuiz,
    );
  }, [source.count, source.title, source.text, run]);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      generate();
    }
  }, [generate]);
  function pick(id: string) {
    if (revealed || !quiz) return;
    setPicked(id);
    setRevealed(true);
    if (id !== quiz.questions[index].correctOption)
      setMisses((prev) => [...prev, quiz.questions[index]]);
    else if (sourceOpened) setAssistedCorrect((n) => n + 1);
    if (id !== quiz.questions[index].correctOption || sourceOpened)
      setPracticeQuestions((prev) => [...prev, quiz.questions[index]]);
  }
  function retryPractice() {
    if (!quiz || !practiceQuestions.length) return;
    if (!retryRound)
      setFirstResult({
        correct: quiz.questions.length - misses.length,
        total: quiz.questions.length,
        independent: quiz.questions.length - misses.length - assistedCorrect,
      });
    setQuiz({ questions: practiceQuestions });
    setRetryRound(true);
    setPracticeQuestions([]);
    setIndex(0);
    setPicked('');
    setRevealed(false);
    setMisses([]);
    setFinished(false);
    setSourceOpened(false);
    setAssistedCorrect(0);
  }
  function next() {
    if (!quiz) return;
    if (index + 1 >= quiz.questions.length) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setPicked('');
    setRevealed(false);
    setSourceOpened(false);
  }
  const question = quiz?.questions[index];
  const correct = question?.options.find((option) => option.id === question.correctOption);
  const evidence = question && findSourceEvidence(source.text, question.evidence);
  return (
    <section className="elq-shell" aria-label={label}>
      <style>{QUIZ_CSS}</style>
      <div className="elq-head">
        <span className="elq-eyebrow">{label}</span>
        <span className="elq-count">
          {quiz ? (finished ? '已完成' : `第 ${index + 1} / ${quiz.questions.length} 题`) : ''}
        </span>
      </div>
      <h2 className="elq-title">
        {retryRound
          ? finished
            ? '重练完成'
            : '再练未独立答对的题'
          : finished
            ? '测验完成'
            : '检验一下理解'}
      </h2>
      <p className="elq-hint">
        {hint ?? '先凭记忆作答；答题后再核对原文。题目由 AI 生成，请检查依据。'}
      </p>
      {retryRound && (
        <p className="elq-hint">
          使用已有题目重练，不调用 AI。你已看过答案，本轮结果不能算作首次独立作答。
        </p>
      )}
      {onClose && !finished && (
        <div className="elq-actions" style={{ marginTop: '-8px', marginBottom: '4px' }}>
          <button className="elq-button" onClick={onClose}>
            收起
          </button>
        </div>
      )}
      {!quiz && !error && busy && (
        <p className="elq-busy" role="status">
          <span className="elq-dot" />
          正在根据整页内容出题…
        </p>
      )}
      {quiz && !finished && question && (
        <>
          {!revealed && (
            <details>
              <summary onClick={() => setSourceOpened(true)}>
                查看出题原文（本题将记为开卷）
              </summary>
              <div className="elq-source">{source.text}</div>
            </details>
          )}
          <h3 className="elq-question">{question.question}</h3>
          <ul className="elq-options" role="radiogroup" aria-label="选择一个答案">
            {question.options.map((option) => (
              <li
                key={option.id}
                className={`elq-option${picked === option.id ? (picked !== question.correctOption ? ' is-incorrect' : ' is-correct') : ''}${revealed && option.id === question.correctOption ? ' is-correct' : ''}`}
              >
                <label
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    cursor: revealed ? 'default' : 'pointer',
                    flex: 1,
                  }}
                >
                  <input
                    type="radio"
                    name={`elq-answer-${index}`}
                    value={option.id}
                    checked={picked === option.id}
                    disabled={revealed || !!busy}
                    onChange={() => pick(option.id)}
                  />
                  <span className="elq-letter" aria-hidden="true">
                    {option.id}
                  </span>
                  <span>{option.text}</span>
                </label>
              </li>
            ))}
          </ul>
          {revealed && (
            <div
              className={`elq-result${picked === question.correctOption ? ' result-correct' : ' result-incorrect'}`}
              role="status"
              aria-live="polite"
            >
              <strong>{picked === question.correctOption ? '答对了' : '再看看正确答案'}</strong>
              <p>
                <b>正确答案 · {correct?.id}</b>
                {correct ? `　${correct.text}` : ''}
              </p>
              <p>{question.explanation}</p>
              {evidence ? (
                <blockquote className="elq-reference">
                  原文{evidence.page ? ` · 第 ${evidence.page} 页` : ''}：{evidence.text}
                </blockquote>
              ) : (
                <p>未找到可核对的原文引用，请自行对照原文检查这道题。</p>
              )}
              {evidence?.page && onNavigatePage && (
                <button className="elq-button" onClick={() => onNavigatePage(evidence.page!)}>
                  查看第 {evidence.page} 页原文
                </button>
              )}
              <details>
                <summary>查看本次出题原文</summary>
                <div className="elq-source">{source.text}</div>
              </details>
            </div>
          )}
          <div className="elq-actions">
            {revealed && (
              <button className="elq-button primary" onClick={next}>
                {index + 1 >= quiz.questions.length ? '查看成绩' : '下一题'}
              </button>
            )}
          </div>
        </>
      )}
      {finished && quiz && (
        <>
          <p className="elq-score">
            {quiz.questions.length - misses.length} / {quiz.questions.length} 答对
          </p>
          <p>
            其中 {quiz.questions.length - misses.length - assistedCorrect} 题独立答对，
            {assistedCorrect} 题查看原文后答对。
            {retryRound
              ? '这里的“独立”只表示本轮未打开原文。'
              : '选择题成绩只能提示哪些地方值得再练。'}
          </p>
          {firstResult && (
            <p>
              首次作答：{firstResult.correct} / {firstResult.total} 答对，其中{' '}
              {firstResult.independent} 题未查看原文。
            </p>
          )}
          {misses.length === 0 ? (
            <p>可以试着不用选项，自己解释一个关键概念。</p>
          ) : (
            <>
              <p>回头再看这几处，比重新读一遍更省时间：</p>
              {misses.map((item, i) => {
                const cited = findSourceEvidence(source.text, item.evidence);
                return (
                  <div className="elq-miss" key={i}>
                    <p>
                      <b>{item.question}</b>
                    </p>
                    <p>
                      正确答案 · {item.correctOption}：
                      {item.options.find((option) => option.id === item.correctOption)?.text}
                    </p>
                    <p>{item.explanation}</p>
                    {cited ? (
                      <blockquote className="elq-reference">
                        原文{cited.page ? ` · 第 ${cited.page} 页` : ''}：{cited.text}
                      </blockquote>
                    ) : (
                      <p>这题没有可核对的原文引用。</p>
                    )}
                    {cited?.page && onNavigatePage && (
                      <button className="elq-button" onClick={() => onNavigatePage(cited.page!)}>
                        查看第 {cited.page} 页原文
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
          <div className="elq-actions">
            {practiceQuestions.length > 0 && (
              <button className="elq-button primary" onClick={retryPractice}>
                重练错题与开卷题 · {practiceQuestions.length}
              </button>
            )}
            <button className="elq-button" onClick={generate}>
              再考一轮 ↻（AI 重新出题）
            </button>
            {onClose && (
              <button className="elq-button primary" onClick={onClose}>
                完成
              </button>
            )}
          </div>
        </>
      )}
      <ActionStatus busy={busy} error={error} />
      {error && (
        <div className="elq-actions">
          <button className="elq-button" onClick={generate}>
            重新出题
          </button>
        </div>
      )}
    </section>
  );
}
