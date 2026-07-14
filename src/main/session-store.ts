import fs from 'node:fs'
import path from 'node:path'
import type { SpawnTarget } from './terminal'

/**
 * session 清單的結構版本。比照 `workspace-store` —— 從第一天就寫入。
 */
export const SESSIONS_VERSION = 1

/** 快照的位元組上限。超過者留尾端（見 `clampScrollback`）。 */
export const SCROLLBACK_MAX_BYTES = 256 * 1024

/**
 * 嚴格的 UUID 判定。
 *
 * **這不是型別檢查，是安全邊界。** `claudeSessionId` 會被拼接進 `$SHELL -l -c "claude --resume <id>"`
 * —— 一個字串命令；`id` 會成為 `<userData>/sessions/<id>.scrollback` 的一段 —— 一個檔案路徑。
 * 兩者都來自**磁碟上的檔案**，而磁碟上的檔案是不受信任的輸入（可能被竄改或損毀）。
 *
 * 與 `openspec` 的 slug／topic 同源（`openspec-side-panel` 的 design D6）：白名單式的**格式**判定，
 * 不是「有沒有 `..`」那種黑名單 —— 後者總有漏網的編碼形式。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * 一個被持久化的 session。
 *
 * 欄位分兩類，這個區分是承重的（design D7／D9）：
 *
 * - **renderer 供應**：`folderId`／`spawnTarget`／`ordinal`／`customTitle`／`title`／`anchoredChange`
 *   —— 使用者在 renderer 上建立的身分與順序。
 * - **主行程供應**：`claudeSessionId`／`cwd` —— renderer **從來沒有**這兩個詞彙。前者是拼進命令的
 *   識別碼，後者是一個絕對路徑；把任何一個交給 renderer 去保管再送回來，等於把邊界拱手讓出。
 */
export interface PersistedSession {
  id: string
  folderId: string
  spawnTarget: SpawnTarget
  ordinal: number
  /** 使用者親自取的名字（＝永久接管命名權）。 */
  customTitle?: string
  /**
   * pty 最近一次以 OSC 宣告的標題。
   *
   * **休眠的 session 沒有 pty 可以再宣告一次** —— 不存它，重開後那些分頁就通通退回
   * `claude 1`／`claude 2`，使用者認不出哪個是哪個（而它們正是被 claude 依任務命名的那些）。
   * 它不是「可由當下環境廉價重算的衍生狀態」（那種東西的典型是 `hasOpenSpec`、`branch`）——
   * 要重新求得它，只能把 pty 叫起來然後等。session 一被喚醒，pty 的下一次宣告就會覆蓋它。
   */
  title?: string
  anchoredChange?: string
  /**
   * claude 的**對話**識別碼。與 `id`（spekterm 的 session identity）**刻意分離**：
   * 續接失敗時必須換一個全新的對話 id（沿用舊的會撞上 `Session ID … is already in use.`），
   * 若兩者是同一個欄位，換號就等於換掉 session 的身分（design D1）。
   */
  claudeSessionId?: string
  /** 最後已知的工作目錄（僅 shell 目標有意義）。恆為絕對路徑，恆由主行程供應。 */
  cwd?: string
}

interface PersistedSessions {
  version: number
  sessions: PersistedSession[]
}

/** renderer 送來的部分 —— 明確地**不含** `claudeSessionId` 與 `cwd`。 */
export type RendererSession = Omit<PersistedSession, 'claudeSessionId' | 'cwd'>

function isSpawnTarget(value: unknown): value is SpawnTarget {
  return value === 'claude' || value === 'shell'
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 單一項目的驗證。不合法回 `null` —— 呼叫端丟棄**該項**即可，其餘照常重建。
 *
 * **這與 `workspace-store.parseWorkspace` 的策略刻意不同**（那一份對任何一個壞掉的項目就整份放棄）：
 * 一個壞掉的 session 不該讓使用者其餘所有 session 一起消失。
 */
export function parseSessionEntry(entry: unknown): PersistedSession | null {
  if (typeof entry !== 'object' || entry === null) return null
  const raw = entry as Record<string, unknown>

  if (!isUuid(raw.id)) return null
  if (typeof raw.folderId !== 'string' || raw.folderId === '') return null
  if (!isSpawnTarget(raw.spawnTarget)) return null
  if (typeof raw.ordinal !== 'number' || !Number.isFinite(raw.ordinal)) return null

  // 對話識別碼不合法時**不丟棄整個 session** —— 只丟棄那筆續接資訊，該 session 以一個全新的
  // 對話重建（spec：「不合法的對話識別碼不進入命令」）。
  const claudeSessionId = isUuid(raw.claudeSessionId) ? raw.claudeSessionId : undefined

  return {
    id: raw.id,
    folderId: raw.folderId,
    spawnTarget: raw.spawnTarget,
    ordinal: raw.ordinal,
    customTitle: optionalString(raw.customTitle),
    title: optionalString(raw.title),
    anchoredChange: optionalString(raw.anchoredChange),
    claudeSessionId,
    // 絕對路徑才有意義；相對路徑無從解讀，丟棄後退回 folder 根目錄。
    cwd: typeof raw.cwd === 'string' && path.isAbsolute(raw.cwd) ? raw.cwd : undefined,
  }
}

/** 整份無法信任時回 `null`（由呼叫端隔離該檔）。個別項目不合法則只丟棄該項。 */
export function parseSessions(raw: string): PersistedSession[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof data !== 'object' || data === null) return null
  const { version, sessions } = data as Record<string, unknown>
  if (version !== SESSIONS_VERSION) return null
  if (!Array.isArray(sessions)) return null

  const parsed: PersistedSession[] = []
  for (const entry of sessions) {
    const session = parseSessionEntry(entry)
    if (session) parsed.push(session)
    else console.error('[sessions] discarded an unreadable session entry')
  }
  return parsed
}

/**
 * 夾制快照大小。超出上限時保留**尾端**（最近的內容才是使用者想看的）。
 *
 * 切點必須落在換行之後 —— 從位元組中間切開會把一段 escape sequence 攔腰斬斷，重播時吐出
 * 半截控制碼。這無法完全避免（一段序列理論上可跨行），但重播端會先送一次終端 reset，
 * 殘留的狀態不會流進 live 內容。
 */
export function clampScrollback(data: string): string {
  if (Buffer.byteLength(data, 'utf8') <= SCROLLBACK_MAX_BYTES) return data
  const tail = Buffer.from(data, 'utf8').subarray(-SCROLLBACK_MAX_BYTES).toString('utf8')
  const newline = tail.indexOf('\n')
  return newline === -1 ? tail : tail.slice(newline + 1)
}

function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

function quarantine(filePath: string): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${filePath}.corrupt-${stamp}`
  try {
    fs.renameSync(filePath, target)
    return target
  } catch {
    return null
  }
}

/**
 * session 清單與終端畫面快照的持久化。
 *
 * 快照**不放進 `sessions.json`** —— 那會讓一個每次都要整份重寫的小檔漲到 MB 級。每個 session
 * 一個檔（`<dir>/<id>.scrollback`），檔名的 `id` 必先通過 UUID 驗證。
 */
export class SessionStore {
  #sessions: PersistedSession[] = []

  /**
   * 主行程已經知道、但 renderer 還沒把該 session 送來持久化的欄位。
   *
   * **這個暫存不是可有可無的**：新建一個 claude session 時，主行程在 `create` 回傳的當下就知道
   * 對話識別碼了，而 renderer 要等 `setState` 之後才會送出它的 session 清單 —— 若此時直接
   * `update()`，清單裡還沒有這一筆，那個識別碼就被靜默丟棄，**下次重開時無從續接**（症狀是
   * 「每個 claude session 都從新對話開始」，而且不會有任何錯誤訊息）。
   */
  #pendingMainFields = new Map<string, Partial<Pick<PersistedSession, 'claudeSessionId' | 'cwd'>>>()

  /**
   * 已經確定結束（pty 自己死了、或使用者關掉）的 session。**它們不得被復活。**
   *
   * renderer 的清單是 debounce 落盤的 —— 待寫入的那一份可能是**在該 session 結束之前**擷取的。
   * 若使用者剛好在這個窗口裡關掉 app，關窗時的 flush 會拿那份過期的清單去 `replace()`，把一個
   * 已經死掉的 session 寫回 `sessions.json`，下次以休眠態重建回來（spec：「已結束的 session
   * 不被持久化」）。
   *
   * session 的識別碼是 UUID、永不重用，因此這個集合只增不減是安全的（每個 app 生命週期內，
   * 它的上限就是使用者關掉過的 session 數）。
   */
  #gone = new Set<string>()

  constructor(
    private readonly filePath: string,
    private readonly scrollbackDir: string,
  ) {}

  /** **任何讀取失敗都不得讓應用程式開不起來** —— 與 `WorkspaceStore.load` 同一條紀律。 */
  load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[sessions] unreadable, starting with an empty list: ${String(error)}`)
      }
      this.#sessions = []
      // 孤兒快照仍要清 —— 設定檔不見了，那些快照就更沒有歸屬了。
      this.pruneScrollback()
      return
    }

    const parsed = parseSessions(raw)
    if (!parsed) {
      const kept = quarantine(this.filePath)
      console.error(
        `[sessions] unparsable, starting with an empty list` +
          (kept ? `; the original was kept at ${kept}` : `; the original could not be kept`),
      )
      this.#sessions = []
      this.pruneScrollback()
      return
    }

    this.#sessions = parsed
    this.pruneScrollback()
  }

  list(): PersistedSession[] {
    return this.#sessions.map((session) => ({ ...session }))
  }

  get(sessionId: string): PersistedSession | undefined {
    const found = this.#sessions.find((session) => session.id === sessionId)
    return found ? { ...found } : undefined
  }

  /**
   * 以 renderer 送來的清單取代 metadata，**保留主行程自己的欄位**（`claudeSessionId`／`cwd`）。
   *
   * 成員資格以 renderer 的清單為準 —— 不在其中的 session（已關閉、或已結束而不再持久化）
   * 連同它的快照一併移除。
   */
  replace(incoming: RendererSession[]): void {
    const previous = new Map(this.#sessions.map((session) => [session.id, session]))

    const next: PersistedSession[] = []
    for (const entry of incoming) {
      if (!isUuid(entry.id)) continue
      // 已經確定結束的 session，不因為一份過期的清單而復活（見 `#gone`）。
      if (this.#gone.has(entry.id)) continue
      const kept = previous.get(entry.id)
      const waiting = this.#pendingMainFields.get(entry.id)
      this.#pendingMainFields.delete(entry.id)
      next.push({
        ...entry,
        claudeSessionId: waiting?.claudeSessionId ?? kept?.claudeSessionId,
        cwd: waiting?.cwd ?? kept?.cwd,
      })
    }

    const surviving = new Set(next.map((session) => session.id))
    for (const id of previous.keys()) {
      if (!surviving.has(id)) this.deleteScrollback(id)
    }

    this.#sessions = next
    this.save()
  }

  /**
   * 主行程專屬的欄位更新（spawn 之後才知道實際使用的對話 id；cwd 隨時可能變）。
   *
   * 該 session 尚未被 renderer 送來持久化時，先記在 `#pendingMainFields`，等它到達再併入。
   */
  update(
    sessionId: string,
    patch: Partial<Pick<PersistedSession, 'claudeSessionId' | 'cwd'>>,
  ): void {
    const target = this.#sessions.find((session) => session.id === sessionId)
    if (!target) {
      this.#pendingMainFields.set(sessionId, {
        ...this.#pendingMainFields.get(sessionId),
        ...patch,
      })
      return
    }

    let changed = false
    if ('claudeSessionId' in patch && patch.claudeSessionId !== target.claudeSessionId) {
      target.claudeSessionId = patch.claudeSessionId
      changed = true
    }
    if ('cwd' in patch && patch.cwd !== target.cwd) {
      target.cwd = patch.cwd
      changed = true
    }
    if (changed) this.save()
  }

  remove(sessionId: string): void {
    this.#pendingMainFields.delete(sessionId)
    // 墓碑必須在「這筆是否存在」之前立起來 —— 一個尚未被 renderer persist 過的 session 也可能
    // 已經死了（例如 claude 啟動失敗），而它的 id 仍然躺在待寫入的清單裡。
    if (isUuid(sessionId)) this.#gone.add(sessionId)

    const next = this.#sessions.filter((session) => session.id !== sessionId)
    if (next.length === this.#sessions.length) return
    this.#sessions = next
    this.deleteScrollback(sessionId)
    this.save()
  }

  readScrollback(sessionId: string): string | null {
    const file = this.scrollbackPath(sessionId)
    if (!file) return null
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      return null
    }
  }

  writeScrollback(sessionId: string, data: string): void {
    const file = this.scrollbackPath(sessionId)
    if (!file) return
    try {
      writeFileAtomic(file, clampScrollback(data))
    } catch (error) {
      // 快照寫不進去不是致命的 —— 下次還會再寫一份。絕不因此中斷任何事。
      console.error(`[sessions] snapshot write failed: ${String(error)}`)
    }
  }

  deleteScrollback(sessionId: string): void {
    const file = this.scrollbackPath(sessionId)
    if (!file) return
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // 刪不掉就留著，下次 prune 會處理。
    }
  }

  /** 清掉沒有對應 session 的孤兒快照（crash 後可能殘留）。 */
  pruneScrollback(): void {
    let entries: string[]
    try {
      entries = fs.readdirSync(this.scrollbackDir)
    } catch {
      return
    }

    const known = new Set(this.#sessions.map((session) => session.id))
    for (const entry of entries) {
      if (!entry.endsWith('.scrollback')) continue
      const id = entry.slice(0, -'.scrollback'.length)
      if (known.has(id)) continue
      try {
        fs.rmSync(path.join(this.scrollbackDir, entry), { force: true })
      } catch {
        // 忽略：孤兒檔案留著只是佔空間。
      }
    }
  }

  /** 檔名由 UUID 構成，因此不可能逸出 `scrollbackDir`。非 UUID 一律拒絕。 */
  private scrollbackPath(sessionId: string): string | null {
    if (!isUuid(sessionId)) {
      console.error('[sessions] refused to build a snapshot path from a non-UUID id')
      return null
    }
    return path.join(this.scrollbackDir, `${sessionId}.scrollback`)
  }

  private save(): void {
    const payload: PersistedSessions = { version: SESSIONS_VERSION, sessions: this.#sessions }
    try {
      writeFileAtomic(this.filePath, `${JSON.stringify(payload, null, 2)}\n`)
    } catch (error) {
      console.error(`[sessions] write failed: ${String(error)}`)
    }
  }
}
