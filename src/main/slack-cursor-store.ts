import fs from 'node:fs'
import path from 'node:path'

/**
 * 每個頻道「已經看到哪裡」的水位。
 *
 * ## 它是**純粹的最佳化**，不是正確性的來源
 *
 * design D3(b) 的第一版把去重託付給水位（以及與它同居的快照），而那個設計有一個洞：
 * 會觸發重新推導的主要原因**正是水位遺失**，那時快照一起遺失。現在去重的權威是
 * **收件匣自己的紀錄**（`alreadyDelivered`），水位只決定「要掃多少訊息」。
 *
 * 因此**遺失水位的代價是多掃一遍，不是重複交付**。這個性質讓這份檔案可以用最簡單的方式處理
 * 損毀（丟掉、從回看範圍的起點重新開始），而不必為它做任何韌性設計。
 *
 * ## 水位只前進到「確實處理完」的位置
 *
 * 一輪的交付有上限（見 `slack-backfill`），達到上限時**水位 SHALL NOT 前進過那些還沒交付的
 * 提及** —— 否則它們永遠不會被看到，而那是一個靜默的漏件。
 */

export const SLACK_CURSORS_VERSION = 1

/** Slack 的 channel id 形狀。 */
const CHANNEL_ID = /^[A-Z0-9]{1,32}$/

/** Slack 的時間戳形狀（`1699999999.000100`）。 */
const TIMESTAMP = /^\d{1,20}(?:\.\d{1,10})?$/

interface PersistedCursors {
  version: number
  cursors: Record<string, string>
}

/**
 * 結構嚴格、個別項目寬容。**單一壞掉的水位只讓那個頻道重掃一遍**，不該讓其餘頻道也重掃
 * （那會把一次小損壞放大成一輪滿載的回補）。
 */
export function parseSlackCursors(raw: string): PersistedCursors | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const { version, cursors } = data as Record<string, unknown>
  if (version !== SLACK_CURSORS_VERSION) return null
  if (typeof cursors !== 'object' || cursors === null || Array.isArray(cursors)) return null

  const parsed: Record<string, string> = {}
  for (const [channel, ts] of Object.entries(cursors as Record<string, unknown>)) {
    if (!CHANNEL_ID.test(channel)) continue
    if (typeof ts !== 'string' || !TIMESTAMP.test(ts)) continue
    parsed[channel] = ts
  }
  return { version: SLACK_CURSORS_VERSION, cursors: parsed }
}

export class SlackCursorStore {
  #cursors: Record<string, string> = {}

  constructor(private readonly filePath: string) {}

  /** 讀取。**損毀就當作沒有水位** —— 代價只是多掃一遍，所以不做隔離保留。 */
  load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[slack] cursors unreadable, rescanning from the look-back start: ${String(error)}`)
      }
      this.#cursors = {}
      return
    }
    const parsed = parseSlackCursors(raw)
    if (!parsed) {
      console.error('[slack] cursors unparsable, rescanning from the look-back start')
      this.#cursors = {}
      return
    }
    this.#cursors = parsed.cursors
  }

  /** 某個頻道的水位；沒有就回 `undefined`（由呼叫端退回回看範圍的起點）。 */
  get(channelId: string): string | undefined {
    return this.#cursors[channelId]
  }

  /**
   * 前進一個頻道的水位。**只前進，不後退** —— 一次亂序的回報不該讓已經處理過的範圍重新打開。
   */
  advance(channelId: string, ts: string): void {
    if (!CHANNEL_ID.test(channelId) || !TIMESTAMP.test(ts)) return
    const current = this.#cursors[channelId]
    if (current !== undefined && Number(current) >= Number(ts)) return
    this.#cursors = { ...this.#cursors, [channelId]: ts }
    this.#save()
  }

  /** 目前所有水位（複本），供診斷與測試。 */
  all(): Readonly<Record<string, string>> {
    return { ...this.#cursors }
  }

  #save(): void {
    const tmp = `${this.filePath}.tmp`
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(
      tmp,
      `${JSON.stringify({ version: SLACK_CURSORS_VERSION, cursors: this.#cursors }, null, 2)}\n`,
      'utf8',
    )
    fs.renameSync(tmp, this.filePath)
  }
}
