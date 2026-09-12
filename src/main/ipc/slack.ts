import { ipcMain } from 'electron'
import type { SecretStore } from '../secret-store'
import {
  type SlackState,
  type SlackTokenKind,
  isTokenKind,
  secretName,
  slackState,
} from '../slack-state'
import { DEFAULT_API_BASE_URL, DEFAULT_LOOKBACK_DAYS, type SlackSettingsStore } from '../slack-settings-store'

export const SLACK_CHANNELS = {
  get: 'workspace:slack:get',
  setToken: 'workspace:slack:setToken',
  setLookbackDays: 'workspace:slack:setLookbackDays',
  setApiBaseUrl: 'workspace:slack:setApiBaseUrl',
} as const

/**
 * Slack 連線設定的讀寫。
 *
 * **純邏輯不住在這裡** —— `slackState()` 與白名單判定在 `../slack-state.ts`。理由與
 * `report-runner` 的 `delegateEnv` 相同：本模組 import `electron`，於是 `node:test`
 * 載入不起來，而那會讓「IPC 回傳值整份不含憑證」這條斷言無處可放。
 *
 * ## 沒有「要偵測誰」與「哪個工作區」的 setter，而那是刻意的
 *
 * 兩者**自憑證推導**（`auth.test` 回傳它擁有者的身分），不是使用者設定 —— 見 design D14。
 * 一個填錯的「要偵測誰」，其症狀是**什麼都不會發生**，與「沒有人提及我」和「連線已失效」
 * 在畫面上完全相同；而讓後兩者可區分正是本能力花了一整條 requirement 在做的事。
 *
 * ## 端點有自己的 channel，不併進一個吃整份設定的 setter
 *
 * `secret-scope` 要求端點**只能由使用者明確操作改動**。一個吃整份物件的 `update()`
 * 會讓任何一次「改回看範圍」的呼叫**順帶**有能力改掉端點 —— 那條要求就從結構退回紀律。
 */
export function registerSlackHandlers(input: {
  settings: SlackSettingsStore
  secrets: SecretStore
}): void {
  const state = (): SlackState => slackState(input)

  ipcMain.handle(SLACK_CHANNELS.get, (): SlackState => state())

  // 值的驗證在這裡（種類白名單）與 store（值的清理）。`null` ＝清除該份憑證。
  ipcMain.handle(SLACK_CHANNELS.setToken, (_event, kind: unknown, value: unknown): SlackState => {
    if (!isTokenKind(kind)) return state()
    if (value === null) input.secrets.clear(secretName(kind))
    else if (typeof value === 'string') input.secrets.set(secretName(kind), value.trim())
    return state()
  })

  ipcMain.handle(
    SLACK_CHANNELS.setLookbackDays,
    (_event, days: unknown): SlackState => {
      input.settings.setLookbackDays(typeof days === 'number' ? days : null)
      return state()
    },
  )

  ipcMain.handle(SLACK_CHANNELS.setApiBaseUrl, (_event, url: unknown): SlackState => {
    input.settings.setApiBaseUrl(typeof url === 'string' ? url : null)
    return state()
  })
}

export { DEFAULT_API_BASE_URL, DEFAULT_LOOKBACK_DAYS }
export type { SlackState, SlackTokenKind }
export { SLACK_TOKEN_KINDS } from '../slack-state'
