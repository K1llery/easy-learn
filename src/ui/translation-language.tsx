import React, { useEffect, useId, useState } from 'react';
import {
  defaultTranslationLanguage,
  translationLanguageInfo,
  translationLanguages,
  type TranslationLanguage,
} from '../core/translation-languages';
import { rpc, type SettingsResponse } from './rpc';

export function TranslationLanguageSelect({
  value,
  onChange,
  disabled = false,
  label = '译文语言 / Translate to',
}: {
  value: TranslationLanguage;
  onChange: (language: TranslationLanguage) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="translation-language">
      {label}
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(translationLanguageInfo(event.target.value).code)}
      >
        {translationLanguages.map((language) => (
          <option key={language.code} value={language.code} lang={language.code}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function useTranslationLanguage() {
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>(
    defaultTranslationLanguage,
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void rpc<SettingsResponse>('GET_SETTINGS')
      .then((settings) => {
        if (active)
          setTargetLanguage(
            translationLanguageInfo(settings.reading?.translationTargetLanguage).code,
          );
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return { targetLanguage, setTargetLanguage, ready };
}
