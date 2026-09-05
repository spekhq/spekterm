import type { ScanResult } from './transcript-archive'
import type { ScanErrorCode, ScanRequest, WorkerOutbound } from './insights-worker'

/**
 * 掃描行程的生命週期管理（主行程這一側）。
 *
 * ## 單一併發，重複觸發回報「進行中」而不排隊
 *
 * 觸發點有兩個：app 啟動後的那一趟（不論使用者要不要看，見規格），以及使用者開啟呈現介面時。
 * 兩者可能重疊。排隊的話，使用者按一下就多欠一次 24 秒的掃描；而**同一份來源連掃兩次的結果
 * 完全相同**，第二次沒有任何價值。
 *
 * ## 逾時是必要的，不是防禦性程式設計
 *
 * 掃描行程卡住時，「進行中」這個狀態會永遠停在那裡，而畫面上它與「正在跑，快好了」一模一樣。
 * 規格因此要求可區分：逾時後回報**失敗**，不是永遠進行中。
 *
 * ## 行程的注入
 *
 * `utilityProcess` 只存在於 Electron 執行期，單元測試裡沒有。`spawn` 因此是注入的 ——
 * 這不是為了測試而加的抽象，而是這一層真正的輸入：它管的是「一個會送訊息、會結束的東西」，
 * 至於那是不是 Electron 的 utility process 與它無關。
 */

/** 主行程眼中的掃描行程。與 `utilityProcess` 的介面對齊。 */
export interface WorkerHandle {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  kill(): void
}

export type ScanPhase = 'idle' | 'running' | 'failed'

export interface ScanStatus {
  phase: ScanPhase
  /** 最近一次成功的結果。尚未成功過時為 `null`。 */
  last: ScanResult | null
  /** 最近一次失敗的錯誤碼。`phase` 非 `failed` 時為 `null`。 */
  error: ScanErrorCode | 'scanTimeout' | 'workerExited' | null
}

export type ScanOutcome =
  | { ok: true; result: ScanResult; started: true }
  /** 已經有一次掃描在跑 —— 這一次沒有被排隊，也沒有失敗。 */
  | { ok: true; result: null; started: false }
  | { ok: false; code: ScanErrorCode | 'scanTimeout' | 'workerExited'; started: true }

export interface ScanRunnerOptions {
  spawn: () => WorkerHandle
  /** 逾時（毫秒）。首次全掃實測約 24 秒，預設留足夠餘裕。 */
  timeoutMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export class ScanRunner {
  readonly #spawn: () => WorkerHandle
  readonly #timeoutMs: number
  readonly #setTimer: (fn: () => void, ms: number) => unknown
  readonly #clearTimer: (handle: unknown) => void

  #phase: ScanPhase = 'idle'
  #last: ScanResult | null = null
  #error: ScanStatus['error'] = null

  constructor(options: ScanRunnerOptions) {
    this.#spawn = options.spawn
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  status(): ScanStatus {
    return { phase: this.#phase, last: this.#last, error: this.#error }
  }

  async run(request: ScanRequest): Promise<ScanOutcome> {
    if (this.#phase === 'running') return { ok: true, result: null, started: false }

    this.#phase = 'running'
    this.#error = null

    let worker: WorkerHandle
    try {
      worker = this.#spawn()
    } catch {
      this.#phase = 'failed'
      this.#error = 'workerExited'
      return { ok: false, code: 'workerExited', started: true }
    }

    return new Promise<ScanOutcome>((resolve) => {
      let settled = false
      const finish = (outcome: ScanOutcome) => {
        if (settled) return
        settled = true
        this.#clearTimer(timer)
        try {
          worker.kill()
        } catch {
          // 已經結束的行程 kill 不動 —— 那正是我們要的狀態。
        }
        resolve(outcome)
      }

      const timer = this.#setTimer(() => {
        this.#phase = 'failed'
        this.#error = 'scanTimeout'
        finish({ ok: false, code: 'scanTimeout', started: true })
      }, this.#timeoutMs)

      worker.on('message', (raw: unknown) => {
        const message = raw as WorkerOutbound | undefined
        if (!message || typeof message !== 'object') return
        if (message.type === 'ready') {
          worker.postMessage({ type: 'scan', request })
          return
        }
        if (message.type === 'done') {
          this.#phase = 'idle'
          this.#last = message.result
          finish({ ok: true, result: message.result, started: true })
          return
        }
        if (message.type === 'error') {
          this.#phase = 'failed'
          this.#error = message.code
          finish({ ok: false, code: message.code, started: true })
        }
      })

      worker.on('exit', () => {
        // 行程在回報結果之前結束 —— 主行程存活，狀態回報為失敗而非永遠進行中。
        if (settled) return
        this.#phase = 'failed'
        this.#error = 'workerExited'
        finish({ ok: false, code: 'workerExited', started: true })
      })
    })
  }
}
