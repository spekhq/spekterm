/**
 * 受支援語言的**單一來源**。
 *
 * 四個消費者全部自這裡推導：i18next 的 `resources`、落盤偏好的白名單清理器、
 * 設定介面的選項、以及字典完整性守衛的定義域。加一種語言只動這個陣列與新增一份字典。
 */
export const SUPPORTED_LANGUAGES = ['en', 'zh-TW'] as const

export type Language = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * 基準語言。字典完整性以它為對照，任何無法解析的情形也退回它。
 *
 * **它同時是驗收腳本執行時的語言** —— `scripts/lib/copy.mjs` 以基準語言的字典組出
 * `aria-label` 選擇器。
 */
export const DEFAULT_LANGUAGE: Language = 'en'

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/**
 * 把一個語言標籤正規化成 BCP-47 的慣用形式（`zh_tw` → `zh-TW`）。
 *
 * 作業系統回報的形式不一致：`LANGUAGE` 給的是 `zh_TW:zh` 這種以底線與冒號組成的清單，
 * 而 Electron 轉出來的已經是 `zh-TW`。**兩種都要吃** —— 只認一種的正規化會在某些環境
 * 靜默地退回預設語言，而那看起來就只是「偵測沒作用」。
 */
function normalizeTag(tag: string): string {
  const [primary, ...rest] = tag.replace(/_/g, '-').split('-')
  const region = rest.length > 0 ? `-${rest.join('-').toUpperCase()}` : ''
  return `${primary.toLowerCase()}${region}`
}

/**
 * 自作業系統回報的**偏好語言順序**決定初始語言：取其中第一個受支援者。
 *
 * ## 為什麼吃的是一個有序清單而不是單一值
 *
 * 我們要回答的問題正是「這個清單裡第一個我們支援的是哪個」。`app.getLocale()` 是 Chromium
 * 解析後的單一值，拿它來做這件事得自己補回回退鏈；`app.getSystemLocale()` 實測會回傳
 * `en-US@posix` 這種帶 POSIX modifier 的字串。
 *
 * ## 三種輸入都是實測到的，不是假想的防禦
 *
 * （2026-09-18、Electron 43.1.0、Linux）
 *
 * - **空陣列** —— `LANG` 與 `LANGUAGE` 皆未設定時 `getPreferredSystemLanguages()` 就回空陣列。
 * - **帶區域的標籤** —— `zh-TW,zh,zh`（`LANGUAGE` 有值時）或 `zh-TW,zh-TW,zh,zh`（僅 `LANG`）。
 *   **有重複項**，所以不能假設它是去重過的。
 * - **只有主語言的標籤** —— `zh`。它不是 `zh-TW`，而我們只支援後者：**刻意不做主語言的模糊
 *   匹配**（`zh` 可能是簡體）。不匹配就往下一個看，全都不匹配就退回基準語言。
 */
export function resolveInitialLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const normalized = normalizeTag(tag)
    if (isSupportedLanguage(normalized)) return normalized
  }
  return DEFAULT_LANGUAGE
}
