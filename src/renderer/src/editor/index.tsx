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
import { getWorkerDiagnostics } from './monaco-workers'

/**
 * 編輯器 wrapper —— renderer 中唯一直接依賴 `monaco-editor` 的模組。
 *
 * 對外介面刻意不洩漏任何 monaco 型別：PRD §8.3 保留了退守 CodeMirror 6 的可能，
 * 屆時替換成本必須侷限在本模組內（design D3）。
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

    // 診斷用：語言 contribution 是否真的註冊進 Monaco。
    // 打包後的模組執行順序未必等同原始碼順序，若某個 contribution 沒生效，
    // 這裡會直接顯示出來，不必靠猜。
    host.dataset.monacoLanguages = String(monaco.languages.getLanguages().length)
    host.dataset.modelLanguage = editor.getModel()?.getLanguageId() ?? ''

    return () => {
      editor.getModel()?.dispose()
      editor.dispose()
    }
  }, [value, language, readOnly])

  return <div ref={hostRef} data-testid="code-editor" className={className} />
}

/**
 * 驗證 TypeScript language worker 是否真的活著。
 *
 * 語法高亮由主執行緒的 tokenizer 完成，看到顏色**不代表** worker 正常。
 * 這裡建立一個帶有型別錯誤的臨時 model，等 Monaco 回填診斷 marker ——
 * marker 只可能由 ts.worker 做完語意分析後產生，因此收到它就證明
 * `?worker` 的載入路徑在當前執行模式（dev http:// / build file://）下可用。
 *
 * 刻意不使用 `monaco.languages.typescript`：該 API 在 0.55 已標記 deprecated
 * （型別為 `{ deprecated: true }`），只有 runtime 還在。
 */
export async function probeTypeScriptWorker(timeoutMs = 15_000): Promise<string> {
  const uri = monaco.Uri.parse('inmemory://probe/worker-probe.ts')
  const model = monaco.editor.createModel('const probe: number = "型別錯誤"\n', 'typescript', uri)

  try {
    const settled = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        subscription.dispose()
        resolve(false)
      }, timeoutMs)

      const subscription = monaco.editor.onDidChangeMarkers((changed) => {
        if (!changed.some((u) => u.toString() === uri.toString())) return
        const markers = monaco.editor.getModelMarkers({ resource: uri })
        if (markers.length === 0) return
        clearTimeout(timer)
        subscription.dispose()
        resolve(true)
      })
    })

    const { errors } = getWorkerDiagnostics()
    if (errors.length > 0) return `worker-error: ${errors[0]}`
    return settled ? 'ok' : 'timeout'
  } finally {
    model.dispose()
  }
}

export { getWorkerDiagnostics }
