import { execFile } from 'node:child_process'
import { ipcMain } from 'electron'
import type { PreferencesStore, TerminalPreferences } from '../preferences-store'

export const SETTINGS_CHANNELS = {
  get: 'workspace:settings:get',
  setTerminalFont: 'workspace:settings:setTerminalFont',
  setGpuAcceleration: 'workspace:settings:setGpuAcceleration',
  listMonospaceFonts: 'workspace:settings:listMonospaceFonts',
} as const

/** 列舉系統等寬字型時的逾時 —— 這是使用者開設定對話框時的一次性查詢，不該讓它卡住。 */
const LIST_FONTS_TIMEOUT_MS = 3000

/**
 * 系統的等寬字型清單，給設定對話框的下拉選單用（讓使用者從清單挑，不必硬記字型名）。
 *
 * **目前只支援 Linux（fontconfig）**：`fc-list :spacing=100 family` —— `:spacing=100` 正是 fontconfig
 * 的「monospace」判準，直接拿到等寬字，不必自己在 renderer 量測。其他平台回空陣列，設定對話框退回純
 * 輸入（跨平台字型列舉列為 Phase 6，見 design D9）。
 *
 * 這是使用者觸發的一次性動作（開設定），不是每次載入的熱路徑 —— 因此 spawn 一次 `fc-list` 可接受，
 * 與「分支偵測不 spawn git」那條熱路徑紀律不同。fc-list 不存在或失敗時回空陣列（graceful）。
 */
function listMonospaceFonts(): Promise<string[]> {
  if (process.platform !== 'linux') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      'fc-list',
      [':spacing=100', 'family'],
      { timeout: LIST_FONTS_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve([])
          return
        }
        const families = new Set<string>()
        for (const line of stdout.split('\n')) {
          // 每行可能是逗號分隔的多語系別名（如 `Noto Sans Mono,Noto Sans Mono ...`）—— 取第一個。
          const name = line.split(',')[0].trim()
          if (name) families.add(name)
        }
        resolve([...families].sort((a, b) => a.localeCompare(b)))
      },
    )
  })
}

/**
 * 使用者偏好的讀寫。本輪只有終端字型。
 *
 * **值的驗證在 store**（`setTerminalFont` 會清理 family、夾制 size）—— 一個被入侵或有 bug 的
 * renderer 可送出任意型別，store 的 `sanitizeFamily`／`clampSize` 對非字串／非數字皆退回未設定，
 * 因此這裡不需要另做型別 guard。回傳套用後的偏好，讓 renderer 立即以之更新終端。
 */
export function registerSettingsHandlers(store: PreferencesStore): void {
  ipcMain.handle(SETTINGS_CHANNELS.get, (): TerminalPreferences => store.get())

  ipcMain.handle(
    SETTINGS_CHANNELS.setTerminalFont,
    (
      _event,
      fontFamily: string | null,
      fontSize: number | null,
      lineHeight: number | null,
    ): TerminalPreferences => store.setTerminalFont(fontFamily, fontSize, lineHeight),
  )

  // 值的驗證同樣在 store（只認真正的布林；其餘一律當成未設定＝預設啟用）。
  ipcMain.handle(
    SETTINGS_CHANNELS.setGpuAcceleration,
    (_event, enabled: boolean | null): TerminalPreferences =>
      store.setGpuAcceleration(typeof enabled === 'boolean' ? enabled : null),
  )

  ipcMain.handle(SETTINGS_CHANNELS.listMonospaceFonts, (): Promise<string[]> =>
    listMonospaceFonts(),
  )
}
