import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // The website (`site/`) is its own package with its own type check; only its build scripts are linted
  // here, as plain Node modules (the rule for `scripts/` below). Without `site/**` the root `dist/**`
  // pattern would not cover `site/dist/`, and the built bundle would be linted.
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'site/**',
      '!site/scripts/',
      '!site/scripts/**/*.mjs',
      'site/scripts/fixtures/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 「解構出來丟掉」是省略欄位的慣用寫法（`const { secret: _s, ...rest } = x`）——
  // 被丟掉的那幾個名字本來就不該被使用，把它們算成「未使用的變數」是誤報。
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },

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

  // 檔案監看套件只能經由建立入口取用（watcher-error-reporting 的 requirement）。
  // 少了這道約束，每個站點會各自決定要不要掛錯誤處理 —— 而缺席的那個會讓主行程收到未捕捉例外。
  // 型別匯入放行：它取不到任何可以建立監看者的東西。
  {
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/watcher.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['chokidar', 'chokidar/**'],
              allowTypeImports: true,
              message:
                '檔案監看者一律經由 src/main/watcher.ts 建立 —— 錯誤處理與 followSymlinks 都在那裡，不由呼叫端決定。',
            },
          ],
        },
      ],
    },
  },

  // 驗收腳本：Node 環境的純 JS，不做型別檢查
  {
    files: ['scripts/**/*.mjs', 'site/scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      // probe 腳本刻意以 top-level await 驅動流程
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // electron-builder hooks: CommonJS, because the package is `"type": "module"` and the packager
  // `require`s its hooks
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
