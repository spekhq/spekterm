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
  costUsd: number | null
}

export type RunOutcome =
  | { ok: true; outcome: DelegateOutcome }
  | { ok: false; code: ReportErrorCode }

/**
 * 依賴的 JSON 欄位**列成一份完整清單**，每一個都經過實測（2026-09-05，`claude` 2.1.261）：
 * `result` / `is_error` / `subtype` / `total_cost_usd` / `permission_denials`。
 * **`session_id` 已不在清單上** —— 委派紀錄的刪除改為以專案目錄為單位（見 `report.ts`），
 * 因為失敗的那幾條路根本拿不到它，而失敗的那一趟同樣留下了紀錄。
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

/**
 * 委派行程的環境**白名單**：只有這裡列到的名字會被傳進去。
 *
 * ## 為什麼是白名單，而不是「剝掉幾個名字」
 *
 * 能改變 `claude` 認證來源或計費歸屬的環境變數，官方文件上目前約二十餘個，且持續增加
 * （`ANTHROPIC_PROFILE`、federation 那組、`ANTHROPIC_FOUNDRY_*`、`ANTHROPIC_AWS_*`、
 * `CLAUDE_CODE_USE_FOUNDRY` 都是近期才有的）。一份剝除清單需要有人定期比對官方文件，
 * **而漏補的徵狀是「一切正常」** —— 委派靜默改走別人的帳。`user-env.ts` 的檔頭記著同一條：
 * 黑名單會遺漏尚未存在的變數，且遺漏是靜默的。
 *
 * **也不採前綴法。** `terminal.ts` 記著「絕不以 `CLAUDE*` 前綴一概剝除」——
 * `CLAUDE_CODE_OAUTH_TOKEN` 是**訂閱**憑證，剝掉它不會換掉任何人的計費歸屬，
 * 只會讓以它為唯一憑證的訂閱使用者登不進去。它因此在下面的清單上。
 *
 * ## 刻意不在清單上的四類
 *
 * 1. **憑證與計費歸屬**（`ANTHROPIC_API_KEY` / `_AUTH_TOKEN` / `_BASE_URL` / `_PROFILE`、
 *    federation、`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY`、`ANTHROPIC_AWS_*`、
 *    `ANTHROPIC_FOUNDRY_*` …）—— 本模組存在的理由。
 * 2. **`SHELL`** —— 工具全關（`delegateArgs` 的 `--allowed-tools ''`）、非互動，它唯一可能
 *    生效的地方是 `apiKeyHelper` 的執行，**也就是一條憑證路徑**。實測不傳它照樣跑得起來。
 * 3. **`TERM`** —— 非互動、stdio 是 pipe、輸出走 `--output-format json`。實測不需要。
 * 4. **`XDG_CONFIG_HOME` 與 `NODE_OPTIONS`** —— 前者不在清單上是因為委派不需要它，
 *    **不是因為排除它提供了保護**（Anthropic profile 住在 `~/.config/anthropic`，
 *    檔案已經在那裡的話這條擋不住）；後者能改變 `claude` 這支程式的行為。
 *
 * ## 巢狀 Claude Code 的標記一併不在清單上
 *
 * 自一個 Claude Code session 之內啟動本應用程式時，`process.env` 實測帶著 11 個 `CLAUDE*`
 * 標記，其中 `CLAUDE_CODE_MESSAGING_SOCKET` / `_TOKEN` 是通往**父 session** 的通訊管道。
 * **這不需要額外處置 —— 那些名字不在清單上。**
 *
 * 白名單「夠不夠」已實測（2026-09-06、`claude` 2.1.263）：以 `env -i` 只給 `PATH` / `HOME` /
 * `USER` / `LOGNAME` / `LANG` 跑一趟真實的 `claude -p --output-format json`，exit 0 並取得回覆。
 */
const DELEGATE_ENV_ALLOWLIST = [
  // 認證憑證與設定都掛在家目錄底下。**沒有它委派一定失敗。**
  'HOME',
  // 使用者自身訂閱登入的長期 token（`claude setup-token`）。轉送它**維持**計費歸屬。
  'CLAUDE_CODE_OAUTH_TOKEN',
  // 行程執行環境的基本設定。
  'USER',
  'LOGNAME',
  'TMPDIR',
  // 地區設定。
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  // 網路代理與憑證信任 —— 公司網路裡少了這些連不出去。**它們決定「經過誰」而不是
  // 「算誰的帳」**，且與使用者自己終端機中的設定一致（他的互動式 claude 也在用同一組）。
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  // Windows 的最小集。**本 repo 無 Windows 實測**，但少了 `SYSTEMROOT` 連 Node 都起不來 ——
  // 現在列上去的成本是零，日後才發現的成本是一個只在 Windows 出現的啟動失敗。
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
] as const

/**
 * 建構委派行程的環境。**純函式** —— 三個輸入皆由呼叫端注入，理由與 `delegateArgs` 相同
 * （`spawnReportDelegate` 住在 `ipc/insights.ts`，那支 import electron，`node:test` 載入不起來）。
 *
 * **`processEnv` 必須是 `process.env` 本身，不可先展開成普通物件。** Node 對 `process.env`
 * 在 Windows 上是**大小寫不敏感**的代理；展開之後實際的鍵是 `Path`、`SystemRoot`、`Temp`，
 * 而這裡查的是大寫形式 —— 全部 `undefined`，委派連 `claude` 都找不到。
 *
 * `configDir` 為 `undefined` 代表**使用者沒有明確指定**設定目錄，那時 SHALL NOT 傳入任何值：
 * `claude` 的主設定檔在該變數未設定時是 `~/.claude.json`，設定之後是
 * `$CLAUDE_CONFIG_DIR/.claude.json` —— **兩者不是同一個檔**。合成一個「解析後的預設位置」
 * 傳進去會讓它找不到既有設定、就地建出一份空的，並可能輸出說明訊息而讓
 * `JSON.parse(stdout)` 整趟失敗（實測 2026-09-06）。
 */
export function delegateEnv(input: {
  processEnv: NodeJS.ProcessEnv
  userEnv: Readonly<Record<string, string>>
  configDir: string | undefined
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of DELEGATE_ENV_ALLOWLIST) {
    // 使用者互動 shell 的值優先於主行程的 —— 與此前的合併順序一致。
    const value = input.userEnv[key] ?? input.processEnv[key]
    if (value !== undefined) env[key] = value
  }
  // **`PATH` 取 `processEnv`，不是 `userEnv`。** `getUserEnv()` 結構上不含 `PATH`
  // （`user-env.ts` 把它拆走併進 `process.env.PATH`），而那一份是**超集**：
  // 使用者的項目前置、產物自身注入的在後。用 `userEnv.PATH` 會丟掉後者（而且恆為 undefined）。
  env.PATH = input.processEnv.PATH ?? ''
  // 明確指定時才傳。環境裡若另有一個 `CLAUDE_CONFIG_DIR`，它**不在白名單上**，
  // 因此不會從上面那個迴圈漏進來 —— 這裡的值是唯一的來源。
  if (input.configDir !== undefined) env.CLAUDE_CONFIG_DIR = input.configDir
  return env
}

export interface ReportRunnerOptions {
  spawn: (options: { configDir: string | undefined }) => DelegateHandle
  timeoutMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export class ReportRunner {
  readonly #spawn: (options: { configDir: string | undefined }) => DelegateHandle
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

  /**
   * 單一併發：已經有一趟在跑就回 `null`，**不排隊** —— 排隊等於使用者按一下就多欠一次費用。
   *
   * `options` 原封轉手給 `spawn`。**設定目錄由呼叫端解析一次後傳進來**，不在這裡自己求值 ——
   * 「委派寫紀錄的位置」與「我們刪紀錄的位置」必須來自同一次解析（見 `report.ts`）。
   */
  async run(input: string, options: { configDir: string | undefined }): Promise<RunOutcome | null> {
    if (this.#running) return null
    this.#running = true

    let handle: DelegateHandle
    try {
      handle = this.#spawn(options)
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
