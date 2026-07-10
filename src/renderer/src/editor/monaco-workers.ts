import type { Environment } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * Monaco 透過全域 MonacoEnvironment.getWorker 取得 worker 實例。
 * Vite 的 `?worker` 後綴會把每個 worker 打包成獨立 chunk 並產生對應的載入器 ——
 * dev 走 http:// 的 module worker、build 後走 file://，兩者載入路徑不同。
 *
 * 兩種模式皆已於 Phase 0 實測通過。作法與那個反直覺的陷阱（看到語法高亮不代表
 * worker 存活，tokenization 在主執行緒完成）記錄於封存的
 * `openspec/changes/archive/2026-07-10-workspace-foundation-spike/design.md` D3。
 */

/** worker script 若載入失敗，錯誤只會出現在 worker 的 error 事件，不會拋到主執行緒 */
function reportErrors(worker: Worker, label: string): Worker {
  worker.addEventListener('error', (event) => {
    console.error(`[monaco] worker "${label}" 載入失敗：${event.message || 'unknown error'}`)
  })
  return worker
}

const environment: Environment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') {
      return reportErrors(new TsWorker(), label)
    }
    return reportErrors(new EditorWorker(), label)
  },
}

;(self as unknown as { MonacoEnvironment: Environment }).MonacoEnvironment = environment
