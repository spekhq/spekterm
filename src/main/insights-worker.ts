import { scanTranscripts, type ScanResult } from './transcript-archive'

/**
 * 掃描行程的進入點。**這支檔案跑在一個獨立於主行程的行程裡**（`utilityProcess`）。
 *
 * ## 為什麼是獨立行程
 *
 * 首次掃描實測約 24 秒。同樣的工作放在主行程上就是 24 秒的 IPC 停擺 —— pty 的輸出、側欄的請求、
 * 所有東西一起卡住。但**決定性的理由是崩潰隔離而不是效能**：這個模組解析的是一份會隨版本改變的
 * 內部格式，它出事的機率高於這個 repo 裡其他任何模組，而它出事時使用者正在跑的 agent 不該跟著死。
 * `worker_threads` 擋得住阻塞，擋不住這一條。
 *
 * ## 只回傳錯誤碼，不回傳文案
 *
 * 這裡是主行程／preload／renderer 之外的第四個 realm。本 repo 的 i18n 於模組載入時初始化，
 * 而**未初始化的 `t()` 不拋錯，它回傳 `undefined`** —— 畫面上就是一片空白。與其在第四個 realm
 * 再接一份字典（多一個「誰先載入」的不確定），一律回傳結構化的錯誤碼，文案由主行程或 renderer
 * 依既有字典組。這同時讓「錯誤訊息不得含絕對路徑」變得容易滿足：錯誤碼裡沒有路徑可放。
 */

export type ScanErrorCode = 'scanFailed'

export interface ScanRequest {
  projectsDir: string
  archiveRoot: string
  /** 要排除的專案目錄名後綴 —— 本應用程式委派留下的紀錄。 */
  excludeDirSuffix: string
}

export type WorkerOutbound =
  | { type: 'ready' }
  | { type: 'done'; result: ScanResult }
  | { type: 'error'; code: ScanErrorCode }

export type WorkerInbound = { type: 'scan'; request: ScanRequest }

/** 純函式：吃一則進來的訊息，吐一則要送回去的。抽出來讓它在 Electron 之外也測得到。 */
export function handleWorkerMessage(message: unknown): WorkerOutbound | null {
  if (message === null || typeof message !== 'object') return null
  const msg = message as Partial<WorkerInbound>
  if (msg.type !== 'scan') return null
  const request = msg.request
  // **每個欄位都要驗。** 漏掉 `excludeDirSuffix` 的後果是 `undefined` 傳進去、
  // `endsWith(undefined)` 在執行期拋錯或恆為 false —— 排除整個失效，而掃描照樣回一個
  // 看起來完全正常的結果，然後委派的偽訊息被當成使用者輸入永久寫進存檔。
  if (
    !request ||
    typeof request.projectsDir !== 'string' ||
    typeof request.archiveRoot !== 'string' ||
    typeof request.excludeDirSuffix !== 'string' ||
    request.excludeDirSuffix === ''
  ) {
    return { type: 'error', code: 'scanFailed' }
  }
  try {
    return { type: 'done', result: scanTranscripts(request) }
  } catch {
    // 這裡刻意不帶原始錯誤訊息 —— 它可能含絕對路徑，而它會被畫到畫面上。
    return { type: 'error', code: 'scanFailed' }
  }
}

/** `utilityProcess` 提供的通訊埠。以型別描述而非 import，讓這支檔案在測試中也載入得起來。 */
interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (parentPort) {
  parentPort.on('message', (event) => {
    const reply = handleWorkerMessage(event.data)
    if (reply) parentPort.postMessage(reply)
  })
  parentPort.postMessage({ type: 'ready' } satisfies WorkerOutbound)
}
