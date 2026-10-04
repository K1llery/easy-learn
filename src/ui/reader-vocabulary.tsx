import React, { useEffect, useMemo, useState } from 'react';
import {
  hasWordReference,
  vocabularyDueAt,
  type WordRecord,
  type WordStatus,
} from '../reader/vocabulary';
import { VocabularyReview, type VocabularyUpdate } from './vocabulary-review';

export function ReaderVocabulary({
  records,
  onRemove,
  onExport,
  onClose,
  onUpdate,
}: {
  records: Record<string, WordRecord>;
  onRemove: (key: string) => void;
  onExport: () => void;
  onClose: () => void;
  onUpdate: VocabularyUpdate;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<WordStatus | 'all'>('all');
  const [language, setLanguage] = useState('all');
  const [session, setSession] = useState<[string, WordRecord][] | null>(null);
  const [editing, setEditing] = useState<{ key: string; word: WordRecord; meaning: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  function update(key: string, expected: WordRecord, next: WordRecord) {
    try {
      onUpdate(key, expected, next);
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  const entries = useMemo(() => Object.entries(records), [records]);
  const languages = useMemo(
    () => [...new Set(entries.map(([, word]) => word.language))].sort(),
    [entries],
  );
  const visible = useMemo(() => {
    const needle = query.normalize('NFKC').trim().toLowerCase();
    return entries.filter(
      ([, word]) =>
        (status === 'all' || word.status === status) &&
        (language === 'all' || word.language === language) &&
        [word.word, word.meaning, word.summary, word.expansion, word.ambiguity]
          .filter(Boolean)
          .join('\n')
          .normalize('NFKC')
          .toLowerCase()
          .includes(needle),
    );
  }, [entries, query, status, language]);
  const learningCount = entries.filter(([, word]) => word.status === 'learning').length;
  const practice = visible.filter(
    ([, word]) => word.status === 'learning' && hasWordReference(word),
  );
  const due = practice
    .filter(([, word]) => vocabularyDueAt(word) <= now)
    .sort((a, b) => vocabularyDueAt(a[1]) - vocabularyDueAt(b[1]));
  const missing = visible.filter(
    ([, word]) => word.status === 'learning' && !hasWordReference(word),
  ).length;
  return (
    <section className="reader-message card reader-vocabulary" aria-label="生词本">
      <div className="row">
        <h2>生词本</h2>
        <button className="quiet" aria-label="关闭生词本" onClick={onClose}>
          ×
        </button>
      </div>
      {session ? (
        <VocabularyReview
          entries={session}
          records={records}
          onUpdate={onUpdate}
          onClose={() => {
            setSession(null);
            setNow(Date.now());
          }}
        />
      ) : (
        <>
          <p className="muted">已认识的词会在同语言阅读中隐藏。搜索和筛选只在本机完成。</p>
          <div className="reader-vocabulary-tools">
            <input
              type="search"
              aria-label="搜索生词和释义"
              placeholder="搜索单词、中文释义或英文全称…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="筛选词汇语言"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="all">全部语言</option>
              {languages.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
              {language !== 'all' && !languages.includes(language) && (
                <option value={language}>{language}（暂无词汇）</option>
              )}
            </select>
          </div>
          <div className="reader-vocabulary-status" role="group" aria-label="筛选词汇状态">
            {(['all', 'learning', 'known'] as const).map((value) => (
              <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
                {value === 'all'
                  ? `全部 · ${entries.length}`
                  : value === 'learning'
                    ? `学习中 · ${learningCount}`
                    : `已认识 · ${entries.length - learningCount}`}
              </button>
            ))}
          </div>
          <div className="reader-vocabulary-summary">
            <span className="muted" role="status">
              显示 {visible.length} / {entries.length} 条
            </span>
            <button onClick={onExport} disabled={!learningCount}>
              导出到 Anki（TSV）
            </button>
          </div>
          <p className="reader-hint">导出全部学习中的词汇，不受筛选影响；不含密钥和整篇原文。</p>
          <div className="card">
            <h3>把收藏的词，再想起一次</h3>
            <div className="actions">
              <button className="primary" disabled={!due.length} onClick={() => setSession(due)}>
                回忆到期生词 · {due.length}
              </button>
              <button disabled={!practice.length} onClick={() => setSession(practice)}>
                练习当前筛选 · {practice.length}
              </button>
            </div>
            <p className="reader-hint">练习遵循当前搜索、语言和状态筛选；已认识的词不进入复习。</p>
            {missing > 0 && (
              <p className="notice">{missing} 个学习中的词尚无释义，请先编辑补充，再开始回忆。</p>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {visible.map(([key, word]) => (
            <div className="learned row" key={key}>
              <div>
                <b>{word.word}</b>
                <small>
                  {' '}
                  · {word.language} · {word.status === 'known' ? '已认识' : '学习中'}
                </small>
                <p>{word.meaning}</p>
                {word.expansion && (
                  <p className="reader-expansion" lang="en">
                    {word.expansion}
                  </p>
                )}
                {word.summary && <p className="muted">{word.summary}</p>}
                {word.ambiguity && <p className="muted">{word.ambiguity}</p>}
                {word.context && (
                  <details>
                    <summary>收藏时的原文语境</summary>
                    <p lang={word.language}>{word.context}</p>
                  </details>
                )}
                {word.status === 'learning' && word.review && (
                  <p className="reader-hint">
                    已回忆 {word.review.count} 次 · 下次复习：
                    {new Date(word.review.dueAt).toLocaleDateString('zh-CN')}
                  </p>
                )}
                {editing?.key === key && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        update(key, editing.word, {
                          ...editing.word,
                          meaning: editing.meaning.trim(),
                        })
                      )
                        setEditing(null);
                    }}
                  >
                    <label htmlFor="word-meaning">{word.word} 的释义</label>
                    <textarea
                      id="word-meaning"
                      maxLength={300}
                      rows={2}
                      value={editing.meaning}
                      onChange={(event) => setEditing({ ...editing, meaning: event.target.value })}
                    />
                    <div className="actions">
                      <button type="submit">保存释义</button>
                      <button type="button" onClick={() => setEditing(null)}>
                        取消编辑
                      </button>
                    </div>
                  </form>
                )}
              </div>
              <div className="actions">
                <button
                  className="quiet"
                  aria-label={`编辑 ${word.word} 的释义`}
                  onClick={() => {
                    setError('');
                    setEditing({ key, word, meaning: word.meaning ?? '' });
                  }}
                >
                  编辑释义
                </button>
                <button
                  className="quiet"
                  aria-label={`${word.status === 'known' ? '重新学习' : '标为已认识'} ${word.word}`}
                  onClick={() =>
                    update(key, word, {
                      ...word,
                      status: word.status === 'known' ? 'learning' : 'known',
                    })
                  }
                >
                  {word.status === 'known' ? '重新学习' : '标为已认识'}
                </button>
                <button
                  className="quiet"
                  aria-label={`移除 ${word.word}`}
                  onClick={() => onRemove(key)}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
          {!visible.length && (
            <div className="notice">
              <p>
                {entries.length
                  ? '没有匹配的词汇。'
                  : '在原文中点击一个标注的单词，就能收进生词本。'}
              </p>
              {(query || status !== 'all' || language !== 'all') && (
                <button
                  className="quiet"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                    setLanguage('all');
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
