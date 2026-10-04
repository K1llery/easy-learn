import {
  defaultTranslationLanguage,
  translationLanguageInfo,
  type TranslationLanguage,
} from '../core/translation-languages';
import { TranslationLanguageSelect } from './translation-language';
import React, { useEffect, useRef, useState } from 'react';
import type { Explanation, TextContext } from '../core/types';
import { findSourceEvidence } from '../core/source-evidence';
import { QuickQuiz } from './quick-quiz';
import { useAction } from './use-action';
import { rpc } from './rpc';

export type ReadingAction = 'explain' | 'translate' | 'quiz';
export function ReaderStudy({
  context,
  mode,
  onClose,
  initialTargetLanguage = defaultTranslationLanguage,
}: {
  context: TextContext;
  mode: ReadingAction;
  onClose: () => void;
  initialTargetLanguage?: TranslationLanguage;
}) {
  const [targetLanguage, setTargetLanguage] = useState(initialTargetLanguage);
  const [result, setResult] = useState<Explanation | null>(null);
  const { busy, error, run } = useAction();
  const evidence = result && findSourceEvidence(context.text, result.evidence);
  function request() {
    void run(
      mode === 'translate' ? '正在翻译选段…' : '正在解释选段…',
      () =>
        rpc<Explanation>('AI', {
          request: {
            operation: 'explain',
            mode,
            context,
            ...(mode === 'translate' ? { targetLanguage } : {}),
          },
        }),
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
      {mode === 'translate' && (
        <>
          <TranslationLanguageSelect
            value={targetLanguage}
            disabled={!!busy}
            onChange={(language) => {
              setTargetLanguage(language);
              setResult(null);
            }}
          />
          <button disabled={!!busy} onClick={request}>
            翻译 / Translate
          </button>
        </>
      )}
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
              <p
                className="reader-study-result"
                lang={targetLanguage}
                dir={translationLanguageInfo(targetLanguage).direction}
              >
                {result.translation || result.explanation}
              </p>
            ) : (
              <>
                <h3>{result.meaning}</h3>
                {result.expansion && <p lang="en">{result.expansion}</p>}
                <p className="reader-study-result">{result.explanation}</p>
                {evidence ? (
                  <>
                    <blockquote>{evidence.text}</blockquote>
                    <p className="reader-hint">已在选段中找到引文，仍需判断它是否支持解释。</p>
                  </>
                ) : (
                  <p className="notice">这段解释没有可核对的原文引文，请展开选段原文自行检查。</p>
                )}
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
