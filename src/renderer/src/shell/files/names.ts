import { t } from '@shared/i18n'

/**
 * 新項目名稱的驗證，與主行程 `fs-service.validateName` 同一組規則。
 *
 * **這份不是主行程那份的替代品，而是它的前置回饋**：規格明訂「介面的驗證 SHALL NOT 取代
 * 主行程的驗證」。這裡的存在只為了讓使用者在按下 Enter 之前就看到問題，而不是送出一趟
 * IPC 才被拒絕。
 *
 * 規則取三個目標平台的交集 —— 在 Linux 上放行一個 Windows 開不了的名稱，等於製造一個只在
 * 部分機器上損壞的 repo。
 */

/** Windows 的保留裝置名稱。`CON.txt` 一樣開不了，因此判定看第一個 `.` 之前的部分。 */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Windows 不允許的字元，外加路徑分隔符。空白與 `-` 是合法的。 */
const FORBIDDEN_CHARS = /[<>:"|?*/\\]/

function hasControlChar(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** 回傳可直接呈現的錯誤訊息；名稱合法時回傳 `null`。 */
export function validateName(name: string): string | null {
  if (name.length === 0) return t('files.name.empty')
  if (name === '.' || name === '..') return t('files.name.dotted', { name })
  if (FORBIDDEN_CHARS.test(name) || hasControlChar(name)) {
    return t('files.name.forbiddenChars')
  }
  if (/[ .]$/.test(name)) return t('files.name.trailing')
  if (WINDOWS_RESERVED.test(name.split('.')[0] ?? '')) return t('files.name.reserved')
  return null
}
