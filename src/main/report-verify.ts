import { normalizeForMatch, QUOTABLE_MAX_CHARS, type Corpus, type CorpusMessage } from './report-corpus'
import type { ProjectIdentity } from './transcript-project'

/**
 * 引用的查證 —— **這是整個能力唯一的守衛**。
 *
 * ## 為什麼要機械查證
 *
 * 散文沒有對照組可言：一段推論成不成立無法機械判定。但「這句話存不存在」可以。
 * **要求委派務必附上出處是靠自律，丟棄查不到出處的論斷是靠結構** —— 而本 repo 反覆的教訓
 * 是：不接受某個東西要由結構保證，不是由「沒有人再送它」保證。
 *
 * ## 委派只負責挑句子，metadata 由我們填
 *
 * 日期與專案取自**存檔**，不取自回覆。於是委派無法把一句話掛到錯的日期或錯的 repo 上 ——
 * 它唯一能做的是挑一句真的存在的話，而那是可判定的。一旦連 metadata 也由它提供，
 * 一條「你三月在 A repo 說過…」就完全無法查證，而它看起來與真的一模一樣。
 *
 * ## 比對的單位是單一則訊息
 *
 * **不是串接後的整份語料。** 串接後比對會讓一段跨越兩則訊息邊界的字串通過查證，
 * 而那時根本沒有「該則訊息」可以拿來填日期與專案。
 *
 * ## 命中多則時取最早，並記錄則數
 *
 * 極短訊息大量重複是常態（「繼續」「好」「不對」）。不定死取哪一則，**掛錯日期與專案的
 * 就會是我們自己**，而結果與正確的一模一樣。呈現則數讓「這句話你說過 N 次」本身成為資訊。
 */

/** 單一引用的長度上限。中位長度的使用者訊息是 23 字元，這是它的兩倍以上。 */
export const QUOTE_MAX_CHARS = 60
/** 單一報告的論斷數上限。 */
export const CLAIM_MAX = 20

/** 委派回覆裡的一條論斷 —— 它只提供這兩個欄位。 */
export interface RawClaim {
  claim: string
  quote: string
}

export interface VerifiedClaim {
  claim: string
  quote: string
  /** 不可逆的專案識別（sha1 前 8 碼）。**不是**目錄名。 */
  projectId: string
  /** 顯示名稱。反查不到時為 `null` —— 少一個名字好過給一個錯的。 */
  projectLabel: string | null
  /** 本機日期（YYYY-MM-DD）。取自存檔，不取自回覆。 */
  date: string
  /** 命中的則數。 */
  occurrences: number
}

export interface VerifyResult {
  claims: VerifiedClaim[]
  /** 查證失敗而被丟棄的條數。**不含**因超過 20 條上限而被截掉的部分。 */
  discarded: number
}

function localDate(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 找出所有命中該引用的訊息。只有長度在上限內的訊息可以被引用。 */
function findMatches(corpus: Corpus, normQuote: string): CorpusMessage[] {
  const out: CorpusMessage[] = []
  for (const m of corpus.messages) {
    if (m.text.length > QUOTABLE_MAX_CHARS) continue
    if (m.norm.includes(normQuote)) out.push(m)
  }
  return out
}

/**
 * 逐條查證，**先全部查完再截取前 20 條**。
 *
 * 順序不是細節：委派回 25 條、其中 8 條查不到出處時，先截後查證得到的丟棄數最多是 20，
 * 先查證後截得到的是 8。**兩種都符合「上限 20」，而那個數字差 2.5 倍，畫面上完全看不出來**
 * —— 而丟棄數正是規格指定的「這份報告該用什麼態度讀」的指標。
 */
export function verifyClaims(
  raw: readonly RawClaim[],
  corpus: Corpus,
  identities: ReadonlyMap<string, ProjectIdentity>,
): VerifyResult {
  const verified: VerifiedClaim[] = []
  let discarded = 0

  for (const item of raw) {
    const quote = normalizeForMatch(String(item?.quote ?? ''))
    const claim = String(item?.claim ?? '').trim()
    if (!claim || !quote || quote.length > QUOTE_MAX_CHARS) {
      discarded += 1
      continue
    }
    const matches = findMatches(corpus, quote)
    if (matches.length === 0) {
      discarded += 1
      continue
    }
    // 取最早的一則 —— 語料已依時間排序。
    const earliest = matches[0]
    const identity = identities.get(earliest.p)
    verified.push({
      claim,
      quote,
      projectId: identity?.id ?? '',
      projectLabel: identity?.label ?? null,
      date: localDate(earliest.t),
      occurrences: matches.length,
    })
  }

  return { claims: verified.slice(0, CLAIM_MAX), discarded }
}
