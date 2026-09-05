/**
 * 把 Claude Code 的 session transcript（NDJSON）萃取成存檔的列。
 *
 * 純函式：吃字串、吐列，不碰檔案系統、不記錄狀態。掃描與落盤是另一層的事。
 *
 * ## 判定一律看結構欄位，不看內文長什麼樣
 *
 * 來源裡有一整類記錄其角色是 `user` 但**使用者從未輸入**：skill 與 slash command 被展開的內文、
 * 其他 agent session 送來的訊息、圖片佔位、harness 的追問。它們帶著 `isMeta`。
 * 以文字樣式比對去認它們是行不通的 —— 實測本機資料，文字比對只認得出 53 筆而帶旗標的有 965 筆，
 * 漏掉的 912 筆會讓使用者訊息數**高估 24%**、長度平均值從 53 膨脹到 1,119。
 * **而那些數字全部看起來完全正常。** 中斷同理：判定看頂層的 `interruptedMessageId`，
 * 不比對 `[Request interrupted by user…]` 那句英文文案（它會隨版本改，改掉之後
 * 「我什麼時候踩煞車」會變成一條漂亮的零線）。
 *
 * ## 記錄類型是白名單
 *
 * 只處理 `user` 與 `assistant`，其餘一律忽略且不報錯。來源格式是 Claude Code 的內部格式而非
 * 公開 API：實測本機資料有 21 種記錄類型，多數是隨版本陸續長出來的。黑名單式的排除會在
 * 下一次更新時把新類型當成資料處理。
 *
 * ## subagent 的歸屬：工具算它，使用者訊息不算
 *
 * subagent 的 `role: user` 記錄是 orchestrator 寫給它的指令，不是使用者打的 —— 計入會讓每一個
 * 以「我講了幾句」為分母的指標失真。但 subagent 跑掉的 Bash 就是這次工作真的跑掉的 Bash，
 * 用量也是真的花掉的 token，兩者都計入（見 design D5）。
 */

/** 一則使用者真的打出來的訊息。 */
export interface MessageRow {
  k: 'msg'
  /** epoch ms */
  t: number
  /** session 識別（來源檔名） */
  s: string
  /** 專案識別（來源目錄名） */
  p: string
  /** 完整內文。字元數等衍生值於讀取時計算 —— 存衍生值等於做了一次不可逆的彙總。 */
  text: string
}

/** 使用者中斷了 agent。判定依據是頂層的 `interruptedMessageId`。 */
export interface InterruptRow {
  k: 'int'
  t: number
  s: string
  p: string
}

/** 脈絡壓縮：模型確實收到了它，但使用者沒有打它。標示而非丟棄。 */
export interface CompactRow {
  k: 'cmp'
  t: number
  s: string
  p: string
}

/** 一次工具呼叫。`a` 是該工具的單一辨識參數。 */
export interface ToolRow {
  k: 'tool'
  t: number
  s: string
  p: string
  /** 工具名稱 */
  n: string
  /** Bash 取指令第一個 token、Skill 取 skill 名、Agent 取 subagent 類型；其餘為空 */
  a?: string
}

/** 一則 assistant 訊息的用量。四個欄位照存 —— 來源被刪之後補不回來。 */
export interface UsageRow {
  k: 'use'
  t: number
  s: string
  p: string
  i: number
  o: number
  cr: number
  cw: number
}

export type ArchiveRow = MessageRow | InterruptRow | CompactRow | ToolRow | UsageRow

export interface ExtractContext {
  /** session 識別（來源檔名去掉副檔名）。 */
  sessionId: string
  /** 專案識別（`projects/` 底下的目錄名）。 */
  projectDir: string
  /** 這份 transcript 是否為 subagent 的。 */
  isSubagent: boolean
}

export interface ExtractStats {
  /** `role: user` 的文字區塊總數。 */
  userTextBlocks: number
  /**
   * 其中被判定為**非使用者輸入**的數量（`isMeta`、脈絡壓縮、純通知、bash 輸出）。
   *
   * 這個比例是 `isMeta` 旗標失效的偵測訊號：某次版本更新後它若驟降為 0，代表旗標改名或消失了。
   * **從圖表上看不出來** —— 那時它只會表現為「使用者最近話變多了」。
   */
  nonUserInput: number
  /** 無法解析為 JSON 的行數。 */
  malformed: number
}

export interface ExtractResult {
  rows: ArchiveRow[]
  /** 這份 transcript 出現過的 `cwd`，依出現順序、已去重。專案根的反查要用它。 */
  cwds: string[]
  stats: ExtractStats
}

const TASK_NOTIFICATION = /<task-notification>[\s\S]*?<\/task-notification>/g
/** 未閉合的通知會吞掉其後全部文字 —— 讓半個 XML 標籤流進存檔比丟掉一則通知更糟。 */
const TASK_NOTIFICATION_UNCLOSED = /<task-notification>[\s\S]*$/
const COMMAND_NAME = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/
const COMMAND_ARGS = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/
const BASH_INPUT = /<bash-input>([\s\S]*?)<\/bash-input>/
const BASH_OUTPUT = /<bash-(?:stdout|stderr)>/

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function epoch(v: unknown): number {
  const parsed = Date.parse(str(v))
  return Number.isFinite(parsed) ? parsed : 0
}

function stripNotifications(text: string): string {
  return text.replace(TASK_NOTIFICATION, '').replace(TASK_NOTIFICATION_UNCLOSED, '').trim()
}

/**
 * 把一則 `role: user` 的文字區塊還原成「使用者實際打的字」，或判定它不是使用者打的。
 *
 * 回傳 `null` 表示不產生列。
 */
function userText(raw: string): string | null {
  // `!` 前綴的 bash：輸入是使用者打的，輸出不是。
  if (BASH_OUTPUT.test(raw)) return null
  const bash = BASH_INPUT.exec(raw)
  if (bash) {
    const cmd = bash[1].trim()
    return cmd ? `!${cmd}` : null
  }

  // slash command 在來源裡是展開後的 XML —— 還原成使用者實際打的那一行。
  // 不還原的話「我最常說的那幾句」會列出一堆 XML，而 slash 的使用量會被低估。
  const name = COMMAND_NAME.exec(raw)
  if (name) {
    const args = COMMAND_ARGS.exec(raw)
    const arg = args ? args[1].trim() : ''
    return arg ? `${name[1]} ${arg}` : name[1]
  }

  const stripped = stripNotifications(raw)
  return stripped ? stripped : null
}

/** Bash 指令的第一個 token（去掉路徑），用來看「Bash 裡面在跑什麼」。 */
function bashHead(command: string): string {
  const head = command.trim().replace(/^[(\s]+/, '').split(/[\s|;&]/, 1)[0] ?? ''
  const base = head.split('/').pop() ?? ''
  return base.slice(0, 24)
}

function toolArg(name: string, input: unknown): string {
  if (!isRecord(input)) return ''
  if (name === 'Bash') return bashHead(str(input.command))
  if (name === 'Skill') return str(input.skill)
  if (name === 'Agent') return str(input.subagent_type) || 'general-purpose'
  return ''
}

/** 萃取一份 transcript 的全部內容。`lines` 是原始的 NDJSON 行。 */
export function extractRows(lines: Iterable<string>, ctx: ExtractContext): ExtractResult {
  const rows: ArchiveRow[] = []
  const cwds: string[] = []
  const seenCwd = new Set<string>()
  const stats: ExtractStats = { userTextBlocks: 0, nonUserInput: 0, malformed: 0 }
  const { sessionId: s, projectDir: p, isSubagent } = ctx

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let rec: unknown
    try {
      rec = JSON.parse(trimmed)
    } catch {
      stats.malformed += 1
      continue
    }
    if (!isRecord(rec)) {
      stats.malformed += 1
      continue
    }

    // 記錄類型的白名單。未知類型忽略且不報錯。
    if (rec.type !== 'user' && rec.type !== 'assistant') continue

    const cwd = str(rec.cwd)
    if (cwd && !seenCwd.has(cwd)) {
      seenCwd.add(cwd)
      cwds.push(cwd)
    }

    const message = rec.message
    if (!isRecord(message)) continue
    const role = str(message.role) || String(rec.type)
    const t = epoch(rec.timestamp)

    // ---- role: user 的整筆判定（在看內容之前）----------------------------
    if (role === 'user') {
      const blocks = Array.isArray(message.content) ? message.content : []
      const textBlocks = blocks.filter((b) => isRecord(b) && b.type === 'text').length
        + (typeof message.content === 'string' ? 1 : 0)
      stats.userTextBlocks += textBlocks

      if (rec.isMeta === true) {
        stats.nonUserInput += textBlocks
        continue
      }
      if (rec.isCompactSummary === true) {
        stats.nonUserInput += textBlocks
        if (!isSubagent) rows.push({ k: 'cmp', t, s, p })
        continue
      }
      if (typeof rec.interruptedMessageId === 'string' && rec.interruptedMessageId) {
        stats.nonUserInput += textBlocks
        if (!isSubagent) rows.push({ k: 'int', t, s, p })
        continue
      }
    }

    // ---- 逐個 content block ---------------------------------------------
    const content = message.content
    const blocks: unknown[] = Array.isArray(content)
      ? content
      : typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : []

    for (const block of blocks) {
      if (!isRecord(block)) continue
      switch (block.type) {
        case 'tool_use': {
          const name = str(block.name)
          if (!name) break
          const arg = toolArg(name, block.input)
          rows.push(arg ? { k: 'tool', t, s, p, n: name, a: arg } : { k: 'tool', t, s, p, n: name })
          break
        }
        case 'text': {
          if (role !== 'user') break // assistant 的回覆不進存檔 —— 這裡計量的是使用者
          if (isSubagent) break // orchestrator 寫給 subagent 的指令不是使用者打的
          const text = userText(str(block.text))
          if (text === null) {
            stats.nonUserInput += 1
            break
          }
          rows.push({ k: 'msg', t, s, p, text })
          break
        }
        default:
          // thinking / tool_result / image 等：不進存檔。工具輸出尤其不能存 ——
          // 那是使用者 repo 的內容，不是使用者說的話。
          break
      }
    }

    // ---- 用量：與工具同一條歸屬規則（subagent 花掉的 token 也是真的花掉了）----
    if (role === 'assistant' && isRecord(message.usage)) {
      const u = message.usage
      rows.push({
        k: 'use',
        t,
        s,
        p,
        i: num(u.input_tokens),
        o: num(u.output_tokens),
        cr: num(u.cache_read_input_tokens),
        cw: num(u.cache_creation_input_tokens),
      })
    }
  }

  return { rows, cwds, stats }
}
