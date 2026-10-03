import {
  defaultTranslationLanguage,
  translationLanguageInfo,
  type TranslationLanguage,
} from '../core/translation-languages';
import React, { memo, useEffect, useRef, useState } from 'react';
import type { Explanation, TextContext } from '../core/types';
import type { PdfPageText } from '../core/pdf-document';
import { sourcePdfPageUrl } from '../core/pdf-navigation';
import { rpc } from './rpc';
import { useAction } from './use-action';
import { QuickQuiz } from './quick-quiz';
import { MeaningCheck } from './meaning-check';

export const PdfPage = memo(function PdfPage({
  page,
  title,
  sourceUrl,
  targetLanguage = defaultTranslationLanguage,
  translationReady = true,
}: {
  page: PdfPageText;
  title: string;
  sourceUrl: string;
  targetLanguage?: TranslationLanguage;
  translationReady?: boolean;
}) {
  const targetRef = useRef(targetLanguage);
  targetRef.current = targetLanguage;
  const [mode, setMode] = useState<null | 'explain' | 'translate' | 'quiz' | 'check'>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null),
    [translation, setTranslation] = useState('');
  const [selectedText, setSelectedText] = useState(''),
    [selectionTruncated, setSelectionTruncated] = useState(false);
  const [usedText, setUsedText] = useState('');
  const [sourceExpanded, setSourceExpanded] = useState(false),
    [sourceOverflow, setSourceOverflow] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const { busy, error, run } = useAction();
  useEffect(() => {
    const source = sourceRef.current;
    if (!source || sourceExpanded) return;
    const measure = () => setSourceOverflow(source.scrollHeight > source.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(source);
    return () => observer.disconnect();
  }, [page.text, mode, sourceExpanded]);
  const context: TextContext = {
    title,
    heading: `第 ${page.page} 页`,
    text: page.text.slice(0, 16000),
    before: '',
    after: '',
  };
  function captureSelection() {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !sourceRef.current?.contains(range.commonAncestorContainer)) return;
    const text = selection!.toString().trim();
    if (!text) return;
    setSelectedText(text.slice(0, 4000));
    setSelectionTruncated(text.length > 4000);
  }
  useEffect(() => {
    setTranslation('');
  }, [targetLanguage]);
  function act(next: 'explain' | 'translate', excerpt?: string) {
    setMode(next);
    const focus = excerpt || context.text;
    setUsedText(excerpt || '');
    void run(
      next === 'translate' ? '正在翻译文字…' : '正在结合上下文解释…',
      () =>
        rpc<Explanation>('AI', {
          request: {
            operation: 'explain',
            mode: next,
            context: { ...context, text: focus },
            ...(next === 'translate' ? { targetLanguage } : {}),
          },
        }),
      (data) => {
        if (next === 'translate') {
          if (targetLanguage !== targetRef.current) return;
          setTranslation(data.translation || data.explanation);
          setExplanation(null);
        } else setExplanation(data);
      },
    );
  }
  const textPages = page.text.length > 16000;
  const originalPageUrl = sourcePdfPageUrl(sourceUrl, page.page);
  return (
    <section className="card" id={`pdf-page-${page.page}`} aria-label={`第 ${page.page} 页`}>
      <span className="tag">
        第 {page.page} 页{page.text ? '' : ' · 无文字'}
      </span>
      {page.text && mode !== 'quiz' ? (
        <>
          <div
            className="source"
            id={`pdf-source-${page.page}`}
            ref={sourceRef}
            style={{ maxHeight: sourceExpanded ? 'none' : 220 }}
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
          >
            {page.text}
          </div>
          {sourceOverflow && (
            <button
              className="quiet"
              aria-expanded={sourceExpanded}
              aria-controls={`pdf-source-${page.page}`}
              onClick={() => setSourceExpanded(!sourceExpanded)}
            >
              {sourceExpanded ? '收起本页文字' : '展开本页文字'}
            </button>
          )}
        </>
      ) : !page.text ? (
        <p className="muted">这一页没有可提取的文字（可能是图片）。</p>
      ) : null}
      {selectedText && mode !== 'quiz' && (
        <div className="notice" aria-label="PDF 选段操作">
          <p>
            已选中 {selectedText.length} 字符
            {selectionTruncated ? '（超过 4,000 字符，仅处理前 4,000 字符）' : ''}
            。正文只发送选中内容，另附文档标题和页码。
          </p>
          <div className="actions">
            <button
              disabled={!!busy || selectionTruncated || selectedText.length > 1200}
              onClick={() => setMode('check')}
            >
              先试着理解
            </button>
            <button disabled={!!busy} onClick={() => act('explain', selectedText)}>
              解释选中内容
            </button>
            <button
              disabled={!!busy || !translationReady}
              onClick={() => act('translate', selectedText)}
            >
              翻译选中内容
            </button>
            <button
              className="quiet"
              onClick={() => {
                setSelectedText('');
                setMode(null);
              }}
            >
              清除选段
            </button>
          </div>
          {selectedText.length > 1200 && <p>理解核对适合一两句话，请缩短选段至 1,200 字符以内。</p>}
        </div>
      )}
      {page.text && (
        <div className="actions">
          <button disabled={!!busy} onClick={() => act('explain')}>
            解释这一页
          </button>
          <button disabled={!!busy || !translationReady} onClick={() => act('translate')}>
            翻译这一页
          </button>
          <button
            disabled={!!busy}
            className={mode === 'quiz' ? 'primary' : ''}
            onClick={() => {
              setSelectedText('');
              setMode(mode === 'quiz' ? null : 'quiz');
            }}
          >
            考考这一页
          </button>
          {originalPageUrl && (
            <button
              className="quiet"
              onClick={() => void chrome.tabs.create({ url: originalPageUrl })}
            >
              查看原 PDF 本页
            </button>
          )}
        </div>
      )}
      {textPages && (
        <p className="muted">
          整页解释、翻译和快测仅使用本页前 16,000 字符；仍可选中后面的难句单独处理。
        </p>
      )}
      {busy && (
        <div className="busy" role="status">
          <span className="dot" />
          {busy}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {mode === 'check' && selectedText && (
        <MeaningCheck key={selectedText} context={{ ...context, text: selectedText }} />
      )}
      {mode === 'quiz' && page.text && <QuickQuiz context={context} active />}
      {explanation && mode === 'explain' && (
        <section className="card" aria-label={usedText ? '选段解释' : '本页解释'}>
          <span className="tag">{usedText ? '选段解释' : '本页解释'}</span>
          {usedText && <p className="source">{usedText}</p>}
          <h2 style={{ marginTop: 12 }}>{explanation.meaning}</h2>
          <p style={{ marginTop: 12 }}>{explanation.explanation}</p>
          {explanation.example && <p className="muted">例如：{explanation.example}</p>}
        </section>
      )}
      {translation && mode === 'translate' && (
        <section className="card" aria-label={usedText ? '选段翻译' : '本页翻译'}>
          <span className="tag">{translationLanguageInfo(targetLanguage).label}译文</span>
          {usedText && <p className="source">{usedText}</p>}
          <p
            lang={targetLanguage}
            dir={translationLanguageInfo(targetLanguage).direction}
            style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}
          >
            {translation}
          </p>
        </section>
      )}
    </section>
  );
});
