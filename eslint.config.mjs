import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    'dist/**',
    'dist-workbench/**',
    'dist-workbench-server/**',
    'artifacts/**',
    '.cache/**',
    '.pnpm-store/**',
    'playwright-report/**',
    'test-results/**',
    'example/**',
    'tests/fixtures/**',
    '.venv/**',
    '.ruff_cache/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // 中文界面文案有意使用全角空格。
      'no-irregular-whitespace': ['error', { skipTemplates: true }],
    },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    // Playwright 用空对象显式声明测试不需要 fixture。
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/core/ai.ts', 'src/reader/document.ts'],
    // 对外错误只保留安全文案，避免携带服务商响应或原始文档解析错误。
    rules: { 'preserve-caught-error': 'off' },
  },
  prettier,
);
