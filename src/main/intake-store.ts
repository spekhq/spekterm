import fs from 'node:fs'
import path from 'node:path'

import type { Intake, IntakeAuthored, IntakeRejection, IntakeVerified } from './intake-schema'

/**
 * 收件匣的狀態 index。
 *
 * ## 去重鍵與內容的保留期限**分開**
 *
 * 一則 intake 的紀錄有兩層：
 *
 * - **去重鍵**（adapter、識別碼、狀態、內容雜湊）—— 數十位元組，**永久保留**。
 *   清除它等同放棄對該識別碼的去重，而去重是這條管線唯一防止「同一個 mention 開出五個
 *   session」的機制。
 * - **內容**（通用欄位、保存的投遞、交給 agent 的檔案）—— **可過期**。
 *
 * 少了這個區分，index 會單調成長，**而它在每次投遞時被整份重寫**。
 *
 * ## 「去重由結構保證」講的是哪一半
 *
 * 「讀入後把項目移出落點」保證的是**同一個檔案不會被重複消費**（尤其是重啟之後）。
 * **跨檔案的去重靠這份 index** —— producer 重送一個新檔案、同一個識別碼時，唯一擋得住它的
 * 就是這裡的鍵。兩者不是同一件事，而把它們混為一談會讓保留期限看起來像個無關緊要的旋鈕。
 *
 * ## 內容相同的重複要靜默
 *
 * 內容雜湊存在這裡，**唯一的用途是分辨「正常的重送」與「識別碼搶佔」**：前者是 producer 的
 * 重試與系統自身「先監看再掃描」刻意造成的重複讀取，做成可見的拒絕等於每次啟動都對使用者
 * 報告一件他沒做過的事；後者才是那個唯一的警訊。**讓噪音與警訊走同一個通道，等於把警訊關掉。**
 */

export type IntakeState = 'pending' | 'accepted' | 'dismissed'

/** 永久保留的那一半。 */
interface IntakeKey {
  adapter: string
  id: string
  state: IntakeState
  /** 內容雜湊 —— 分辨正常重送與識別碼搶佔。 */
  digest: string
  /** 已接受者建立了哪個 session。**關聯只存在 intake 這一側。** */
  sessionId?: string
}

/** 可過期的那一半。 */
interface IntakeContent {
  verified: IntakeVerified
  authored: IntakeAuthored
  receivedAt: number
}

export interface IntakeRecord extends IntakeKey {
  content: IntakeContent | null
}

/**
 * 一次拒絕在收件匣中的**痕跡**。
 *
 * 它住在資料層而不是 `intake-service`，理由只有一個：**落盤在這裡**，而 service 已經
 * import store —— 反過來會是循環依賴。
 */
export interface IntakeNotice {
  key: string
  code: IntakeRejection
  count: number
  detail?: string
  /**
   * **最近一次**發生的時刻。
   *
   * 合併時保留最近而非最早：使用者要知道的是「這件事還在發生嗎」，而一個停在三天前的
   * 時刻對那個問題完全沉默。
   */
  at: number
  /** 來源座標的標籤。**已正規化。** */
  origin?: string
  /** 投遞者寫下的目標原字串。**第三方可控，已正規化。** */
  target?: string
  /** 投遞的 adapter —— 上界的額度以它分配。 */
  adapter?: string
  /**
   * 重送會不會有不同結果。**只有永久性的才落盤。**
   *
   * 暫時性的每次重試都會再產生一次，落盤只是累積同一件事的副本。
   */
  permanent: boolean
}

interface PersistedIntake {
  version: number
  entries: IntakeRecord[]
  /**
   * 永久性拒絕的痕跡。**optional** —— 見 `INTAKE_VERSION` 的註解。
   */
  notices?: IntakeNotice[]
}

/**
 * 落盤格式的版本。
 *
 * **加欄位時 SHALL NOT 遞增它。** loader 是 `version !== INTAKE_VERSION ⇒ return null`，
 * 於是遞增一次就把使用者收件匣裡的每一則都丟掉。新欄位一律以 optional 加入，缺它時視為空。
 *
 * 反向也成立：舊版讀到多一個區段時，逐欄位白名單會原樣丟棄它而 `entries` 一則不少 ——
 * **回滾不會清空收件匣**。
 */
export const INTAKE_VERSION = 1

/** 待處理的則數上限。**保護的是收件匣，不是主行程的工作量。** */
export const MAX_PENDING = 200

/**
 * 主鍵 —— `(adapter, id)`。adapter 由接收端決定，不採信 payload 自稱的來源。
 *
 * 分隔符用 NUL 是對的（它不可能出現在識別碼裡），但**必須寫成 escape 序列而不是字面的位元組** ——
 * 一個字面 NUL 會讓 `grep` / `git grep` / `git diff` 對**整個檔案**瞎掉，而它回空 + exit 1，
 * 連「binary file」都不說。這個檔案原本就是那樣（本 repo 的第四例），於是「把某個符號 grep 一遍」
 * 這種清查技術在它上面有一個沒人發現的盲點。
 */
export function intakeKeyOf(adapter: string, id: string): string {
  return `${adapter}\x00${id}`
}

/**
 * 內容的摘要。**不是密碼學用途** —— 它只用來分辨「同一則又送了一次」與「同一個識別碼、
 * 不同內容」，而兩者都是本機的、非對抗性的比較。刻意不引入雜湊依賴。
 */
export function digestOf(authored: IntakeAuthored, verified: IntakeVerified): string {
  const payload = JSON.stringify([
    verified.originKind,
    verified.originId,
    authored.title,
    authored.body,
    authored.actor,
    authored.originLabel,
  ])
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < payload.length; i += 1) {
    const c = payload.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function parseIntakeFile(raw: string): PersistedIntake | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { version, entries } = data as Record<string, unknown>
  if (version !== INTAKE_VERSION || !Array.isArray(entries)) return null

  // **逐欄位白名單。** 「移除一個欄位」不等於「它不會再被寫進磁碟」—— 原樣展開的先例
  // （`SessionStore.replace()`）已經被改掉過一次，這裡從一開始就不給它機會。
  const kept: IntakeRecord[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.adapter !== 'string' || typeof e.id !== 'string') continue
    if (e.state !== 'pending' && e.state !== 'accepted' && e.state !== 'dismissed') continue
    if (typeof e.digest !== 'string') continue
    const content = e.content
    kept.push({
      adapter: e.adapter,
      id: e.id,
      state: e.state,
      digest: e.digest,
      ...(typeof e.sessionId === 'string' ? { sessionId: e.sessionId } : {}),
      content: isContent(content) ? content : null,
    })
  }
  return { version: INTAKE_VERSION, entries: kept, notices: parseNotices((data as Record<string, unknown>).notices) }
}

/** 痕跡同樣走**逐欄位白名單**。缺這個區段（舊版寫出來的檔案）時視為空。 */
function parseNotices(raw: unknown): IntakeNotice[] {
  if (!Array.isArray(raw)) return []
  const kept: IntakeNotice[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const n = entry as Record<string, unknown>
    if (typeof n.key !== 'string' || typeof n.code !== 'string') continue
    if (typeof n.count !== 'number' || typeof n.at !== 'number') continue
    kept.push({
      key: n.key,
      code: n.code as IntakeRejection,
      count: n.count,
      at: n.at,
      permanent: true,
      ...(typeof n.detail === 'string' ? { detail: n.detail } : {}),
      ...(typeof n.origin === 'string' ? { origin: n.origin } : {}),
      ...(typeof n.target === 'string' ? { target: n.target } : {}),
      ...(typeof n.adapter === 'string' ? { adapter: n.adapter } : {}),
    })
  }
  return kept
}

function isContent(value: unknown): value is IntakeContent {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  if (typeof c.receivedAt !== 'number') return false
  const v = c.verified as Record<string, unknown> | undefined
  const a = c.authored as Record<string, unknown> | undefined
  if (!v || !a) return false
  return (
    typeof v.adapter === 'string' &&
    typeof v.originKind === 'string' &&
    typeof v.originId === 'string' &&
    typeof a.title === 'string' &&
    typeof a.body === 'string' &&
    typeof a.actor === 'string' &&
    typeof a.originLabel === 'string'
  )
}

export class IntakeStore {
  #entries = new Map<string, IntakeRecord>()
  /** 永久性拒絕的痕跡。**暫時性的不在這裡** —— 它們每次重試都會再產生一次。 */
  #notices: IntakeNotice[] = []

  constructor(private readonly filePath: string) {}

  load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch {
      return
    }
    const parsed = parseIntakeFile(raw)
    if (!parsed) return
    for (const entry of parsed.entries) {
      this.#entries.set(intakeKeyOf(entry.adapter, entry.id), entry)
    }
    this.#notices = parsed.notices ?? []
  }

  /** 落盤的痕跡（載入時取回）。 */
  notices(): IntakeNotice[] {
    return this.#notices.map((n) => ({ ...n }))
  }

  /**
   * 取代落盤的痕跡。**只收永久性的** —— 暫時性的每次重試都會再產生一次，
   * 落盤只是累積同一件事的副本。
   */
  setNotices(notices: readonly IntakeNotice[]): void {
    this.#notices = notices.filter((n) => n.permanent).map((n) => ({ ...n }))
    this.save()
  }

  save(): void {
    const payload: PersistedIntake = {
      version: INTAKE_VERSION,
      entries: [...this.#entries.values()],
      ...(this.#notices.length > 0 ? { notices: this.#notices } : {}),
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }

  get(adapter: string, id: string): IntakeRecord | undefined {
    return this.#entries.get(intakeKeyOf(adapter, id))
  }

  list(): IntakeRecord[] {
    return [...this.#entries.values()]
  }

  pendingCount(): number {
    let count = 0
    for (const entry of this.#entries.values()) if (entry.state === 'pending') count += 1
    return count
  }

  /** 收下一則新的 intake。呼叫端已確認它不是重複。 */
  add(intake: Intake): IntakeRecord {
    const record: IntakeRecord = {
      adapter: intake.verified.adapter,
      id: intake.id,
      state: 'pending',
      digest: digestOf(intake.authored, intake.verified),
      content: {
        verified: intake.verified,
        authored: intake.authored,
        receivedAt: intake.receivedAt,
      },
    }
    this.#entries.set(intakeKeyOf(record.adapter, record.id), record)
    this.save()
    return record
  }

  setState(adapter: string, id: string, state: IntakeState, sessionId?: string): void {
    const record = this.#entries.get(intakeKeyOf(adapter, id))
    if (!record) return
    record.state = state
    if (sessionId !== undefined) record.sessionId = sessionId
    this.save()
  }

  /**
   * 清除內容而**保留去重鍵**。
   *
   * 這是「兩層保留期限」在資料上的兌現：清完之後 `get()` 仍然找得到那個鍵，
   * 於是同一個識別碼再投遞一次仍然被判為重複。
   */
  expireContent(adapter: string, id: string): void {
    const record = this.#entries.get(intakeKeyOf(adapter, id))
    if (!record) return
    record.content = null
    this.save()
  }
}
