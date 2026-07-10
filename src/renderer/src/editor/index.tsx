import { useEffect, useRef } from 'react'
// 只取 API 與編輯器功能。語言的 tokenizer 由 `./languages` 一次引入；
// `editor.all.js` 不必顯式 import —— basic-languages 的 `_.contribution.js` 已把整套
// editor contribution 拉進來（實測：加與不加，建置產物只差 15 bytes）。
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import './languages'
import './monaco-workers'

/**
 * 編輯器 wrapper —— renderer 中唯一直接依賴 `monaco-editor` 的模組（由 eslint 的
 * `no-restricted-imports` 強制執行）。
 *
 * 對外介面刻意不洩漏任何 monaco 型別：PRD §8.3 保留了退守 CodeMirror 6 的可能，
 * 屆時替換成本必須侷限在本模組內。
 */

const THEME = 'spek-dark'

// 取自 docs/workspace-mockup.html 的 side panel 配色，使編輯器不會像是貼上去的另一個 app。
monaco.editor.defineTheme(THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#14181d',
    'editorGutter.background': '#14181d',
    'editorLineNumber.foreground': '#5b6675',
    'editorLineNumber.activeForeground': '#94a3b8',
    'editor.lineHighlightBackground': '#1b2027',
  },
})

/**
 * 依檔名判定語言。
 *
 * 直接問 monaco 已註冊的語言，而不是自己維護一張副檔名對照表 —— 那張表會與
 * `languages.ts` 引入的 81 種語言漂移，且每次升級 monaco 都要重新校對一次。
 */
export function resolveLanguage(fileName: string): string {
  const lower = fileName.toLowerCase()

  let best = ''
  let bestLength = 0

  for (const language of monaco.languages.getLanguages()) {
    for (const name of language.filenames ?? []) {
      if (lower === name.toLowerCase()) return language.id
    }
    for (const extension of language.extensions ?? []) {
      const suffix = extension.toLowerCase()
      // 最長者優先：`.d.ts` 應勝過 `.ts`
      if (lower.endsWith(suffix) && suffix.length > bestLength) {
        best = language.id
        bestLength = suffix.length
      }
    }
  }

  return best || 'plaintext'
}

export interface CodeViewerProps {
  /** 檔案內容 */
  value: string
  /** 用於判定語言。只讀檔名，不讀路徑語意。 */
  fileName: string
  className?: string
}

/**
 * 唯讀的程式碼檢視器。
 *
 * `readOnly` 擋住編輯指令，`domReadOnly` 連底層那個隱形 textarea 也一併設為唯讀 ——
 * 少了後者，輸入法或貼上仍可能改到 model。
 */
export function CodeViewer({ value, fileName, className }: CodeViewerProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const editor = monaco.editor.create(host, {
      readOnly: true,
      domReadOnly: true,
      theme: THEME,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineHeight: 18,
      lineNumbersMinChars: 3,
      folding: false,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    })
    editorRef.current = editor

    return () => {
      editor.getModel()?.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const previous = editor.getModel()
    // 換 model 而非 setValue：語言隨檔案改變，且新的 model 會重新觸發 worker 的 link 計算。
    const model = monaco.editor.createModel(value, resolveLanguage(fileName))
    editor.setModel(model)
    previous?.dispose()
  }, [value, fileName])

  return <div ref={hostRef} className={className} />
}
