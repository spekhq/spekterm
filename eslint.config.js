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
