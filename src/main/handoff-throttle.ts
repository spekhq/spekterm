/**
 * 交接直接建立 session 的次數上限 —— **全域，不以來源 session 為單位。**
 *
 * ## 為什麼是全域
 *
 * per-source 的計數在本能力的威脅模型下**沒有效力**：落點的根位置 agent 算得出來
 * （`SPEKTERM_EVENT_DIR` 已經把 userData 交給它了），它可以輪流寫進不同 session 的目錄，
 * 於是每一個計數器都不會累積 —— **而那正是這道上限唯一要擋的情境**（一個失控的 agent
 * 在每個 repo 開出 session）。
 *
 * ## 為什麼降級是「退回需要接受」而不是「拒絕」
 *
 * 拒絕會銷毀一件真實的工作交辦，而使用者確實可能在短時間內連續交接數件事。
 *
 * ## 為什麼狀態只在記憶體
 *
 * 它要擋的是**一次執行之內**的洗版，而那個 agent 與這個計數同生共死（關掉 app，pty 一定會死）。
 * 跨重啟保留只會在使用者下次開機時懲罰他。
 */
export interface ThrottleOptions {
  /** 一個窗內可直接建立幾個 session。**可注入** —— 驗收要造出「達到上限」這個前提。 */
  max?: number
  /** 窗長（毫秒）。**可注入**，同上。 */
  windowMs?: number
  now?: () => number
}

export class HandoffThrottle {
  readonly #max: number
  readonly #windowMs: number
  readonly #now: () => number
  #stamps: number[] = []

  constructor({ max = 8, windowMs = 60_000, now = Date.now }: ThrottleOptions = {}) {
    this.#max = max
    this.#windowMs = windowMs
    this.#now = now
  }

  /**
   * 這一則可不可以直接建立 session。可以的話**計入**。
   *
   * 呼叫端在「其餘全部檢查都通過之後」才問 —— 一則會被拒絕的交接不該吃掉一個名額。
   */
  take(): boolean {
    const now = this.#now()
    this.#stamps = this.#stamps.filter((stamp) => now - stamp < this.#windowMs)
    if (this.#stamps.length >= this.#max) return false
    this.#stamps.push(now)
    return true
  }
}
