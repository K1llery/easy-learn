import React, {useMemo, useState} from 'react';
import type {WordRecord, WordStatus} from '../reader/vocabulary';

export function ReaderVocabulary({records, onRemove, onExport, onClose}: {
  records: Record<string, WordRecord>;
  onRemove: (key: string) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<WordStatus | 'all'>('all');
  const [language, setLanguage] = useState('all');
  const entries = useMemo(() => Object.entries(records), [records]);
  const languages = useMemo(() => [...new Set(entries.map(([, word]) => word.language))].sort(), [entries]);
  const visible = useMemo(() => {
    const needle = query.normalize('NFKC').trim().toLowerCase();
    return entries.filter(([, word]) => (status === 'all' || word.status === status)
      && (language === 'all' || word.language === language)
      && [word.word, word.meaning, word.summary, word.expansion, word.ambiguity].filter(Boolean).join('\n').normalize('NFKC').toLowerCase().includes(needle));
  }, [entries, query, status, language]);
  const learningCount = entries.filter(([, word]) => word.status === 'learning').length;
  return <section className="reader-message card reader-vocabulary" aria-label="生词本">
    <div className="row"><h2>生词本</h2><button className="quiet" aria-label="关闭生词本" onClick={onClose}>×</button></div>
    <p className="muted">已认识的词会在同语言阅读中隐藏。搜索和筛选只在本机完成。</p>
    <div className="reader-vocabulary-tools">
      <input type="search" aria-label="搜索生词和释义" placeholder="搜索单词、中文释义或英文全称…" value={query} onChange={e => setQuery(e.target.value)}/>
      <select aria-label="筛选词汇语言" value={language} onChange={e => setLanguage(e.target.value)}>
        <option value="all">全部语言</option>{languages.map(value => <option key={value} value={value}>{value}</option>)}
        {language !== 'all' && !languages.includes(language) && <option value={language}>{language}（暂无词汇）</option>}
      </select>
    </div>
    <div className="reader-vocabulary-status" role="group" aria-label="筛选词汇状态">
      {(['all', 'learning', 'known'] as const).map(value => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
        {value === 'all' ? `全部 · ${entries.length}` : value === 'learning' ? `学习中 · ${learningCount}` : `已认识 · ${entries.length - learningCount}`}
      </button>)}
    </div>
    <div className="reader-vocabulary-summary"><span className="muted" role="status">显示 {visible.length} / {entries.length} 条</span><button onClick={onExport} disabled={!learningCount}>导出到 Anki（TSV）</button></div>
    <p className="reader-hint">导出全部学习中的词汇，不受筛选影响；不含密钥和整篇原文。</p>
    {visible.map(([key, word]) => <div className="learned row" key={key}>
      <div><b>{word.word}</b><small> · {word.language} · {word.status === 'known' ? '已认识' : '学习中'}</small><p>{word.meaning}</p>
        {word.expansion && <p className="reader-expansion" lang="en">{word.expansion}</p>}
        {word.summary && <p className="muted">{word.summary}</p>}
        {word.ambiguity && <p className="muted">{word.ambiguity}</p>}</div>
      <button className="quiet" aria-label={`移除 ${word.word}`} onClick={() => onRemove(key)}>移除</button>
    </div>)}
    {!visible.length && <div className="notice">
      <p>{entries.length ? '没有匹配的词汇。' : '在原文中点击一个标注的单词，就能收进生词本。'}</p>
      {(query || status !== 'all' || language !== 'all') && <button className="quiet" onClick={() => {setQuery(''); setStatus('all'); setLanguage('all');}}>清除筛选</button>}
    </div>}
  </section>;
}
