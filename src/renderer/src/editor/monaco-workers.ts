import type { Environment } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

/**
 * Monaco 透過全域 MonacoEnvironment.getWorker 取得 worker 實例。
 * Vite 的 `?worker` 後綴會把每個 worker 打包成獨立 chunk 並產生對應的載入器 ——
 * dev 走 http:// 的 module worker、build 後走 file://，兩者載入路徑不同。
 *
 * **只有 `editor.worker`。** 語言服務 worker（`ts.worker` 等）不在此處，也不該回來 ——
 * 唯讀檢視不需要語意分析，見 `languages.ts` 的說明。
 *
 * `editor.worker` 並非只為語言服務而存在：`editorWorkerService` 為 `language: '*'` 註冊了
 * 一個內建的 link provider，它呼叫 worker 端的 `$computeLinks`。因此「開一個含 URL 的檔案，
 * 看到 URL 被標成連結」正是 worker 完成一次往返的證據 —— 而**看到語法高亮不是**，
 * tokenization 在主執行緒完成（Phase 0 的教訓）。
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
    return reportErrors(new EditorWorker(), label)
  },
}

;(self as unknown as { MonacoEnvironment: Environment }).MonacoEnvironment = environment
