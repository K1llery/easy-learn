import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ReadingDocument } from '../reader/document';

export function ReaderDirectory({
  document,
  current,
  onNavigate,
}: {
  document: ReadingDocument;
  current: number;
  onNavigate: (index: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [locate, setLocate] = useState(0);
  const nav = useRef<HTMLElement>(null);
  const matches = useMemo(() => {
    const needle = query.normalize('NFKC').trim().toLowerCase();
    return document.sections.flatMap((section, index) =>
      section.title.normalize('NFKC').toLowerCase().includes(needle) ? [{ section, index }] : [],
    );
  }, [document, query]);

  useEffect(() => {
    if (!locate) return;
    const button = nav.current?.querySelector<HTMLButtonElement>('[aria-current="page"]');
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [locate]);

  return (
    <aside className="reader-sidebar">
      <div className="reader-document-meta">
        <span className="tag">{document.format}</span>
        <h2>{document.title}</h2>
        <p className="muted">
          {document.sections.length} 个
          {document.structure === 'fragments' ? '阅读片段' : '阅读章节'}
          {document.pageCount ? ` · ${document.pageCount} 页` : null}
        </p>
      </div>
      <div className="reader-directory-tools">
        <div className="row">
          <span className="eyebrow">目录</span>
          <button
            className="quiet"
            onClick={() => {
              setQuery('');
              setLocate((n) => n + 1);
            }}
          >
            定位当前章节
          </button>
        </div>
        <input
          type="search"
          aria-label="搜索章节标题"
          placeholder="搜索章节标题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <div className="reader-filter-count" role="status">
            找到 {matches.length} 个章节
          </div>
        )}
      </div>
      <nav ref={nav} aria-label="章节目录">
        {matches.map(({ section, index }) => (
          <button
            key={section.id}
            data-depth={section.depth ?? 0}
            aria-current={index === current ? 'page' : undefined}
            onClick={() => onNavigate(index)}
          >
            {section.title}
          </button>
        ))}
      </nav>
      {!matches.length && <p className="reader-hint">没有匹配的章节。试试更短的标题关键词。</p>}
    </aside>
  );
}
