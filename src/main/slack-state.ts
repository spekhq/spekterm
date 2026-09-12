import type { SecretStore } from './secret-store'
import {
  type ProjectedSlackSettings,
  type SlackSettingsStore,
  projectSlackSettings,
} from './slack-settings-store'

/**
 * 憑證的種類。**白名單，不是自由字串** —— 名稱會成為機密檔的鍵，而那個鍵決定了連線那一層
 * 去拿哪一份憑證。renderer 送一個不認得的種類，正確的處置是什麼都不做。
 */
export const SLACK_TOKEN_KINDS = ['appToken', 'userToken'] as const
export type SlackTokenKind = (typeof SLACK_TOKEN_KINDS)[number]

/** 機密檔裡的鍵。 */
export function secretName(kind: SlackTokenKind): string {
  return `slack.${kind}`
}

/**
 * renderer 看得到的 Slack 狀態。
 *
 * **憑證以布林出現，不是以值出現。** 這是 `secret-scope` 第一條 requirement 的具體形式：
 * renderer 為了呈現與操作所需的資訊限於**衍生的事實**（是否已設定、連到哪個工作區、
 * 端點是不是預設值），SHALL NOT 包含機密本身或其任何可還原的片段。
 *
 * `usesDefaultEndpoint` 是 `secret-scope` 端點第二條的載體：**憑證的目的地是一個資料欄位**
 * （使用者的裁決），那個代價只有在他看得見時才可接受 —— 一個沉默的端點欄位比沒有這個欄位更糟。
 */
export interface SlackState {
  settings: ProjectedSlackSettings
  /** 每一種憑證**有沒有被設定**。 */
  configured: Record<SlackTokenKind, boolean>
  /** 端點是不是預設值。 */
  usesDefaultEndpoint: boolean
  /** 套用預設之後的實際值 —— 介面要顯示它們，而預設住在主行程。 */
  effective: { apiBaseUrl: string; lookbackDays: number }
}

/**
 * 組出 renderer 的狀態。**純函式**，於是它可以在沒有 Electron 的環境下被單元測試
 * （`ipcMain` 載入不起來，比照 `report-runner` 的 `delegateEnv`）。
 *
 * **不可原樣轉手任何 store 的回傳值** —— 設定那一份走 `projectSlackSettings` 的逐欄位白名單，
 * 憑證那一份根本不取值、只問 `has()`。這條由 `scripts/settings-projection.test.mjs` 守著。
 */
export function slackState(input: {
  settings: SlackSettingsStore
  secrets: SecretStore
}): SlackState {
  const { settings, secrets } = input
  return {
    settings: projectSlackSettings(settings.get()),
    configured: {
      appToken: secrets.has(secretName('appToken')),
      userToken: secrets.has(secretName('userToken')),
    },
    usesDefaultEndpoint: settings.usesDefaultEndpoint(),
    effective: { apiBaseUrl: settings.apiBaseUrl(), lookbackDays: settings.lookbackDays() },
  }
}

/** renderer 送來的種類是否在白名單上。 */
export function isTokenKind(value: unknown): value is SlackTokenKind {
  return typeof value === 'string' && (SLACK_TOKEN_KINDS as readonly string[]).includes(value)
}
