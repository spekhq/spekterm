import { currentLanguage, t } from './index'
import type { Language } from './languages'

/**
 * **一切 locale 衍生的呈現，其 locale 只有這一個來源。**
 *
 * ## 為什麼要收斂
 *
 * 這個 app 曾經只有一種語言，而在那個前提下長出了三種互不相同的做法：一處硬編了
 * `zh-TW` 的排序規則、一處硬編了 `en-US` 的數字格式、一處沿用執行環境的預設 ——
 * 於是一個宣稱全英文的介面，在一台 `LANG=zh_TW` 的機器上把時刻顯示成了當地格式。
 * **三處都沒有任何東西會變紅。** 紀律在沒有守衛時已經失效過了，因此
 * `scripts/locale-source.test.mjs` 擋住這個模組之外的每一次 `Intl` 與 `toLocale*`。
 *
 * ## 不是每個字串比較都屬於這裡
 *
 * 只有**使用者看得到的排列順序**走 `collator()`。僅為確定性而存在的內部定序
 *（同分時的 tie-break、兩條列舉路徑的收斂）**不得**隨語言改變 —— 那會讓「同分時的排名」
 * 成為環境的函數，而釘住它的測試就變成在測環境。那些站點在守衛裡逐一具名豁免，各帶理由。
 *
 * ## 格式化器一律快取，且以語言為鍵
 *
 * `Intl.*` 的建構不便宜，而檔案樹的每一列每次重繪都要用它。快取**不能建在模組層級**：
 * 那會在語言確定之前求值。以當前語言為鍵，語言一變就重建。
 */

/**
 * 以語言為鍵的格式化器快取。
 *
 * **每個取用者都收得下一個明示的語言**，預設才是「當前語言」。理由不是彈性，而是
 * **依賴的可見性**：React 的 `useMemo`／`useEffect` 以依賴陣列表達「什麼時候該重算」，
 * 而一個在函式內部去讀全域語言的比較器，那條依賴在語法上看不見 ——
 * `exhaustive-deps` 會說它是多餘的，然後有人就把它刪了，而排序從此停在舊語言。
 * 收下語言之後，那條依賴就是一個真的值。
 */
function cached<T>(build: (language: Language) => T): (language?: Language) => T {
  const store = new Map<Language, T>()
  return (language = currentLanguage()) => {
    const hit = store.get(language)
    if (hit !== undefined) return hit
    const value = build(language)
    store.set(language, value)
    return value
  }
}

/** 當前 UI 語言的 BCP-47 標籤。`document.documentElement.lang` 也用它。 */
export function localeOf(): Language {
  return currentLanguage()
}

/**
 * 使用者看得到的字串排列所用的比較器。
 *
 * `numeric` 讓 `file10` 排在 `file9` 之後（而非之前）；`sensitivity: 'base'` 讓大小寫與
 * 變音符號不影響順序 —— 兩者都是既有的檔案樹行為，收斂時不得改變。
 */
export const collator = cached(
  (language) => new Intl.Collator(language, { numeric: true, sensitivity: 'base' }),
)

const relativeFormatter = cached(
  (language) => new Intl.RelativeTimeFormat(language, { numeric: 'auto' }),
)

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/** 相對於 `now` 的時間差，以當前語言呈現（`2 hours ago`）。 */
export function relativeTime(at: number, now: number = Date.now(), language?: Language): string {
  const diff = at - now
  const magnitude = Math.abs(diff)

  for (const [unit, span] of RELATIVE_UNITS) {
    if (magnitude >= span) return relativeFormatter(language).format(Math.round(diff / span), unit)
  }

  return t('time.justNow')
}

/**
 * 時刻與日期。
 *
 * **時區刻意不指定** —— 作業系統的時區就是使用者所在的時區，那與介面的語言是兩件不同的事：
 * 一個在台北工作的人把介面切成英文，他要的仍然是台北時間，只是換一種寫法。
 */
export function formatTime(at: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return at.toLocaleTimeString(localeOf(), options)
}

export function formatDate(at: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return at.toLocaleDateString(localeOf(), options)
}

export function formatDateTime(at: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return at.toLocaleString(localeOf(), options)
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return value.toLocaleString(localeOf(), options)
}
