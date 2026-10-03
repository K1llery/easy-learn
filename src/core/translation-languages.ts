import { z } from 'zod';

export const translationLanguages = [
  { code: 'zh-CN', label: '简体中文', name: 'Simplified Chinese', direction: 'ltr' },
  { code: 'zh-TW', label: '繁體中文', name: 'Traditional Chinese', direction: 'ltr' },
  { code: 'en', label: 'English', name: 'English', direction: 'ltr' },
  { code: 'fr', label: 'Français', name: 'French', direction: 'ltr' },
  { code: 'ja', label: '日本語', name: 'Japanese', direction: 'ltr' },
  { code: 'ko', label: '한국어', name: 'Korean', direction: 'ltr' },
  { code: 'de', label: 'Deutsch', name: 'German', direction: 'ltr' },
  { code: 'es', label: 'Español', name: 'Spanish', direction: 'ltr' },
  { code: 'pt', label: 'Português', name: 'Portuguese', direction: 'ltr' },
  { code: 'it', label: 'Italiano', name: 'Italian', direction: 'ltr' },
  { code: 'ru', label: 'Русский', name: 'Russian', direction: 'ltr' },
  { code: 'ar', label: 'العربية', name: 'Arabic', direction: 'rtl' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi', direction: 'ltr' },
  { code: 'vi', label: 'Tiếng Việt', name: 'Vietnamese', direction: 'ltr' },
  { code: 'id', label: 'Bahasa Indonesia', name: 'Indonesian', direction: 'ltr' },
  { code: 'th', label: 'ไทย', name: 'Thai', direction: 'ltr' },
] as const;
export type TranslationLanguage = (typeof translationLanguages)[number]['code'];
export const defaultTranslationLanguage: TranslationLanguage = 'zh-CN';
export const translationLanguageSchema = z.enum(
  translationLanguages.map((language) => language.code) as [
    TranslationLanguage,
    ...TranslationLanguage[],
  ],
);
export function translationLanguageInfo(value: unknown) {
  return (
    translationLanguages.find((language) => language.code === value) ?? translationLanguages[0]
  );
}
