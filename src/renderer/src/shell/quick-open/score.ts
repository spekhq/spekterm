/**
 * quick open 的模糊比對與排序。**純函式，不碰 DOM 也不碰 IPC** —— 於是排序規則測得起來。
 *
 * 比對是**子序列**：查詢的字元依序出現於路徑中即算命中，不要求連續。這是這類入口的慣例
 * （使用者打 `qos` 期望命中 `quick-open/score.ts`）。
 *
 * 排序以「**使用者知道檔名**」為主要情境 —— 那是本能力唯一的用途（見 `quick-open` 的 spec）。
 * 因此檔名段（路徑最後一段）的命中權重高於路徑中段。
 *
 * 效能：線性掃描，實測 5,000 項約 4–16ms、50,000 項約 50ms。真實的 repo 在版控列舉之後
 * 落在第一級（本 repo 419、一個大 repo 2,446），遠低於一幀。**若日後真的遇到五萬項以上的
 * 目標，第一個該加的是輸入 debounce，不是索引。**
 */

/** 不命中。呼叫端以 `>= 0` 判定命中，因此這個值必須是負的。 */
export const NO_MATCH = -1

const BASENAME_HIT = 3
const PATH_HIT = 1
/**
 * 連續命中的遞增獎勵：第 n 個連續字元加 n × 此值。
 *
 * **它必須大於 `BOUNDARY_BONUS`**，否則「每個字元都落在詞邊界」的散落命中會勝過連續命中
 * （實測：`s-c-o-r-e.ts` 對 `score` 得 35 分，而連續的 `score.ts` 只有 29）。
 */
const STREAK_BONUS = 3
/**
 * 檔名整段命中的獎勵。
 *
 * 大到足以讓「檔名命中」壓過任何「路徑中段命中」—— 那是本能力唯一的主要情境。
 */
const BASENAME_MATCH_BONUS = 100
/** 詞邊界（路徑分隔、`-`、`_`、`.` 之後，或字串開頭）的命中。 */
const BOUNDARY_BONUS = 4
/** 長路徑的輕微懲罰 —— 同樣命中時，短的通常是使用者要的那個。 */
const LENGTH_PENALTY = 0.05

function isBoundary(code: number): boolean {
  return code === 47 /* / */ || code === 45 /* - */ || code === 95 /* _ */ || code === 46 /* . */
}

/** ASCII 的大寫轉小寫。非 ASCII 直接比對原碼位（CJK 檔名沒有大小寫之分）。 */
function fold(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code
}

/**
 * 以子序列比對計分。不命中回傳 `NO_MATCH`。
 *
 * 查詢為空視為命中，分數 0 —— 呼叫端據此在空查詢時呈現整個清單。
 */
function subsequenceScore(text: string, query: string, basenameStart: number): number {
  let queryIndex = 0
  let score = 0
  let streak = 0

  for (let i = 0; i < text.length && queryIndex < query.length; i++) {
    if (fold(text.charCodeAt(i)) !== fold(query.charCodeAt(queryIndex))) {
      streak = 0
      continue
    }

    score += i >= basenameStart ? BASENAME_HIT : PATH_HIT
    score += streak * STREAK_BONUS
    if (i === 0 || isBoundary(text.charCodeAt(i - 1))) score += BOUNDARY_BONUS
    streak++
    queryIndex++
  }

  return queryIndex < query.length ? NO_MATCH : score
}

export function scorePath(candidate: string, query: string): number {
  if (query === '') return 0

  const basenameStart = candidate.lastIndexOf('/') + 1
  const lengthPenalty = candidate.length * LENGTH_PENALTY

  // **先只在檔名上試。** 掃描是貪婪的，直接掃全路徑會把查詢開頭的字元浪費在目錄名上 ——
  // 實測 `score` 對 `src/score.ts`：`s` 與 `c` 被 `src` 吃掉，只剩 `ore` 落在檔名裡，
  // 分數低到排在一個人工的 `s-c-o-r-e.ts` 之後。這一步同時實現「檔名命中優先」。
  const inBasename = subsequenceScore(candidate.slice(basenameStart), query, 0)
  if (inBasename !== NO_MATCH) return inBasename + BASENAME_MATCH_BONUS - lengthPenalty

  const inPath = subsequenceScore(candidate, query, basenameStart)
  return inPath === NO_MATCH ? NO_MATCH : inPath - lengthPenalty
}

/**
 * 篩選並排序，取前 `limit` 筆。
 *
 * **結果會被截斷** —— 這一點寫在 spec 裡，因為它會靜默地讓「某個檔案恰好出現一次」之類的
 * 驗收失去鑑別力（截斷之後，一個會產生重複項的實作同樣會通過）。
 *
 * 同分時依路徑升序，使順序**可預期**：一個隨執行而異的順序會讓探針時綠時紅。
 */
export function rankPaths(candidates: string[], query: string, limit: number): string[] {
  const scored: { path: string; score: number }[] = []

  for (const candidate of candidates) {
    const score = scorePath(candidate, query)
    if (score >= 0) scored.push({ path: candidate, score })
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)))
  return scored.slice(0, limit).map((entry) => entry.path)
}
