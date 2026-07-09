import type { Environment } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * Monaco 透過全域 MonacoEnvironment.getWorker 取得 worker 實例。
 * Vite 的 `?worker` 後綴會把每個 worker 打包成獨立 chunk 並產生對應的載入器 ——
 * 這正是 PRD §13 標記為風險的那段設定：dev 走 http:// 的 module worker、
 * build 後走 file://，載入路徑不同，必須分別驗證（見 scripts/probe-editor.mjs）。
 */

const created: string[] = []
const errors: string[] = []

/** worker script 若載入失敗，錯誤只會出現在 worker 的 error 事件，不會拋到主執行緒 */
function track(worker: Worker, label: string): Worker {
  created.push(label)
  worker.addEventListener('error', (event) => {
    errors.push(`${label}: ${event.message || 'worker load error'}`)
  })
  return worker
}

const environment: Environment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') {
      return track(new TsWorker(), label)
    }
    return track(new EditorWorker(), label)
  },
}

;(self as unknown as { MonacoEnvironment: Environment }).MonacoEnvironment = environment

export function getWorkerDiagnostics(): { created: string[]; errors: string[] } {
  return { created: [...created], errors: [...errors] }
}
