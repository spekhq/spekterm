import type { IntakeStore } from './intake-store'
import { SlackApi } from './slack-api'
import { type BackfillOutcome, runBackfill } from './slack-backfill'
import type { SlackCursorStore } from './slack-cursor-store'
import { writeDelivery } from './slack-deliver'
import type { SecretStore } from './secret-store'
import type { SlackSettingsStore } from './slack-settings-store'
import { secretName } from './slack-state'

/**
 * 把回補接到應用程式上。**這一層只做接線與閘門，邏輯在 `slack-backfill`。**
 *
 * ## 一輪的交付上限
 *
 * 收件匣的待處理總量上限是**暫時性拒絕**：超限的投遞原封留在落點、每次掃描被重讀一次，
 * 而 producer 若不自我節制就會繼續寫新檔。一個活躍的使用者離線一段時間後開機就會走到那裡。
 * 這個上限訂得比收件匣的總量上限小，於是**我們不會是那個把落點塞滿的人**。
 *
 * ## 不阻塞主行程
 *
 * 呼叫端不 await 它（`void`）。因此它**不得拋錯** —— 一個未捕捉的 rejection 在主行程裡是致命的
 * （主行程一死，它底下所有 pty 陪葬）。`runBackfill` 以回傳值呈現失敗，這裡再包一層 try。
 */

/** 一輪最多交付幾則。刻意小於收件匣的 `MAX_PENDING`（200）。 */
export const MAX_DELIVERIES_PER_ROUND = 25

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
}

/** 憑證齊備了嗎。**未設定不是錯誤** —— 使用者還沒設定而已，不該回報成失效。 */
export function isConfigured(deps: Pick<SlackServiceDeps, 'secrets'>): boolean {
  return deps.secrets.has(secretName('userToken'))
}

/**
 * 跑一輪回補。未設定憑證時什麼都不做並回 `null`（與「跑了但沒東西」不同 —— 呈現層要分得出來）。
 */
export async function runSlackRound(deps: SlackServiceDeps): Promise<BackfillOutcome | null> {
  const token = deps.secrets.get(secretName('userToken'))
  if (token === undefined) return null

  const api = new SlackApi({ baseUrl: deps.settings.apiBaseUrl(), token })

  try {
    return await runBackfill({
      api,
      cursorOf: (channelId) => deps.cursors.get(channelId),
      advanceCursor: (channelId, ts) => deps.cursors.advance(channelId, ts),
      rememberIdentity: (teamId, userId) => deps.settings.rememberIdentity(teamId, userId),
      // **去重的權威是收件匣自己的紀錄**（design D3(b)）—— 它的 `setState()` 只改狀態、
      // 不刪紀錄，於是接受過與忽略過的項目同樣答得出「進來過」。
      alreadyDelivered: (id) => deps.intake.get(deps.inboxAdapter, id) !== undefined,
      deliver: (delivery) => writeDelivery(deps.inboxRoot, delivery),
      lookbackDays: () => deps.settings.lookbackDays(),
      maxPerRound: MAX_DELIVERIES_PER_ROUND,
      now: deps.now ?? (() => Date.now()),
    })
  } catch (error) {
    // **這一層存在的唯一理由**：呼叫端不 await，所以一個漏出去的 rejection 會變成未捕捉的
    // rejection，而主行程一死所有 pty 陪葬。訊息刻意不帶憑證（它不在任何錯誤物件裡，
    // 但 `String(error)` 可能含 request 的描述）。
    console.error(`[slack] backfill round failed unexpectedly: ${(error as Error).name}`)
    return { delivered: 0, deferred: 0, channelsScanned: 0, failure: { kind: 'transient', error: 'internal' } }
  }
}
