import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 主行程與 preload：Node 環境
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'electron.vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // renderer：瀏覽器環境 + React Hooks 規則
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // 編輯器套件只能經由 wrapper 取用（workspace-app-shell 的 requirement）。
  // 靠人工 grep 把關撐不住 —— 這條規則讓違反在 CI 就被擋下。
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/editor/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['monaco-editor', 'monaco-editor/**'],
              message:
                '編輯器套件只能由 src/renderer/src/editor/ 這個 wrapper 直接引用；其餘模組請透過它的介面取用，以確保退守 CodeMirror 6 的成本侷限於單一模組。',
            },
          ],
        },
      ],
    },
  },

  // 驗收腳本：Node 環境的純 JS，不做型別檢查
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      // probe 腳本刻意以 top-level await 驅動流程
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
)
