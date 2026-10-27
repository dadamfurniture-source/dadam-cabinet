import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// jest 로 도는 시험 · 시험 도우미 (jsdom 환경이라 브라우저 전역도 쓴다)
const JEST_FILES = ['__tests__/**', 'test-utils/**', 'jest.setup.js'];
// 시험 파일 — 위 + 워커의 node:test 시험
const TEST_FILES = [...JEST_FILES, 'workers/*/test/**'];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'node_modules/',
      '*.min.js',
      'js/**/*',
      // 옛 3D 플래너 빌드 산출물
      'planner/embed/**',
      // 자체 package.json · eslint · CI(mcp-server-ci.yml)가 있는 하위 패키지
      'mcp-server/**',
      // 옛 3D 플래너 (수정 금지 · 참고용)
      'lib/planner.ts',
    ],
  },
  {
    // 쓰이지 않는 eslint-disable 주석 보고 (예전 CLI 의 --report-unused-disable-directives)
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        React: 'readonly',
        JSX: 'readonly',
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLFormElement: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        CustomEvent: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        RequestInit: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
      },
    },
    plugins: {
      react: react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // CommonJS 파일은 require 를 쓴다 (typescript-eslint v8 에서 no-var-requires → no-require-imports)
    files: ['**/*.js', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // 저장소 도구 · 설정 파일 — node 에서 돈다
    files: ['scripts/**', 'tools/**', 'design-system/**', '*.config.{js,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Cloudflare Workers (+ 워커 시험은 node:test)
    files: ['workers/**'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.node } },
  },
  {
    files: JEST_FILES,
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.jest } },
  },
  {
    // 시험 파일 · tools/ 의 node 스크립트는 /* global … */ 주석과 eslint-disable 주석을 넉넉히 단다 —
    //   전역 설정과 겹치는 /* global */ 과, 지금 꺼진 규칙을 끄는 주석은 문제로 치지 않는다
    files: [...TEST_FILES, 'tools/**'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  prettier
);
