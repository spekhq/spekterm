import { i18n, t } from '@shared/i18n'

/**
 * 相對時間在呈現層計算。
 *
 * 主行程只回傳數值時間戳：格式化牽涉語言（不該由主行程決定）與「當下是何時」
 *（面板開著的每一分鐘都會讓一個字串失效）。
 */

/**
 * **locale 取自 i18n，不寫死。**
 *
 * 檔案樹的每一列都在顯示相對時間 —— 這裡若留著另一個 locale，整個英文介面裡就會混著
 * 「3 分鐘前」。而 formatter **不能建在模組層級**：那會在 `initI18n()` 之前求值，
 * 讀到的 `i18n.language` 是 undefined。
 */
let cached: { language: string; formatter: Intl.RelativeTimeFormat } | null = null

function formatter(): Intl.RelativeTimeFormat {
  const language = i18n.language || 'en'
  if (cached?.language !== language) {
    cached = { language, formatter: new Intl.RelativeTimeFormat(language, { numeric: 'auto' }) }
  }
  return cached.formatter
}

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
      return formatter().format(Math.round(diff / span), unit)
    }
  }

  return t('time.justNow')
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
