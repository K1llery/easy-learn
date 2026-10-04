import React, { useRef, useState } from 'react';
import { REVIEW_DAYS } from '../core/learning';
import { reviewVocabularyWord, sameVocabularyRecord, type WordRecord } from '../reader/vocabulary';

export type VocabularyUpdate = (key: string, expected: WordRecord, next: WordRecord) => void;

export function VocabularyReview({
  entries,
  records,
  onUpdate,
  onClose,
}: {
  entries: [string, WordRecord][];
  records: Record<string, WordRecord>;
  onUpdate: VocabularyUpdate;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<[string, WordRecord][]>([]);
  const [round, setRound] = useState(entries);
  const [completed, setCompleted] = useState(0);
  const saving = useRef(false);
  const entry = round[index];
  const word = entry?.[1];
  const changed = entry && !sameVocabularyRecord(records[entry[0]], word);
  function next() {
    setIndex((value) => value + 1);
    setRevealed(false);
    setAnswer('');
    setError('');
  }
  function rate(rating: 'again' | 'remembered') {
    if (!entry || !revealed || changed || saving.current) return;
    saving.current = true;
    try {
      const updated = reviewVocabularyWord(entry[1], rating);
      onUpdate(entry[0], entry[1], updated);
      if (rating === 'again') setRetry((items) => [...items, [entry[0], updated]]);
      setCompleted((value) => value + 1);
      next();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
    }
  }
  return (
    <section className="vocabulary-review" aria-label="生词回忆">
      <div className="row">
        <h3>{word ? '先回忆，再看释义' : '本轮回忆完成'}</h3>
        <button className="quiet" onClick={onClose}>
          返回生词本
        </button>
      </div>
      {word ? (
        <>
          <p className="muted" role="status">
            第 {index + 1} / {round.length} 个 · {word.language}
          </p>
          <h2 lang={word.language}>{word.word}</h2>
          {changed ? (
            <div className="notice">
              <p>这条词汇已更新或移除，本次跳过。</p>
              <button onClick={next}>跳过此词</button>
            </div>
          ) : (
            <>
              <label htmlFor="vocabulary-recall">回忆词义或用法（可选）</label>
              <textarea
                id="vocabulary-recall"
                value={answer}
                maxLength={1000}
                rows={3}
                disabled={revealed}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="先在心里回忆，也可以写下来；想不起来就直接对照。"
              />
              {!revealed ? (
                <button className="primary" onClick={() => setRevealed(true)}>
                  显示释义
                </button>
              ) : (
                <>
                  <div className="card" aria-label="词汇参考">
                    {word.meaning && <p>{word.meaning}</p>}
                    {word.expansion && <p lang="en">{word.expansion}</p>}
                    {word.summary && <p>{word.summary}</p>}
                    {word.ambiguity && <p className="notice">{word.ambiguity}</p>}
                    {word.context && <blockquote lang={word.language}>{word.context}</blockquote>}
                  </div>
                  <div className="actions">
                    <button onClick={() => rate('again')}>还没想起 · 1 天后</button>
                    <button className="primary" onClick={() => rate('remembered')}>
                      能回忆 ·{' '}
                      {REVIEW_DAYS[Math.min((word.review?.step ?? -1) + 1, REVIEW_DAYS.length - 1)]}{' '}
                      天后
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <p role="status">
            已记录 {completed} 次回忆，{retry.length} 个词还需练习。
          </p>
          {retry.length > 0 && (
            <button
              className="primary"
              onClick={() => {
                setRound(retry);
                setRetry([]);
                setIndex(0);
                setCompleted(0);
              }}
            >
              重练未想起的词 · {retry.length}
            </button>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="reader-hint">
        回忆与自评只在本机完成，不调用 AI。间隔为复习建议；“能回忆”不会自动标为已认识。
      </p>
    </section>
  );
}
