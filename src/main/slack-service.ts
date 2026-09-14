import type { IntakeStore } from './intake-store'
import { SlackApi } from './slack-api'
import type { SlackFailure } from './slack-api'
import { type BackfillDeps, type BackfillOutcome, runBackfill } from './slack-backfill'
import type { SlackCursorStore } from './slack-cursor-store'
import { writeDelivery } from './slack-deliver'
import { SlackRealtime } from './slack-realtime'
import type { SecretStore } from './secret-store'
import type { SlackSettingsStore } from './slack-settings-store'
import { secretName } from './slack-state'

/**
 * 把回補與即時接到應用程式上，並持有**使用者看得到的狀態**。
 *
 * ## 一輪的交付上限
 *
 * 收件匣的待處理總量上限是**暫時性拒絕**：超限的投遞原封留在落點、每次掃描被重讀一次，
 * 而 producer 若不自我節制就會繼續寫新檔。這裡的上限訂得比收件匣的總量上限小，
 * 於是**我們不會是那個把落點塞滿的人**。
 *
 * ## 狀態的形狀是由一條 requirement 決定的
 *
 * 「失效」與「目前沒有待處理項目」在外部本來是同一個樣子：收件匣是空的。使用者分不出來就會
 * 在一件已經壞掉的事情上繼續等。因此狀態要能表達出**四種**情形，而不是一個布林：
 * 還沒設定 / 設定好了而目前沒事 / 暫時性失敗 / 憑證失效。
 *
 * **而警示必須有界**：同一種失效合併為一則並帶上次數，不逐次各發一則 ——
 * 使用者的注意力是這條管線僅有的兩道防線之一。
 *
 * ## 不阻塞主行程，也不拋錯
 *
 * 呼叫端不 await（`void`）。因此每一條路徑都不得拋錯 —— 一個未捕捉的 rejection 在主行程裡
 * 是致命的（主行程一死，它底下所有 pty 陪葬）。
 */

/** 一輪最多交付幾則。刻意小於收件匣的 `MAX_PENDING`（200）。 */
export const MAX_DELIVERIES_PER_ROUND = 25

/**
 * 兩輪回補之間的間隔。
 *
 * **沒有它，這個能力只在啟動的那一刻有效。** design D1 的降級模式寫的是「啟動時 **+ 週期輪詢**」，
 * 而第一版只做了前半 —— 實測踩到：使用者在 app 起來之後才貼上憑證，那一輪早就跑完了，
 * 而**不重開 app 就永遠不會有第二輪**。即時路徑是加速器、可能根本不可用（見 D1），
 * 所以週期輪詢不是備援而是主幹的一部分。
 *
 * 五分鐘的取捨：Slack 的速率上限是 **per method**，而一輪裡唯一隨規模線性成長的是
 * `conversations.history`（**每個頻道一次**）。間隔五分鐘 ⇒ 每分鐘最多一輪，於是即使頻道很多
 * 也離上限很遠；延遲對「沒有即時路徑」的情形可以接受。
 *
 * **縮短它現在是安全的操作**（issue #46 已清償）：被限流時會依對端的 `Retry-After` 退避，
 * 而且該輪不再詢問其餘頻道。縮短之後仍要重算的是**一輪的呼叫數與退避的關係** ——
 * 間隔若短於典型的 `Retry-After`，實際節奏就由對端決定而不是由這個常數決定。
 */
export const ROUND_INTERVAL_MS = 5 * 60_000

/**
 * 對端要求延後時的夾制。
 *
 * - **缺席時不是零。** 對端已經明確拒絕了，零等於不退避 —— 而那正是讓拒絕延長的做法。
 * - **上界不是「不相信 Slack」，是因為端點是使用者可設定的**（見 `slack-settings-store`）：
 *   一個回 `Retry-After: 99999999` 的端點會讓這個能力**無限期停擺**，而畫面上只會顯示
 *   「正在等待」。**一個能被輸入資料無限期關閉的能力，是一個可以被關掉的能力。**
 */
export const BACKOFF = { defaultSeconds: 60, minSeconds: 1, maxSeconds: 15 * 60 } as const

/** 把對端給的秒數（可能缺席、可能荒謬）夾成一個可用的值。 */
export function backoffSeconds(retryAfterSeconds: number | undefined): number {
  if (retryAfterSeconds === undefined || !Number.isFinite(retryAfterSeconds)) {
    return BACKOFF.defaultSeconds
  }
  return Math.min(Math.max(retryAfterSeconds, BACKOFF.minSeconds), BACKOFF.maxSeconds)
}

export interface SlackServiceDeps {
  settings: SlackSettingsStore
  secrets: SecretStore
  cursors: SlackCursorStore
  intake: IntakeStore
  /** 投遞落點的目錄。 */
  inboxRoot: string
  /** 收件匣對落點投遞所用的 adapter 名 —— 去重的主鍵是 `(adapter, id)`。 */
  inboxAdapter: string
  now?: () => number
  /** 狀態改變時通知（呈現層據此更新）。 */
  onStatusChanged?: () => void
  /**
   * 跑一輪回補 —— 預設為真正的 `runBackfill`。
   *
   * 注入點與 `SlackApi` 的 `fetchImpl`、`SlackRealtime` 的 `openSocket` 同一個形狀：
   * **退避的行為是「這一輪的結果如何影響下一輪」，而那在真實對端上造不出來**
   * （要真的去撞速率上限）。
   */
  backfill?: (deps: BackfillDeps) => Promise<BackfillOutcome>
}

/** 即時路徑的狀態。**`off` 與 `degraded` 必須分得出來** —— 前者是沒開，後者是壞了。 */
export type RealtimeState = 'off' | 'connected' | 'degraded'

/** 合併後的一則失效。**帶次數** —— 「而非多則」單獨在零則時也成立，那是一條紅不起來的斷言。 */
export interface SlackFailureNotice {
  kind: SlackFailure['kind']
  error: string
  count: number
  /**
   * 權限不足時，Slack 告訴我們**缺哪些 scope**。
   *
   * **這是這則訊息唯一可行動的部分。** 少了它，使用者看到的是「權限不足」而不知道要加什麼；
   * 而 Slack 在回應裡就給了它，只是第一版把它丟掉了。它是 scope 名稱的清單，不是憑證。
   */
  needed?: string
}

export interface SlackStatus {
  /** 憑證齊備了嗎。**未設定不是失效** —— 使用者還沒設定而已。 */
  configured: boolean
  /** 上一輪跑完的時間（毫秒）。`undefined` ＝還沒跑過。 */
  lastRoundAt?: number
  /** 上一輪交付了幾則。 */
  delivered: number
  /** 還有幾則因為每輪上限而沒交付 —— **使用者要看得到「還有東西沒進來」**。 */
  deferred: number
  /** 合併後的失效（最多一則）。 */
  failure?: SlackFailureNotice
  /**
   * 對端要求延後時，**下一次會去試的時間**（毫秒）。`undefined` ＝目前沒有在退避。
   *
   * **這個欄位存在是為了讓使用者的操作不落空。** 他存下憑證之後如果什麼都沒發生，
   * 那與「功能壞了」在畫面上完全相同 —— 而讓這兩者可區分正是這個能力花了一整條
   * requirement 在做的事。
   */
  retryAt?: number
  realtime: RealtimeState
}

/** 憑證齊備了嗎。 */
export function isConfigured(deps: Pick<SlackServiceDeps, 'secrets'>): boolean {
  return deps.secrets.has(secretName('userToken'))
}

/**
 * Slack 的執行期。持有狀態、跑回補、（可選地）維持即時連線。
 *
 * **即時是加速器**（design D1）：它連不上、斷了、事件格式變了 —— 全部只是降級，
 * 回補照樣把那段期間的提及補上。
 */
export class SlackRuntime {
  readonly #deps: SlackServiceDeps
  #status: SlackStatus = { configured: false, delivered: 0, deferred: 0, realtime: 'off' }
  #channels: Readonly<Record<string, string>> = {}
  #realtime: SlackRealtime | null = null
  #timer: ReturnType<typeof setInterval> | null = null
  /** 一輪還在跑時不要疊上另一輪 —— 那會讓速率上限與水位的推進同時變得難以推理。 */
  #running = false
  /** 對端要求延後到這個時間（毫秒）。`undefined` ＝沒有在退避。 */
  #retryAt: number | undefined

  constructor(deps: SlackServiceDeps) {
    this.#deps = deps
    this.#status = { ...this.#status, configured: isConfigured(deps) }
  }

  /** **時間一律走這裡** —— 直接呼叫 `Date.now()` 會讓假時鐘測不到，而症狀是測試通過但行為錯。 */
  #now(): number {
    return (this.#deps.now ?? Date.now)()
  }

  status(): SlackStatus {
    return { ...this.#status, failure: this.#status.failure ? { ...this.#status.failure } : undefined }
  }

  /**
   * 跑一輪回補，成功後（若 app-level token 也在）啟動即時連線。
   *
   * **不拋錯** —— 呼叫端不 await 它。
   */
  async runRound(): Promise<void> {
    // **不重入。** 週期輪詢、啟動那一輪、以及「使用者剛存了憑證」這三個觸發點可能重疊。
    if (this.#running) return
    // **對端要我們等到某個時間，就等到那個時間。** 被跳過的這一輪**不排隊補做** ——
    // 補做會在解禁的那一刻形成尖峰，正是這種拒絕存在的理由。而跳過不等於漏掉：
    // 水位機制保證這段期間發生的提及會在之後的取回中出現。
    if (this.#retryAt !== undefined) {
      if (this.#now() < this.#retryAt) {
        // 狀態要再推一次 —— 使用者剛才的操作必須在畫面上有回應（見 `retryAt` 的說明）。
        this.#update({})
        return
      }
      this.#retryAt = undefined
    }
    this.#running = true
    try {
      await this.#round()
    } finally {
      this.#running = false
    }
  }

  async #round(): Promise<void> {
    const token = this.#deps.secrets.get(secretName('userToken'))
    if (token === undefined) {
      this.#update({ configured: false, realtime: 'off' })
      return
    }

    let outcome: BackfillOutcome
    try {
      outcome = await (this.#deps.backfill ?? runBackfill)(this.#backfillDeps(token))
    } catch (error) {
      // **這一層存在的唯一理由**：一個漏出去的 rejection 會變成未捕捉的 rejection。
      // 訊息刻意只帶錯誤的類別名 —— `String(error)` 可能含 request 的描述，而那含 header。
      console.error(`[slack] backfill round failed unexpectedly: ${(error as Error).name}`)
      this.#update({ configured: true, failure: this.#merge({ kind: 'transient', error: 'internal' }) })
      return
    }

    this.#channels = outcome.channels
    // **退避的依據是 outcome 的獨立欄位，不是 `failure`** —— 後者是「先到的贏」，
    // 一個更早的網路錯誤會把速率上限遮掉（見 `BackfillOutcome.retryAfterSeconds`）。
    this.#retryAt =
      outcome.rateLimited === true
        ? this.#now() + backoffSeconds(outcome.retryAfterSeconds) * 1000
        : undefined

    this.#update({
      configured: true,
      lastRoundAt: this.#now(),
      delivered: outcome.delivered,
      deferred: outcome.deferred,
      failure: outcome.failure === undefined ? undefined : this.#merge(outcome.failure),
      retryAt: this.#retryAt,
    })

    // **憑證或權限有問題時不要再去開即時連線** —— 它一定也會失敗，而那只會讓同一個問題
    // 以第二種面貌再報一次（`realtime: degraded`），把真正的處置埋在噪音底下。
    //
    // **`rate_limited` 刻意不在這裡**：它與即時連線無關（Socket Mode 的事件流不走這條
    // 速率上限），而且它會自癒 —— 因為一次限流就不開即時連線，是把一個暫時的情形
    // 升級成一個更大的降級。
    if (outcome.failure?.kind === 'auth' || outcome.failure?.kind === 'scope') return
    await this.#startRealtime(token)
  }

  /**
   * 開始週期性地跑回補，並立刻跑第一輪。
   *
   * **`unref()` 是必要的**：一個被 ref 的 interval 會讓主行程在該關的時候關不掉。
   */
  start(): void {
    if (this.#timer !== null) return
    void this.runRound()
    this.#timer = setInterval(() => void this.runRound(), ROUND_INTERVAL_MS)
    this.#timer.unref?.()
  }

  /** 停止週期輪詢與即時連線（app 結束時）。 */
  async dispose(): Promise<void> {
    if (this.#timer !== null) {
      clearInterval(this.#timer)
      this.#timer = null
    }
    await this.#realtime?.stop()
    this.#realtime = null
  }

  #backfillDeps(token: NonNullable<ReturnType<SecretStore['get']>>): BackfillDeps {
    return {
      api: new SlackApi({ baseUrl: this.#deps.settings.apiBaseUrl(), token }),
      cursorOf: (channelId) => this.#deps.cursors.get(channelId),
      advanceCursor: (channelId, ts) => this.#deps.cursors.advance(channelId, ts),
      rememberIdentity: (teamId, userId) => this.#deps.settings.rememberIdentity(teamId, userId),
      // **去重的權威是收件匣自己的紀錄**（design D3(b)）—— 它的 `setState()` 只改狀態、
      // 不刪紀錄，於是接受過與忽略過的項目同樣答得出「進來過」。
      alreadyDelivered: (id) => this.#deps.intake.get(this.#deps.inboxAdapter, id) !== undefined,
      deliver: (delivery) => writeDelivery(this.#deps.inboxRoot, delivery),
      lookbackDays: () => this.#deps.settings.lookbackDays(),
      maxPerRound: MAX_DELIVERIES_PER_ROUND,
      now: () => this.#now(),
    }
  }

  async #startRealtime(token: NonNullable<ReturnType<SecretStore['get']>>): Promise<void> {
    const appToken = this.#deps.secrets.get(secretName('appToken'))
    // app-level token 沒設定 ⇒ 沒有即時路徑。**那不是失效** —— 回補照常運作。
    if (appToken === undefined) {
      this.#update({ realtime: 'off' })
      return
    }
    if (this.#realtime !== null) return

    const settings = this.#deps.settings.get()
    if (settings.teamId === undefined || settings.selfUserId === undefined) {
      this.#update({ realtime: 'off' })
      return
    }

    const realtime = new SlackRealtime({
      connections: new SlackApi({ baseUrl: this.#deps.settings.apiBaseUrl(), token: appToken }),
      backfill: this.#backfillDeps(token),
      channelNameOf: (channelId) => this.#channels[channelId],
      onDegraded: (failure) => {
        this.#update({ realtime: 'degraded', failure: this.#merge(failure) })
      },
    })

    let started = false
    try {
      started = await realtime.start({ teamId: settings.teamId, selfUserId: settings.selfUserId })
    } catch (error) {
      console.error(`[slack] realtime failed to start: ${(error as Error).name}`)
    }
    if (started) {
      this.#realtime = realtime
      this.#update({ realtime: 'connected' })
    } else {
      this.#update({ realtime: 'degraded' })
    }
  }

  /**
   * 合併失效。**同一種（kind + error）只留一則並累加次數。**
   *
   * 逐次各發一則會讓一次網路不穩把使用者的注意力用完 —— 而那是這條管線僅有的兩道防線之一。
   */
  #merge(failure: SlackFailure): SlackFailureNotice {
    const needed = failure.kind === 'scope' ? failure.needed : undefined
    const current = this.#status.failure
    if (current !== undefined && current.kind === failure.kind && current.error === failure.error) {
      return { ...current, count: current.count + 1, needed: needed ?? current.needed }
    }
    return { kind: failure.kind, error: failure.error, count: 1, needed }
  }

  #update(patch: Partial<SlackStatus>): void {
    this.#status = { ...this.#status, ...patch }
    this.#deps.onStatusChanged?.()
  }
}
