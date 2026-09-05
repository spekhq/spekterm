import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 驗收用：造一份可控的 Claude Code session transcript 目錄。
 *
 * ## 為什麼它必須先於一切
 *
 * `conversation-archive` 的每一條 requirement 都是「來源長成某個樣子時，萃取要得到某個結果」。
 * 拿**真實**的 `~/.claude/projects` 當輸入是行不通的：它每天在變、30 天後被刪、而且開發者機器上
 * 那份含使用者的全部 prompt 內文。更關鍵的是 —— 真實資料裡**沒有反例**。「內文像中斷但不帶
 * `interruptedMessageId` 的記錄」在真實資料中一筆都沒有，於是那條斷言在正確與錯誤的實作下都
 * 會通過。**造得出反例的 fixture，才是那些 requirement 唯一的載體。**
 *
 * ## 產生器自己宣告它放了什麼
 *
 * 回傳的 `facts` 是**斷言的來源**，測試不得自己寫死數字。理由是本 repo 反覆踩過的那條：
 * fixture 一改（多加一種形態、修一個 typo），寫死的期望值就與內容分歧，而測試會**繼續是綠的**
 * ——因為它比對的是兩個都被改壞的常數。讓產生器同時產出內容與事實，兩者就不可能分歧。
 *
 * ## 自檢：時區那一形態可能沒有鑑別力
 *
 * 「時間軸以本機時區呈現」要驗，得有一筆**本機日期與 UTC 日期不同**的記錄。機器若跑在 UTC+0，
 * 這種記錄造不出來 —— 那時 `facts.timezoneShape` 為 `'no-offset'`，該條驗收應當**略過而非通過**
 * （比照 `polling-mount.testkit.ts` 的對照組自檢）。
 */

type Rec = Record<string, unknown>

/** 來源目錄名的生成規則：cwd 的每個非 ASCII 英數字元換成 `-`。與 Claude Code 一致。 */
export function encodeProjectDir(cwd: string): string {
  return [...cwd].map((ch) => (/[0-9A-Za-z]/.test(ch) ? ch : '-')).join('')
}

export interface FixtureProject {
  /** `projects/` 底下的目錄名（cwd 編碼後的樣子）。 */
  dirName: string
  /** 該專案的根 —— 反查後應當得到的那一個。 */
  cwd: string
  /** 反查後應當得到的顯示名稱。 */
  label: string
  /** 這個專案貢獻的使用者訊息數。 */
  userMessages: number
}

export interface TranscriptFixtureFacts {
  /** 傳給掃描器的來源根（`<root>/projects` 的上層，即 `CLAUDE_CONFIG_DIR` 該指的位置）。 */
  configDir: string
  projectsDir: string
  projects: FixtureProject[]

  /** 真正由使用者輸入的訊息總數（已排除 isMeta / 純通知 / 中斷 / bash 輸出）。 */
  userMessages: number
  /** 帶 `isMeta` 的記錄數 —— 全部都不該成為使用者訊息。 */
  metaRecords: number
  /** 帶 `isCompactSummary` 的記錄數。 */
  compactRecords: number
  /** 帶 `interruptedMessageId` 的記錄數。 */
  interrupts: number
  /** 內文像中斷、但**不帶**該欄位的記錄數 —— 它們是一般訊息。 */
  fakeInterrupts: number
  /** 通篇只有 `<task-notification>` 的記錄數 —— 一列都不該產生。 */
  pureNotifications: number
  /** 未知記錄類型的行數。 */
  unknownTypeRecords: number

  /** 工具呼叫總數（**含** subagent 檔案，比照 design D5）。 */
  toolCalls: number
  /** 各工具名稱的次數。 */
  toolsByName: Record<string, number>
  /** Bash 指令第一個 token 的次數。 */
  bashHeads: Record<string, number>
  /** Skill 名稱的次數。 */
  skills: Record<string, number>
  /** 帶用量資訊的 assistant 記錄數。 */
  usageRows: number

  /** 還原後應當出現的 slash command 字面。 */
  slashCommands: string[]
  /** `<bash-input>` 還原後應當出現的字面。 */
  bashInputs: string[]

  /** 以 30 分鐘間隔切段後應得的工作段數。 */
  workBlocks: number
  /** 最長一則使用者訊息的字元數（用來讓中位數與平均數拉開）。 */
  longestMessageChars: number

  /**
   * 時區形態的可用性。`'available'` 時，`timezoneLocalHour` 那筆記錄的本機日期與 UTC 日期不同；
   * `'no-offset'` 表示機器跑在 UTC，造不出對比 —— 該條驗收應當略過。
   */
  timezoneShape: 'available' | 'no-offset'
  /** 那筆記錄的本機小時：東半球為 0（凌晨），西半球為 23（深夜）。`'no-offset'` 時為 -1。 */
  timezoneLocalHour: number
}

const PROJ_A = '/fixture/proj-a'
/** 刻意放在別的根之下，且**不在** workspace 的 folder 清單裡。 */
const PROJ_B = '/fixture/elsewhere/proj-b'

/** 基準時刻：固定值，讓 fixture 每次產出完全相同。 */
const BASE = Date.UTC(2026, 0, 12, 2, 0, 0)

function iso(offsetMinutes: number): string {
  return new Date(BASE + offsetMinutes * 60_000).toISOString()
}

let uuidSeq = 0
function uuid(): string {
  uuidSeq += 1
  return `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`
}

function line(rec: Rec): string {
  return JSON.stringify(rec)
}

interface UserOpts {
  cwd: string
  minutes: number
  text: string
  meta?: boolean
  compact?: boolean
  interruptedMessageId?: string
  /** 直接指定時間戳，繞過 `minutes`（時區那一筆要用）。 */
  timestamp?: string
}

function userRecord(o: UserOpts): Rec {
  const rec: Rec = {
    type: 'user',
    uuid: uuid(),
    timestamp: o.timestamp ?? iso(o.minutes),
    cwd: o.cwd,
    message: { role: 'user', content: [{ type: 'text', text: o.text }] },
  }
  if (o.meta) rec.isMeta = true
  if (o.compact) rec.isCompactSummary = true
  if (o.interruptedMessageId) rec.interruptedMessageId = o.interruptedMessageId
  return rec
}

interface AssistantOpts {
  cwd: string
  minutes: number
  text?: string
  thinking?: string
  tools?: { name: string; input: Record<string, unknown> }[]
  usage?: boolean
}

function assistantRecord(o: AssistantOpts): Rec {
  const content: Rec[] = []
  if (o.thinking) content.push({ type: 'thinking', thinking: o.thinking })
  if (o.text) content.push({ type: 'text', text: o.text })
  for (const t of o.tools ?? []) {
    content.push({ type: 'tool_use', id: `toolu_${uuid().slice(-8)}`, name: t.name, input: t.input })
  }
  const message: Rec = { role: 'assistant', model: 'claude-opus-5', content }
  if (o.usage !== false) {
    message.usage = {
      input_tokens: 3,
      output_tokens: 120,
      cache_read_input_tokens: 45_000,
      cache_creation_input_tokens: 800,
    }
  }
  return { type: 'assistant', uuid: uuid(), timestamp: iso(o.minutes), cwd: o.cwd, message }
}

/** `role: user` 但內容是工具結果 —— 它**不是**使用者訊息。 */
function toolResultRecord(cwd: string, minutes: number, toolUseId: string, output: string): Rec {
  return {
    type: 'user',
    uuid: uuid(),
    timestamp: iso(minutes),
    cwd,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: output, is_error: false }],
    },
  }
}

/**
 * 造出一筆「本機日期與 UTC 日期不同」的時間戳。
 *
 * **取哪個鐘點取決於時區的方向，這件事第一版寫錯過。** 直覺會固定取當地 23:30，但那對
 * 東半球無效：UTC+8 的 23:30 是同一天的 UTC 15:30，日期一樣，於是那筆記錄**沒有鑑別力**
 * —— 用 UTC 分組的錯誤實作照樣把它放進同一格。
 *
 * - 本機**領先** UTC（東半球）：取當地 **00:30**，UTC 落在前一天。
 * - 本機**落後** UTC（西半球）：取當地 **23:30**，UTC 落在後一天。
 * - 偏移為 0：造不出對比，回傳 `null`。
 *
 * 兩者都符合該 requirement 的情境（深夜／凌晨還在工作），差別只在哪一邊會跨日。
 */
function localCrossDayTimestamp(): { timestamp: string; localHour: number } | null {
  // getTimezoneOffset 為「UTC 減本機」的分鐘數，東八區是 -480。
  const offset = new Date(BASE).getTimezoneOffset()
  if (offset === 0) return null
  const localHour = offset < 0 ? 0 : 23
  const local = new Date(BASE)
  local.setHours(localHour, 30, 0, 0)
  return { timestamp: local.toISOString(), localHour }
}

/**
 * 在 `root` 之下造出一份 transcript fixture。
 *
 * `root` 即掃描器該收到的設定目錄（`CLAUDE_CONFIG_DIR`），transcript 落在 `<root>/projects/`。
 */
export function writeTranscriptFixture(root: string): TranscriptFixtureFacts {
  uuidSeq = 0
  const projectsDir = path.join(root, 'projects')
  const dirA = path.join(projectsDir, encodeProjectDir(PROJ_A))
  const dirB = path.join(projectsDir, encodeProjectDir(PROJ_B))
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })

  const tz = localCrossDayTimestamp()
  // 長度刻意誇張：中位數約 30，這一則要把平均拉高一個數量級以上，
  // 「不得以平均數呈現」那條的對照組才有明確的紅。
  const longText = `X${'長'.repeat(8000)}`

  // ---- session 1：形態最密集的一支 ----------------------------------------
  const s1: Rec[] = []
  s1.push({ type: 'summary', summary: 'fixture session', uuid: uuid() })
  s1.push({ type: 'spekterm-unknown-kind', note: 'this type must be ignored', uuid: uuid() })

  s1.push(userRecord({ cwd: PROJ_A, minutes: 0, text: '把 A 改好' }))
  s1.push(assistantRecord({
    cwd: PROJ_A, minutes: 1, thinking: '想一下', text: '好',
    tools: [{ name: 'Bash', input: { command: 'grep -rn foo src/' } }],
  }))
  s1.push(toolResultRecord(PROJ_A, 2, 'toolu_a', 'src/foo.ts:1'))

  // isMeta：skill 展開的內文。長度刻意很長 —— 誤收它會同時弄壞訊息數與長度平均。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 3, meta: true, text: `Base directory for this skill\n${'指示'.repeat(400)}` }))
  // isMeta：其他 session 送來的訊息。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 4, meta: true, text: 'Another Claude session sent a message:\n<cross-session-message/>' }))
  // isMeta：圖片佔位。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 5, meta: true, text: '[Image: original 100x200, displayed at 50x100.]' }))
  // isMeta：**內文與一般的使用者訊息完全無法區分**。
  //
  // 這一筆是「判定必須看結構旗標」那條 requirement 的載體。少了它，fixture 對
  // 「看 isMeta」與「比對內文開頭長什麼樣」兩種實作會給出**相同的結果** —— 實測過：把判定換成
  // 文字比對之後全部測試照樣通過。真實資料裡 skill 的內文可以長成任何樣子，
  // 而**看起來正常的那一筆才是會被漏掉的那一筆**。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 5.5, meta: true, text: '把 C 也順便改一下' }))

  // 中斷：帶結構欄位。
  s1.push(userRecord({
    cwd: PROJ_A, minutes: 6, interruptedMessageId: 'msg_abc',
    text: '[Request interrupted by user for tool use]',
  }))
  // **反例**：內文一模一樣，但不帶欄位 —— 它是一般訊息。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 7, text: '[Request interrupted by user for tool use]' }))

  // slash command 的 XML 展開。
  s1.push(userRecord({
    cwd: PROJ_A, minutes: 8,
    text: '<command-message>opsx:continue</command-message>\n<command-name>/opsx:continue</command-name>\n<command-args>my-change</command-args>',
  }))
  // `!` 前綴的 bash：輸入是使用者打的，輸出不是。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 9, text: '<bash-input>ls -la</bash-input>' }))
  s1.push(userRecord({ cwd: PROJ_A, minutes: 10, text: '<bash-stdout>total 0</bash-stdout><bash-stderr></bash-stderr>' }))

  // 純通知：一列都不該產生。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 11, text: '<task-notification>agent 完成了</task-notification>' }))
  // 通知夾雜：其餘內文要留下。
  s1.push(userRecord({ cwd: PROJ_A, minutes: 12, text: '<task-notification>背景更新</task-notification>接著把 B 也修掉' }))

  // 脈絡壓縮。
  s1.push(userRecord({
    cwd: PROJ_A, minutes: 13, compact: true,
    text: 'This session is being continued from a previous conversation…',
  }))

  // cwd 中途改變 —— 反查若取「最後一個」或「任何一個」就會標錯專案。
  s1.push(userRecord({ cwd: '/tmp/scratchpad', minutes: 14, text: '看一下 scratchpad' }))
  s1.push(assistantRecord({
    cwd: '/tmp/scratchpad', minutes: 15,
    tools: [
      { name: 'Skill', input: { skill: 'opsx:continue' } },
      { name: 'Agent', input: { subagent_type: 'Explore' } },
    ],
  }))
  s1.push(userRecord({ cwd: `${PROJ_A}/deep/sub`, minutes: 16, text: '回來了' }))

  // 極長訊息：讓中位數與平均數拉開一個數量級。
  // **這幾筆的 cwd 刻意留在子目錄**，於是 session 的「最後一個 cwd」不等於專案根 ——
  // 「取最後一個 cwd 當專案」的錯誤實作因此會標錯名字，而那正是要驗的。
  s1.push(userRecord({ cwd: `${PROJ_A}/deep/sub`, minutes: 17, text: longText }))

  // 時區形態（造得出來才寫）。
  if (tz) s1.push(userRecord({ cwd: `${PROJ_A}/deep/sub`, minutes: 0, timestamp: tz.timestamp, text: '半夜還在弄' }))

  writeFileSync(path.join(dirA, 'session-1.jsonl'), `${s1.map(line).join('\n')}\n`, { mode: 0o600 })

  // ---- session 1 的 subagent：工具算它、使用者訊息不算 ---------------------
  const subDir = path.join(dirA, 'session-1', 'subagents')
  mkdirSync(subDir, { recursive: true })
  const sub: Rec[] = [
    // orchestrator 寫給 subagent 的指令 —— 角色是 user，但不是使用者打的。
    userRecord({ cwd: PROJ_A, minutes: 18, text: '去把測試跑完' }),
    assistantRecord({
      cwd: PROJ_A, minutes: 19,
      tools: [{ name: 'Bash', input: { command: 'npm test' } }],
    }),
  ]
  writeFileSync(path.join(subDir, 'agent-1.jsonl'), `${sub.map(line).join('\n')}\n`, { mode: 0o600 })

  // ---- session 2：跨時段，且 agent 連跑工具不該被切開 ----------------------
  const s2: Rec[] = []
  s2.push(userRecord({ cwd: PROJ_A, minutes: 100, text: '第一段開始' }))
  // 連續工具呼叫間隔 20 分鐘 —— 未超過 30 分鐘門檻，同一段。
  s2.push(assistantRecord({ cwd: PROJ_A, minutes: 120, tools: [{ name: 'Bash', input: { command: 'npm run build' } }] }))
  s2.push(assistantRecord({ cwd: PROJ_A, minutes: 140, tools: [{ name: 'Read', input: { file_path: '/fixture/proj-a/x.ts' } }] }))
  // 隔 4 小時 —— 第二段。
  s2.push(userRecord({ cwd: PROJ_A, minutes: 380, text: '第二段開始' }))
  s2.push(assistantRecord({ cwd: PROJ_A, minutes: 385, text: '好' }))
  writeFileSync(path.join(dirA, 'session-2.jsonl'), `${s2.map(line).join('\n')}\n`, { mode: 0o600 })

  // ---- session 3：另一個專案，且不在 workspace 的 folder 清單裡 ------------
  const s3: Rec[] = [
    userRecord({ cwd: PROJ_B, minutes: 500, text: '這個專案不在 workspace 裡' }),
    assistantRecord({ cwd: PROJ_B, minutes: 501, tools: [{ name: 'Bash', input: { command: 'git status' } }] }),
  ]
  writeFileSync(path.join(dirB, 'session-3.jsonl'), `${s3.map(line).join('\n')}\n`, { mode: 0o600 })

  // ---- 宣告事實 -----------------------------------------------------------
  // session 1：把 A 改好／[Request interrupted…]（假的）／/opsx:continue／!ls -la／
  //            接著把 B 也修掉／看一下 scratchpad／回來了／極長訊息／（時區那筆）
  const s1UserMessages = 8 + (tz ? 1 : 0)
  const s2UserMessages = 2
  const s3UserMessages = 1

  return {
    configDir: root,
    projectsDir,
    projects: [
      { dirName: encodeProjectDir(PROJ_A), cwd: PROJ_A, label: 'proj-a', userMessages: s1UserMessages + s2UserMessages },
      { dirName: encodeProjectDir(PROJ_B), cwd: PROJ_B, label: 'proj-b', userMessages: s3UserMessages },
    ],
    userMessages: s1UserMessages + s2UserMessages + s3UserMessages,
    metaRecords: 4,
    compactRecords: 1,
    interrupts: 1,
    fakeInterrupts: 1,
    pureNotifications: 1,
    unknownTypeRecords: 1,

    // Bash 4（grep／npm test／npm run build／git status）＋ Skill 1 ＋ Agent 1 ＋ Read 1。
    // `ls -la` 是 `<bash-input>` 的使用者輸入，**不是** tool_use，不計在這裡。
    toolCalls: 7,
    toolsByName: { Bash: 4, Skill: 1, Agent: 1, Read: 1 },
    bashHeads: { grep: 1, npm: 2, git: 1 },
    skills: { 'opsx:continue': 1 },
    usageRows: 7,

    slashCommands: ['/opsx:continue my-change'],
    bashInputs: ['!ls -la'],

    // session 1 全部落在 17 分鐘內（時區那筆另計，見下）＝ 1 段；
    // session 2 ＝ 2 段；session 3 ＝ 1 段。時區那筆若存在會自成一段。
    workBlocks: (tz ? 2 : 1) + 2 + 1,
    longestMessageChars: longText.length,

    timezoneShape: tz ? 'available' : 'no-offset',
    timezoneLocalHour: tz ? tz.localHour : -1,
  }
}
