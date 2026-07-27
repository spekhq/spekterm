import fs from 'node:fs'
import path from 'node:path'
import { isWorktreeKey } from './worktree-key'

/**
 * 側欄座標的結構版本。從第一天就寫入 —— 比照 `workspace-store` / `session-store` /
 * `preferences-store`。
 */
export const PANEL_VERSION = 1

/**
 * 一個 rail 項目的側欄座標：side panel 站在這個項目上時，看的是什麼。
 *
 * 三個維度全部 optional —— 省略即預設（來源＝該項目自身、工作目錄＝folder 自身、無明確錨定）。
 *
 * **兩個維度隸屬於「來源 repo」，不是隸屬於 rail 項目自身的 repo**：工作目錄識別碼與 change slug
 * 都是某個 repo 內部的座標。那是「切換來源時重置這兩個維度」的理由（renderer 側，見
 * `PanelCoordinateProvider`）。
 */
export interface PanelCoordinate {
  /** 側欄呈現哪個 repo（folder 識別碼）。省略＝該 rail 項目自身。 */
  sourceFolderId?: string
  /** Files 身分以哪個工作目錄為樹根（不可逆識別碼）。省略＝ folder 自身。 */
  worktreeKey?: string
  /** 「本 change」視圖呈現哪個 change。省略＝無明確錨定，由衍生預設接手。 */
  anchoredChange?: string
}

/** 鍵為 **rail 項目的識別碼**（今日恰為 folder id，見下方 `#belongsTo`）。 */
export type PanelCoordinates = Record<string, PanelCoordinate>

interface PersistedPanel {
  version: number
  coordinates: PanelCoordinates
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 單一座標的清理。**寫入端與讀取端共用它** —— 這一點是承重的。
 *
 * `side-panel-source` 的「落盤的內容 SHALL NOT 包含任何絕對或相對路徑」是一條關於**磁碟內容**
 * 的要求，因此驗證必須發生在**寫入的入口**。只在讀取時丟棄不合法的值，磁碟上仍然留著它 ——
 * 那條 SHALL 就成了一句沒有人負責的宣稱，而任何「寫一份合法座標再讀回來」的測試都會通過，
 * 不論實作對錯。
 *
 * **這裡刻意不照抄 `session-store.replace()` 的姿態**：那一份是 `...entry` 原樣展開、只檢查
 * `isUuid(entry.id)`，驗證全在 `parseSessionEntry`（讀）那一側。
 *
 * 三個維度三種姿態（見本 change 的 design D10）：
 *
 * - `worktreeKey` —— 不可逆識別碼，格式白名單。
 * - `sourceFolderId` —— folder 識別碼，**不對格式設限**（它由 `workspace-store` 產生 `randomUUID`，
 *   但探針與手動設定的 workspace 會用可讀的識別碼；驗成 UUID 會把那些一律丟掉）。指向的 folder
 *   不存在時由 renderer 退回自身，那是誠實性而非圍堵性的問題。
 * - `anchoredChange` —— slug。它被用於組成檔案路徑時的防護**不在這裡**，而是
 *   `openspec-service` 既有的白名單查表（只對確實存在於掃描結果中的識別碼呼叫 core）。
 *   換一個落盤位置不改變那條路徑上的任何一步。
 */
function sanitizeCoordinate(value: unknown): PanelCoordinate | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const coordinate: PanelCoordinate = {}
  const source = optionalString(raw.sourceFolderId)
  const anchored = optionalString(raw.anchoredChange)
  if (source !== undefined) coordinate.sourceFolderId = source
  // 不合法的維度**只丟棄該維度** —— 同一筆的其他維度照常保留（比照 `parseSessionEntry` 對
  // `worktreeKey` 與 `panelWorktreeKey` 的各自獨立驗證）。
  if (isWorktreeKey(raw.worktreeKey)) coordinate.worktreeKey = raw.worktreeKey
  if (anchored !== undefined) coordinate.anchoredChange = anchored

  return coordinate
}

/** 空座標不落盤 —— 它與「沒有這一筆」在語意上完全相同，留著只會讓檔案長出無意義的條目。 */
function isEmpty(coordinate: PanelCoordinate): boolean {
  return (
    coordinate.sourceFolderId === undefined &&
    coordinate.worktreeKey === undefined &&
    coordinate.anchoredChange === undefined
  )
}

/**
 * 內容無法信任時一律回傳 `null`，由呼叫端隔離該檔並以「所有 folder 皆為預設座標」啟動。
 *
 * **兩層容忍**：整份無法解析或版本不符 → `null`（隔離）；單一維度的值不合法 → 只丟棄該維度，
 * 同筆的其他維度與**其他 folder** 的座標照常還原。
 *
 * 這裡的失敗代價只是「座標回到預設」，不是「失去所有 repo」—— 那正是座標與 folder 清單分家的
 * 理由（`workspace-store` 的解析是 all-or-nothing，且它自己把那個結果稱為最糟的失敗模式）。
 */
export function parsePanel(raw: string): PersistedPanel | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof data !== 'object' || data === null) return null
  const { version, coordinates } = data as Record<string, unknown>

  if (version !== PANEL_VERSION) return null
  // **陣列要明確排除。** `typeof [] === 'object'` 且非 null，於是少了這一行，一份 `coordinates`
  // 是陣列的檔案會被當成「空座標」靜默接受，而不是被隔離 —— 那是結構違規，不是空狀態
  // （`workspace-store` 對 `folders` 做的正是這個判定的鏡像）。
  if (typeof coordinates !== 'object' || coordinates === null || Array.isArray(coordinates)) {
    return null
  }

  const parsed: PanelCoordinates = {}
  for (const [key, value] of Object.entries(coordinates as Record<string, unknown>)) {
    if (key === '') continue
    const coordinate = sanitizeCoordinate(value)
    if (coordinate && !isEmpty(coordinate)) parsed[key] = coordinate
  }

  return { version: PANEL_VERSION, coordinates: parsed }
}

/**
 * 先寫暫存檔再更名。同一個檔案系統上 `rename` 是原子的，因此中途失敗只會留下
 * 舊內容或新內容，不會留下半截 JSON。比照 `workspace-store`。
 */
export function writePanelFileAtomic(filePath: string, panel: PersistedPanel): void {
  const tmp = `${filePath}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tmp, `${JSON.stringify(panel, null, 2)}\n`, 'utf8')
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

export class PanelStore {
  #coordinates: PanelCoordinates = {}

  constructor(private readonly filePath: string) {}

  /**
   * 讀取座標。**任何讀取失敗都不得讓應用程式開不起來** —— 無法信任的檔案改名保留（不刪除），
   * 以「所有 folder 皆為預設座標」繼續。比照 `workspace-store`。
   */
  load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[panel] config unreadable, starting with default coordinates: ${String(error)}`)
      }
      this.#coordinates = {}
      return
    }

    const parsed = parsePanel(raw)
    if (!parsed) {
      const kept = quarantine(this.filePath)
      console.error(
        `[panel] config unparsable, starting with default coordinates` +
          (kept ? `; the original was kept at ${kept}` : `; the original could not be kept`),
      )
      this.#coordinates = {}
      return
    }

    this.#coordinates = parsed.coordinates
  }

  /** 當前的全部座標（複本）。 */
  list(): PanelCoordinates {
    const copy: PanelCoordinates = {}
    for (const [key, coordinate] of Object.entries(this.#coordinates)) {
      copy[key] = { ...coordinate }
    }
    return copy
  }

  /**
   * 以 renderer 送來的一份取代全部座標。
   *
   * **每一筆都過 `sanitizeCoordinate`** —— 見該函式的說明：驗證在寫入的入口，不只在讀取時。
   */
  replace(incoming: unknown): void {
    if (typeof incoming !== 'object' || incoming === null) return

    const next: PanelCoordinates = {}
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      if (typeof key !== 'string' || key === '') continue
      const coordinate = sanitizeCoordinate(value)
      if (coordinate && !isEmpty(coordinate)) next[key] = coordinate
    }

    this.#coordinates = next
    this.save()
  }

  /**
   * folder 自 workspace 被移除時，丟掉屬於它的座標。
   *
   * **以「屬於該 folder 的全部鍵」表達，不以單一鍵精確比對。** 今日兩者等價（鍵就是 folder id），
   * 但鍵在設計上是一個**不透明字串**，rail 的項目集合日後可能擴充（例如納入 linked worktree，
   * 屆時鍵形如 `<folderId>:<worktreeKey>`）—— 精確比對在那時會漏刪。
   *
   * **載入時不主動修剪孤兒條目**：某次 `workspace.json` 讀取失敗而以空 workspace 啟動時，一次
   * 主動修剪會把**所有**座標刪光，把一個可復原的失敗（把設定檔救回來）變成不可復原的。孤兒無害
   * —— 它的鍵是一個不在 rail 上的 folder，永遠不會被讀到（folder 移除後重新加入會拿到新的
   * 識別碼，不會意外復活舊座標 —— 那也是對的，「移除即忘記」）。
   */
  remove(folderId: string): void {
    const next: PanelCoordinates = {}
    let changed = false
    for (const [key, coordinate] of Object.entries(this.#coordinates)) {
      if (this.#belongsTo(key, folderId)) {
        changed = true
        continue
      }
      next[key] = coordinate
    }
    if (!changed) return

    this.#coordinates = next
    this.save()
  }

  /** 一個 rail 項目的鍵是否隸屬於某個 folder。今日鍵即 folder id；`:` 之後留給日後的擴充。 */
  #belongsTo(key: string, folderId: string): boolean {
    return key === folderId || key.startsWith(`${folderId}:`)
  }

  private save(): void {
    writePanelFileAtomic(this.filePath, {
      version: PANEL_VERSION,
      coordinates: this.#coordinates,
    })
  }
}
