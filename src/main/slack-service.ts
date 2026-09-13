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
 * 五分鐘的取捨：Slack 的 tier-3 方法每分鐘約 50 次，而一輪的呼叫數約為「頻道數 + 提及數 × 2」。
 * 五分鐘讓一個頻道很多的使用者也離速率上限很遠，而延遲對「沒有即時路徑」的情形可以接受。
 */
export const ROUND_INTERVAL_MS = 5 * 60_000

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

  constructor(deps: SlackServiceDeps) {
    this.#deps = deps
    this.#status = { ...this.#status, configured: isConfigured(deps) }
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
      outcome = await runBackfill(this.#backfillDeps(token))
    } catch (error) {
      // **這一層存在的唯一理由**：一個漏出去的 rejection 會變成未捕捉的 rejection。
      // 訊息刻意只帶錯誤的類別名 —— `String(error)` 可能含 request 的描述，而那含 header。
      console.error(`[slack] backfill round failed unexpectedly: ${(error as Error).name}`)
      this.#update({ configured: true, failure: this.#merge({ kind: 'transient', error: 'internal' }) })
      return
    }

    this.#channels = outcome.channels
    this.#update({
      configured: true,
      lastRoundAt: (this.#deps.now ?? Date.now)(),
      delivered: outcome.delivered,
      deferred: outcome.deferred,
      failure: outcome.failure === undefined ? undefined : this.#merge(outcome.failure),
    })

    // **憑證或權限有問題時不要再去開即時連線** —— 它一定也會失敗，而那只會讓同一個問題
    // 以第二種面貌再報一次（`realtime: degraded`），把真正的處置埋在噪音底下。
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
      now: this.#deps.now ?? (() => Date.now()),
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
