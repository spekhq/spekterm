import type { RawClaim } from './report-verify'

/**
 * 委派的生命週期與回覆解析（主行程這一側，**不 import electron**）。
 *
 * 形狀比照 `insights-service.ts` 的 `ScanRunner`：注入 `spawn`、單一併發、可注入計時器、
 * 只回錯誤碼。理由相同再加一條：**外部行程的輸出可能含絕對路徑或帳號資訊**，而錯誤訊息會被
 * 畫到畫面上 —— 錯誤碼裡沒有路徑可放。
 *
 * **不重用掃描那支 `utilityProcess`。** 掃描行程的職責是解析一份會隨版本改變的格式
 * （崩潰隔離是它存在的理由）；委派則是等一個外部行程回話，它本來就在自己的行程裡。
 * 塞在一起會讓「掃描崩潰」與「委派逾時」共用一組狀態。
 */

/** 六種可區分的失敗。**「全部論斷被丟棄」不可與「成功但沒什麼好說的」混為一談。** */
export type ReportErrorCode =
  | 'cliMissing'
  | 'delegateFailed'
  | 'delegateTimeout'
  | 'unparsableReply'
  | 'allClaimsDiscarded'
  | 'toolUseAttempted'

/** 單趟委派的逾時。語料上限 600,000 字元時實際耗時遠小於此，留餘裕。 */
export const DELEGATE_TIMEOUT_MS = 15 * 60 * 1000

export interface DelegateHandle {
  /** 把語料寫進標準輸入並關閉它。 */
  send(input: string): void
  onStdout(listener: (chunk: string) => void): void
  onExit(listener: (code: number | null) => void): void
  /** 行程根本起不來（例如 CLI 不存在）。 */
  onError(listener: () => void): void
  kill(): void
}

export interface DelegateOutcome {
  /** 委派回覆的本體。 */
  result: string
  /** 用來算出要刪除的紀錄路徑。 */
  sessionId: string | null
  costUsd: number | null
}

export type RunOutcome =
  | { ok: true; outcome: DelegateOutcome }
  | { ok: false; code: ReportErrorCode }

/**
 * 依賴的 JSON 欄位**列成一份完整清單**，每一個都經過實測（2026-09-05，`claude` 2.1.261）：
 * `result` / `is_error` / `subtype` / `session_id` / `total_cost_usd` / `permission_denials`。
 * **模型不在清單裡** —— 報告記錄的是「本應用程式請求的模型」，那是我們自己傳出去的值。
 * **不要依賴 stderr 的文字**：它會隨版本與語言環境改變。
 */
export function parseDelegateOutput(stdout: string): RunOutcome {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return { ok: false, code: 'unparsableReply' }
  }
  if (raw === null || typeof raw !== 'object') return { ok: false, code: 'unparsableReply' }
  const o = raw as Record<string, unknown>

  // **權限拒絕紀錄非空 ⇒ 委派試圖動用工具。** 那與「這趟不會讀到 repo」這個前提直接矛盾 ——
  // 沒有這個狀態，那個前提就只是一個沒有人在看的宣稱。
  if (Array.isArray(o.permission_denials) && o.permission_denials.length > 0) {
    return { ok: false, code: 'toolUseAttempted' }
  }
  if (o.is_error === true || (typeof o.subtype === 'string' && o.subtype !== 'success')) {
    return { ok: false, code: 'delegateFailed' }
  }
  if (typeof o.result !== 'string') return { ok: false, code: 'unparsableReply' }

  return {
    ok: true,
    outcome: {
      result: o.result,
      sessionId: typeof o.session_id === 'string' ? o.session_id : null,
      costUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
    },
  }
}

const FENCE = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/

/**
 * 從委派的回覆本體取出論斷清單。
 *
 * **解析失敗即整份失敗，不產出半份報告。** 一份只有部分內容的讀後感與一份完整的在畫面上
 * 長得一樣，而使用者無從得知自己看的是哪一種。
 */
export function parseClaims(result: string): RawClaim[] | null {
  const body = FENCE.exec(result)?.[1] ?? result
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown> | null)?.claims
  if (!Array.isArray(list)) return null
  const out: RawClaim[] = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') return null
    const o = item as Record<string, unknown>
    if (typeof o.claim !== 'string' || typeof o.quote !== 'string') return null
    out.push({ claim: o.claim, quote: o.quote })
  }
  return out
}

/**
 * 委派的命令列參數。**抽成純函式是為了驗得到** —— `spawnReportDelegate` 住在
 * `ipc/insights.ts`，那支 import 了 electron，在單元測試裡載入不起來。
 *
 * 四項各對應一條規格：非互動模式、結構化輸出、關閉工具、記錄得下來的模型。
 */
export function delegateArgs(model: string): string[] {
  return ['-p', '--output-format', 'json', '--model', model, '--allowed-tools', '', '--permission-mode', 'plan']
}

export interface ReportRunnerOptions {
  spawn: () => DelegateHandle
  timeoutMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export class ReportRunner {
  readonly #spawn: () => DelegateHandle
  readonly #timeoutMs: number
  readonly #setTimer: (fn: () => void, ms: number) => unknown
  readonly #clearTimer: (handle: unknown) => void
  #running = false

  constructor(options: ReportRunnerOptions) {
    this.#spawn = options.spawn
    this.#timeoutMs = options.timeoutMs ?? DELEGATE_TIMEOUT_MS
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.#clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  get running(): boolean {
    return this.#running
  }

  /** 單一併發：已經有一趟在跑就回 `null`，**不排隊** —— 排隊等於使用者按一下就多欠一次費用。 */
  async run(input: string): Promise<RunOutcome | null> {
    if (this.#running) return null
    this.#running = true

    let handle: DelegateHandle
    try {
      handle = this.#spawn()
    } catch {
      this.#running = false
      return { ok: false, code: 'cliMissing' }
    }

    return new Promise<RunOutcome>((resolve) => {
      let settled = false
      let stdout = ''
      const finish = (outcome: RunOutcome) => {
        if (settled) return
        settled = true
        this.#running = false
        this.#clearTimer(timer)
        try {
          handle.kill()
        } catch {
          // 已經結束的行程 kill 不動 —— 那正是我們要的狀態。
        }
        resolve(outcome)
      }

      const timer = this.#setTimer(() => finish({ ok: false, code: 'delegateTimeout' }), this.#timeoutMs)

      handle.onStdout((chunk) => (stdout += chunk))
      handle.onError(() => finish({ ok: false, code: 'cliMissing' }))
      handle.onExit((code) => {
        if (code !== 0 && stdout.trim() === '') {
          finish({ ok: false, code: 'delegateFailed' })
          return
        }
        finish(parseDelegateOutput(stdout))
      })

      try {
        handle.send(input)
      } catch {
        finish({ ok: false, code: 'delegateFailed' })
      }
    })
  }
}
