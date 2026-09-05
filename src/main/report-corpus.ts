import type { ArchiveRow, MessageRow } from './transcript-extract'

/**
 * 送往委派的語料 —— 組裝、截斷、正規化。
 *
 * ## 正規化只有一個定義，兩側套用同一個
 *
 * 引用的查證是「引用是不是語料裡真的有的一段話」。語料那一側是存檔的原文，引用那一側是委派
 * 回覆的字串，兩者的空白幾乎不可能逐字元相同。**若兩側各自正規化，比對會全數失敗** ——
 * 而全數失敗會落進「全部論斷都被丟棄」那個規格已經定義好的合理狀態，於是一個實作 bug 被
 * 包裝成一個看起來很正常的結果。這與既有教訓（`sourceAvailable === null` 曾被顯示成
 * 「沒有資料」）是同一個形狀。因此 `normalizeForMatch` 是唯一的定義，`buildCorpus` 與查證
 * 都只能用它。
 *
 * ## 超量時截斷，不抽樣
 *
 * 抽樣會悄悄改變這份報告在講什麼，而畫面上看不出來 —— 一份「讀了你一年的對話」與一份
 * 「讀了你一年裡隨機一成的對話」是兩個不同的東西，兩者都產得出讀起來很有道理的散文。
 * 因此自**最舊的一端**截斷，並讓報告記錄的涵蓋期間是**實際送進去的那一段**。
 */

/** 單趟語料的字元上限。實測 30 天約 200,000 字元，故此值約可涵蓋 90 天。 */
export const CORPUS_MAX_CHARS = 600_000

/** 引用可以取自的訊息長度上限 —— 見 `report-verify.ts` 對它的論證。 */
export const QUOTABLE_MAX_CHARS = 200

export interface CorpusMessage {
  /** epoch ms。 */
  t: number
  /** 來源專案目錄名。**內部用** —— 它是一個換過字元的絕對路徑，不得外流。 */
  p: string
  /** 原文。 */
  text: string
  /** 正規化後的形式，供查證比對。 */
  norm: string
}

export interface Corpus {
  messages: CorpusMessage[]
  /** 實際涵蓋的期間（epoch ms）。沒有任何訊息時為 `null`。 */
  from: number | null
  to: number | null
  /** 實際送出的字元數。 */
  chars: number
  /** 出現的專案數。 */
  projects: number
  /** 是否因超過上限而截斷。 */
  truncated: boolean
}

/**
 * 比對用的正規化：收斂連續空白為單一空格、去頭尾空白。
 *
 * **這是唯一的定義。** 任何比對兩端都必須經過它 —— 見本檔開頭。
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface BuildCorpusOptions {
  from?: number
  to?: number
  maxChars?: number
}

/** 從存檔的列組出語料。只取使用者訊息 —— 工具輸出與 assistant 的回覆不是使用者說的話。 */
export function buildCorpus(rows: readonly ArchiveRow[], options: BuildCorpusOptions = {}): Corpus {
  const { from, to, maxChars = CORPUS_MAX_CHARS } = options
  const picked: CorpusMessage[] = []
  for (const row of rows) {
    if (row.k !== 'msg') continue
    const m = row as MessageRow
    if (m.t <= 0) continue
    if (from !== undefined && m.t < from) continue
    if (to !== undefined && m.t > to) continue
    const norm = normalizeForMatch(m.text)
    if (!norm) continue
    picked.push({ t: m.t, p: m.p, text: m.text, norm })
  }
  picked.sort((a, b) => a.t - b.t)

  // **自最舊的一端截斷。** 從尾端往前累加，超過上限就停 —— 留下的是最近的那一段。
  let chars = 0
  let start = picked.length
  for (let i = picked.length - 1; i >= 0; i -= 1) {
    const next = chars + picked[i].norm.length
    if (next > maxChars && start < picked.length) break
    chars = next
    start = i
    if (chars >= maxChars) break
  }
  const messages = picked.slice(start)
  const truncated = start > 0

  const projects = new Set<string>()
  for (const m of messages) projects.add(m.p)

  return {
    messages,
    from: messages.length > 0 ? messages[0].t : null,
    to: messages.length > 0 ? messages[messages.length - 1].t : null,
    chars,
    projects: projects.size,
    truncated,
  }
}
