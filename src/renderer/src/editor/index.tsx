import { useEffect, useRef } from 'react'
// 只取 API 與編輯器功能，語言逐一挑選 —— `import * as monaco from 'monaco-editor'`
// 會把全部語言的 contribution（含 json/css/html 三支 worker）一併拉進 bundle。
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all.js'
// 語法高亮（monarch tokenizer）與語言服務是兩件事，各自來自不同的 contribution：
// basic-languages/* 提供 tokenizer，language/* 提供 worker 驅動的語意分析。
// 少了前者，編輯器只會有單一 token class（等於沒有高亮）。
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
import './monaco-workers'

/**
 * 編輯器 wrapper —— renderer 中唯一直接依賴 `monaco-editor` 的模組（由 eslint 的
 * `no-restricted-imports` 強制執行）。
 *
 * 對外介面刻意不洩漏任何 monaco 型別：PRD §8.3 保留了退守 CodeMirror 6 的可能，
 * 屆時替換成本必須侷限在本模組內。
 *
 * 本模組目前**無人引用** —— Phase 1 的版面沒有編輯器，Monaco 因此不進 renderer bundle。
 * 它保留在原處供 Phase 2／3 的 Files 檢視使用；屆時須連同封存的
 * `workspace-app-shell` 兩條 Monaco requirement 一併重新確立（見 CLAUDE.md 路線圖）。
 */

export type EditorLanguage = 'typescript' | 'javascript' | 'markdown'

export interface CodeEditorProps {
  value: string
  language: EditorLanguage
  readOnly?: boolean
  className?: string
}

export function CodeEditor({
  value,
  language,
  readOnly = true,
  className,
}: CodeEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const editor = monaco.editor.create(host, {
      value,
      language,
      readOnly,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
    })

    return () => {
      editor.getModel()?.dispose()
      editor.dispose()
    }
  }, [value, language, readOnly])

  return <div ref={hostRef} className={className} />
}
