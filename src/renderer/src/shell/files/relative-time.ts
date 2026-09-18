import { relativeTime } from '@shared/i18n/locale'

/**
 * 相對時間在呈現層計算。
 *
 * 主行程只回傳數值時間戳：格式化牽涉語言（不該由主行程決定）與「當下是何時」
 *（面板開著的每一分鐘都會讓一個字串失效）。
 *
 * **locale 與格式化器的快取住在 `@shared/i18n/locale`** —— 檔案樹的每一列都在顯示相對時間，
 * 這裡若自己持有一份 locale，切換語言時整棵樹就不會跟著改，而畫面上不會有任何錯誤。
 */
export function formatRelativeTime(mtimeMs: number, now: number = Date.now()): string {
  return relativeTime(mtimeMs, now)
}

const SIZE_UNITS = ['B', 'kB', 'MB', 'GB']

export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? String(value) : value.toFixed(1)
  return `${rounded} ${SIZE_UNITS[unit]}`
}
