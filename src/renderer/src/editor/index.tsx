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
 * 對外介面刻意不洩漏任何 monaco 型別（包括 `KeyMod` / `KeyCode`）：PRD §8.3 保留了退守
 * CodeMirror 6 的可能，屆時替換成本必須侷限在本模組內。
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

export interface CodeEditorProps {
  /** 當前應呈現的內容。它可能來自磁碟，也可能來自尚未存檔的 buffer。 */
  value: string
  /** 用於判定語言。只讀檔名，不讀路徑語意。 */
  fileName: string
  /** 唯讀時連底層那個隱形 textarea 也一併鎖上，否則輸入法或貼上仍可能改到 model。 */
  readOnly?: boolean
  onChange?: (text: string) => void
  /** `Cmd/Ctrl+S`。**必須在此註冊** —— monaco 會吃掉該按鍵，外層的 keydown 攔不到。 */
  onSave?: () => void
  className?: string
}

/**
 * 程式碼編輯器。
 *
 * 呼叫端以檔案路徑為 key 掛載它，因此一個實例的生命週期內只服務一個檔案。
 */
export function CodeEditor({
  value,
  fileName,
  readOnly = false,
  onChange,
  onSave,
  className,
}: CodeEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  // 以 ref 轉交回呼，讓編輯器不必因為父層每次 render 產生的新函式而重建。
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const editor = monaco.editor.create(host, {
      value,
      language: resolveLanguage(fileName),
      readOnly,
      domReadOnly: readOnly,
      // 關閉 native EditContext，改用經典的隱形 textarea 作為輸入通道。
      // 後者是 Monaco 多年的穩定路徑，且其 `readonly` 屬性會正確反映唯讀狀態 ——
      // native EditContext 的 `ime-text-area` 恆為 readonly，無從據以驗收。
      editContext: false,
      theme: THEME,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineHeight: 20,
      lineNumbersMinChars: 3,
      folding: false,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    })
    editorRef.current = editor

    const changeSubscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue())
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })

    return () => {
      changeSubscription.dispose()
      editor.getModel()?.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // 掛載一次。內容與唯讀狀態的後續變化由下面的 effect 套用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部造成的內容變化（重新載入磁碟、切換預覽/原始碼）。
  // 比對之後才寫入，否則使用者每打一個字都會被 setValue 重設游標。
  useEffect(() => {
    const editor = editorRef.current
    if (editor && editor.getValue() !== value) {
      editor.setValue(value)
    }
  }, [value])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, domReadOnly: readOnly })
  }, [readOnly])

  return <div ref={hostRef} className={className} />
}
