/**
 * 相對時間在呈現層計算。
 *
 * 主行程只回傳數值時間戳：格式化牽涉語言（不該由主行程決定）與「當下是何時」
 *（面板開著的每一分鐘都會讓一個字串失效）。
 */
const formatter = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' })

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

export function formatRelativeTime(mtimeMs: number, now: number = Date.now()): string {
  const diff = mtimeMs - now
  const magnitude = Math.abs(diff)

  for (const [unit, span] of UNITS) {
    if (magnitude >= span) {
      return formatter.format(Math.round(diff / span), unit)
    }
  }

  return '剛剛'
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
