import React, { useEffect, useRef, useState } from 'react';
import type { Explanation, TextContext } from '../core/types';
import { QuickQuiz } from './quick-quiz';
import { useAction } from './use-action';
import { rpc } from './rpc';

export type ReadingAction = 'explain' | 'translate' | 'quiz';
export function ReaderStudy({
  context,
  mode,
  onClose,
}: {
  context: TextContext;
  mode: ReadingAction;
  onClose: () => void;
}) {
  const [result, setResult] = useState<Explanation | null>(null);
  const { busy, error, run } = useAction();
  function request() {
    void run(
      mode === 'translate' ? '正在翻译选段…' : '正在解释选段…',
      () => rpc<Explanation>('AI', { request: { operation: 'explain', mode, context } }),
      setResult,
    );
  }
  const initialAction = useRef({ mode, request });
  useEffect(() => {
    const { mode, request } = initialAction.current;
    if (mode !== 'quiz') request();
  }, []);
  return (
    <section className="reader-study card" aria-label="选段学习">
      <div className="row">
        <h2>{mode === 'quiz' ? '考考我' : mode === 'translate' ? '翻译选段' : '解释选段'}</h2>
        <button className="quiet" aria-label="关闭选段学习" onClick={onClose}>
          ×
        </button>
      </div>
      {mode === 'quiz' ? (
        <QuickQuiz context={context} active />
      ) : (
        <>
          <details>
            <summary>查看选段原文</summary>
            <div className="source">{context.text}</div>
          </details>
          {busy && <p role="status">{busy}</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button onClick={request}>重试</button>
            </div>
          )}
          {result &&
            (mode === 'translate' ? (
              <p className="reader-study-result">{result.translation || result.explanation}</p>
            ) : (
              <>
                <h3>{result.meaning}</h3>
                {result.expansion && <p lang="en">{result.expansion}</p>}
                <p className="reader-study-result">{result.explanation}</p>
                {result.evidence && <blockquote>{result.evidence}</blockquote>}
                {result.ambiguity && <p className="notice">{result.ambiguity}</p>}
                {result.example && <p>{result.example}</p>}
                {result.prerequisites.map((item, i) => (
                  <details key={i}>
                    <summary>{item.term}</summary>
                    <p>{item.explanation}</p>
                  </details>
                ))}
              </>
            ))}
        </>
      )}
    </section>
  );
}
