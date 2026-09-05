import type { ArchiveRow, MessageRow, ToolRow } from './transcript-extract'
import { identifyProjects, type ProjectInput } from './transcript-project'
import toneRules from '@shared/insights/tone-rules.json' with { type: 'json' }

/**
 * 把存檔的列聚合成畫面要的數字。
 *
 * ## 一律於讀取時計算，掃描階段不留任何彙總
 *
 * 語氣的分類規則會改（多一類、改一個判準）。在萃取時就算成計數的話，改規則只對之後的資料生效，
 * 而過去那段的**來源已經被刪除**，永遠無法以新規則重算。存檔留原文，分類永遠可以重來。
 *
 * ## 分布一律用中位數，不用平均數
 *
 * 實測使用者訊息長度：中位數 23、平均 53、p90 111、最長 3,784 —— 分布的尾巴遠長於中心。
 * 以平均數當代表值會讓一個「短指令、多輪」的使用者看起來像在寫長篇規格，
 * **而那個數字看起來完全正常**。因此本模組不輸出任何平均數。
 *
 * ## 時間一律換算成本機時區
 *
 * 來源的時間戳是 UTC。直接拿它算「星期 × 小時」，對 UTC+8 的使用者整張熱圖偏移 8 小時 ——
 * 「半夜十一點還在工作」會顯示成下午三點，**而那張圖看起來完全正常**。
 */

const SITDOWN_GAP_MINUTES = 30
const PHRASE_MAX_CHARS = 20
const PHRASE_MIN_COUNT = 3
const TONE_EXAMPLE_MAX = 9
const TONE_EXAMPLE_MAX_CHARS = 46

export interface ToneClause {
  kind: 'contains' | 'startsWith' | 'endsWith' | 'wholeIs'
  terms: string[]
}

export interface ToneCategoryRule {
  key: string
  clauses: ToneClause[]
  exclude?: string[]
}

export interface ToneRules {
  version: number
  categories: ToneCategoryRule[]
}

/**
 * 規則的**詞表本身**就是要呈現給使用者的東西。
 *
 * 規格要求「各類別的判定依據 SHALL 可被檢視」。若比對用一組正規表示式、畫面上另外寫一句
 * 「含『不對／錯了…』」，兩者會在某一次調整規則時失去同步 —— 而使用者看到的說明會變成謊話，
 * **沒有任何東西會紅**。因此規則只由字面詞構成，畫面直接列出同一份詞表。
 *
 * 詞表放在 `.json` 而非 `.ts`：本 repo 的 CJK 守衛禁止產品原始碼出現含中文的字串字面值，
 * 而語氣分類必然要比對中文（見 design D13）。
 */
export const DEFAULT_TONE_RULES = toneRules as ToneRules

/** 尾隨的標點，判定「整則訊息就只有這個詞」時忽略。 */
const TRAILING_PUNCT = /[\s，。!！?？~、]+$/

function matchesClause(text: string, clause: ToneClause): boolean {
  switch (clause.kind) {
    case 'contains':
      return clause.terms.some((t) => text.includes(t))
    case 'startsWith':
      return clause.terms.some((t) => text.startsWith(t))
    case 'endsWith': {
      const trimmed = text.replace(TRAILING_PUNCT, '')
      return clause.terms.some((t) => trimmed.endsWith(t))
    }
    case 'wholeIs': {
      const trimmed = text.replace(TRAILING_PUNCT, '')
      return clause.terms.some((t) => trimmed === t)
    }
    default:
      return false
  }
}

/** 一則訊息可以同時落入多個類別 —— 因此回傳陣列，而各類的百分比相加不等於 100%。 */
export function classifyTone(text: string, rules: ToneRules = DEFAULT_TONE_RULES): string[] {
  const trimmed = text.trim()
  const out: string[] = []
  for (const category of rules.categories) {
    if (category.exclude?.some((e) => trimmed.startsWith(e))) continue
    if (category.clauses.some((c) => matchesClause(trimmed, c))) out.push(category.key)
  }
  return out
}

const CJK = /[㐀-鿿豈-﫿]/g
const LATIN = /[A-Za-z]/g

export type LanguageBucket = 'zh' | 'en'

/** 以字元類別判定。`mixed` 與前兩者重疊，因此另外計。 */
export function classifyLanguage(text: string): { primary: LanguageBucket; mixed: boolean } {
  const zh = text.match(CJK)?.length ?? 0
  const en = text.match(LATIN)?.length ?? 0
  return { primary: zh > en ? 'zh' : 'en', mixed: zh > 0 && en > 0 }
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

/** 百分位。**刻意沒有提供平均數** —— 見本檔開頭。 */
export function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * p))
  return sortedValues[index]
}

export function bucketize(sortedValues: readonly number[], edges: readonly number[]): number[] {
  const out = new Array<number>(edges.length + 1).fill(0)
  for (const value of sortedValues) {
    let i = 0
    while (i < edges.length && value >= edges[i]) i += 1
    out[i] += 1
  }
  return out
}

export interface Distribution {
  buckets: number[]
  edges: number[]
  median: number
  p75: number
  p90: number
  max: number
  count: number
}

function distribution(values: number[], edges: number[]): Distribution {
  const s = sorted(values)
  return {
    buckets: bucketize(s, edges),
    edges,
    median: percentile(s, 0.5),
    p75: percentile(s, 0.75),
    p90: percentile(s, 0.9),
    max: s.length ? s[s.length - 1] : 0,
    count: s.length,
  }
}

export interface Counted {
  name: string
  n: number
}

export interface ProjectCount {
  id: string
  label: string | null
  messages: number
  tools: number
}

export interface ToneCategoryView {
  key: string
  n: number
  /** 判定依據 —— 與比對用的是同一份詞表，因此不可能分歧。 */
  clauses: ToneClause[]
  exclude: string[]
  examples: string[]
}

export interface Insights {
  range: { from: number; to: number } | null
  totals: {
    messages: number
    sessions: number
    tools: number
    interrupts: number
    sitDowns: number
    days: number
  }
  /** 7 × 24，索引 0 為星期一。本機時區。 */
  weekHeat: number[][]
  sitDown: Distribution & { thresholdMinutes: number; messagesPerSitDown: Distribution }
  messageLength: Distribution
  roundsPerSession: Distribution
  interruptsDaily: { date: string; n: number }[]
  projects: ProjectCount[]
  bash: Counted[]
  skills: Counted[]
  agents: Counted[]
  tone: ToneCategoryView[]
  language: { zh: number; en: number; mixed: number }
  phrases: Counted[]
  phraseLimits: { maxChars: number; minCount: number }
  /** 被判定為非使用者輸入的比例 —— `isMeta` 旗標失效的偵測訊號。 */
  nonUserInputRatio: number
}

export interface AggregateOptions {
  /** 只納入這段期間（epoch ms，含端點）。省略即全部。 */
  from?: number
  to?: number
  rules?: ToneRules
  /** 專案的 cwd 清單，用來反查顯示名稱。 */
  projects?: readonly ProjectInput[]
  stats?: { userTextBlocks: number; nonUserInput: number }
}

/** 本機時區的日期鍵（`YYYY-MM-DD`）。**不用 `toISOString()`** —— 那是 UTC。 */
function localDateKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本機時區的星期索引，0 = 星期一。 */
function localWeekdayIndex(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7
}

function countBy<T>(items: readonly T[], key: (item: T) => string | undefined): Counted[] {
  const map = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
}

/**
 * 把一個 session 的活動依間隔切成「坐下來工作」的段。
 *
 * **「活動」包含使用者訊息與工具呼叫，不含用量列。** 這個視圖問的是「我坐在那裡工作了多久」，
 * 而 agent 連續跑工具的四十分鐘，人是在的 —— 只算使用者訊息會把那四十分鐘切成兩段。
 *
 * **不以 session 首尾的時間差計算。** 使用者隔天以 `--resume` 續接同一個 session，它就繼續往下寫：
 * 實測首尾差的中位數是 122 分鐘、最長 365 小時；切段後是 23 分鐘。兩個數字都算得出來，
 * 只有一個回答了使用者問的問題。
 */
function sitDownSegments(events: { t: number; isMessage: boolean }[]): { minutes: number; messages: number }[] {
  if (events.length === 0) return []
  const ordered = [...events].sort((a, b) => a.t - b.t)
  const out: { minutes: number; messages: number }[] = []
  let start = ordered[0].t
  let prev = ordered[0].t
  let messages = ordered[0].isMessage ? 1 : 0
  for (const event of ordered.slice(1)) {
    if ((event.t - prev) / 60_000 > SITDOWN_GAP_MINUTES) {
      out.push({ minutes: (prev - start) / 60_000, messages })
      start = event.t
      messages = 0
    }
    prev = event.t
    if (event.isMessage) messages += 1
  }
  out.push({ minutes: (prev - start) / 60_000, messages })
  return out
}

export function aggregate(rows: readonly ArchiveRow[], options: AggregateOptions = {}): Insights {
  const { from = -Infinity, to = Infinity, rules = DEFAULT_TONE_RULES } = options
  const inRange = rows.filter((r) => r.t >= from && r.t <= to)

  const messages = inRange.filter((r): r is MessageRow => r.k === 'msg')
  const tools = inRange.filter((r): r is ToolRow => r.k === 'tool')
  const interrupts = inRange.filter((r) => r.k === 'int')

  // ---- 節奏 -------------------------------------------------------------
  const weekHeat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  for (const m of messages) {
    const d = new Date(m.t)
    weekHeat[localWeekdayIndex(m.t)][d.getHours()] += 1
  }

  const bySession = new Map<string, { t: number; isMessage: boolean }[]>()
  for (const row of inRange) {
    if (row.k !== 'msg' && row.k !== 'tool') continue
    const list = bySession.get(row.s) ?? []
    list.push({ t: row.t, isMessage: row.k === 'msg' })
    bySession.set(row.s, list)
  }
  const segments = [...bySession.values()].flatMap(sitDownSegments)

  const roundsBySession = new Map<string, number>()
  for (const m of messages) roundsBySession.set(m.s, (roundsBySession.get(m.s) ?? 0) + 1)

  const interruptsByDay = new Map<string, number>()
  for (const i of interrupts) {
    const key = localDateKey(i.t)
    interruptsByDay.set(key, (interruptsByDay.get(key) ?? 0) + 1)
  }
  const days = new Set(messages.map((m) => localDateKey(m.t)))
  for (const key of interruptsByDay.keys()) days.add(key)
  const dayKeys = [...days].sort()

  // ---- 專案 -------------------------------------------------------------
  const identities = identifyProjects(options.projects ?? [...new Set(inRange.map((r) => r.p))].map((dirName) => ({ dirName, cwds: [] })))
  const projectCounts = new Map<string, { messages: number; tools: number }>()
  for (const row of inRange) {
    if (row.k !== 'msg' && row.k !== 'tool') continue
    const entry = projectCounts.get(row.p) ?? { messages: 0, tools: 0 }
    if (row.k === 'msg') entry.messages += 1
    else entry.tools += 1
    projectCounts.set(row.p, entry)
  }
  const projects: ProjectCount[] = [...projectCounts.entries()]
    .map(([dirName, counts]) => ({
      id: identities.get(dirName)?.id ?? '',
      label: identities.get(dirName)?.label ?? null,
      ...counts,
    }))
    .sort((a, b) => b.messages - a.messages)

  // ---- 說話的方式 -------------------------------------------------------
  const toneCounts = new Map<string, number>()
  const toneExamples = new Map<string, string[]>()
  const language = { zh: 0, en: 0, mixed: 0 }
  const phraseCounts = new Map<string, number>()

  for (const m of messages) {
    for (const key of classifyTone(m.text, rules)) {
      toneCounts.set(key, (toneCounts.get(key) ?? 0) + 1)
      const single = m.text.replace(/\s+/g, ' ').trim()
      if (single.length <= TONE_EXAMPLE_MAX_CHARS) {
        const list = toneExamples.get(key) ?? []
        if (!list.includes(single)) list.push(single)
        toneExamples.set(key, list)
      }
    }
    const lang = classifyLanguage(m.text)
    language[lang.primary] += 1
    if (lang.mixed) language.mixed += 1

    const phrase = m.text.replace(/\s+/g, ' ').trim()
    if (phrase.length <= PHRASE_MAX_CHARS) phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
  }

  const tone: ToneCategoryView[] = rules.categories.map((category) => {
    const pool = toneExamples.get(category.key) ?? []
    // 取長度分布均勻的一批，避免整欄都是最短的那幾句。
    const unique = [...pool].sort((a, b) => a.length - b.length)
    const picked =
      unique.length <= TONE_EXAMPLE_MAX
        ? unique
        : Array.from({ length: TONE_EXAMPLE_MAX }, (_, i) => unique[Math.round((i * (unique.length - 1)) / (TONE_EXAMPLE_MAX - 1))])
    return {
      key: category.key,
      n: toneCounts.get(category.key) ?? 0,
      clauses: category.clauses,
      exclude: category.exclude ?? [],
      examples: [...new Set(picked)],
    }
  })

  const phrases = [...phraseCounts.entries()]
    .filter(([, n]) => n >= PHRASE_MIN_COUNT)
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))

  // **不用 `Math.min(...times)`。** 展開一個大陣列會把每一筆變成一個函式參數，
  // 而參數個數有上限：實測在真實資料（六十幾萬列）上直接
  // `RangeError: Maximum call stack size exceeded`，而 fixture 只有二十列，完全看不出來。
  // 這是 dogfood 抓到的 —— 單元測試與探針的資料量都太小。
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  let timed = 0
  for (const row of inRange) {
    if (row.t <= 0) continue
    timed += 1
    if (row.t < earliest) earliest = row.t
    if (row.t > latest) latest = row.t
  }
  const stats = options.stats
  return {
    range: timed > 0 ? { from: earliest, to: latest } : null,
    totals: {
      messages: messages.length,
      sessions: roundsBySession.size,
      tools: tools.length,
      interrupts: interrupts.length,
      sitDowns: segments.length,
      days: dayKeys.length,
    },
    weekHeat,
    sitDown: {
      ...distribution(segments.map((s) => s.minutes), [5, 15, 30, 60, 120, 240]),
      thresholdMinutes: SITDOWN_GAP_MINUTES,
      messagesPerSitDown: distribution(segments.map((s) => s.messages), [1, 2, 3, 6, 11, 21]),
    },
    messageLength: distribution(messages.map((m) => m.text.length), [10, 20, 40, 80, 160, 400, 1000]),
    roundsPerSession: distribution([...roundsBySession.values()], [2, 5, 10, 20, 50, 100]),
    interruptsDaily: dayKeys.map((date) => ({ date, n: interruptsByDay.get(date) ?? 0 })),
    projects,
    bash: countBy(tools.filter((t) => t.n === 'Bash'), (t) => t.a),
    skills: countBy(tools.filter((t) => t.n === 'Skill'), (t) => t.a),
    agents: countBy(tools.filter((t) => t.n === 'Agent'), (t) => t.a),
    tone,
    language,
    phrases,
    phraseLimits: { maxChars: PHRASE_MAX_CHARS, minCount: PHRASE_MIN_COUNT },
    nonUserInputRatio: stats && stats.userTextBlocks > 0 ? stats.nonUserInput / stats.userTextBlocks : 0,
  }
}
