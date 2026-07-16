import fs from 'node:fs'
import path from 'node:path'

/**
 * 偏好設定檔的結構版本。從第一天就寫入 —— 沒有版本欄位的舊檔日後無法安全遷移。
 * 比照 `workspace-store` / `session-store`。
 */
export const PREFERENCES_VERSION = 1

/** 終端外觀偏好。未設定的欄位一律省略 —— 空偏好＝全部用預設（系統字型 / 字級尺度 / 預設行高）。 */
export interface TerminalPreferences {
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
}

interface PersistedPreferences {
  version: number
  terminal: TerminalPreferences
}

/**
 * 字型大小的合理範圍。偏好走 JS 設定 `xterm.fontSize`（數字），這裡夾制於一個「還讀得到終端」
 * 的範圍 —— 太小看不見、太大一行放不了幾個字。
 */
const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 32
/** 字型 family 名的長度上限。單一字型名不該長成這樣，超過即截斷。 */
const FONT_FAMILY_MAX_LENGTH = 100
/**
 * 行高的合理範圍。1 以下會讓字互相重疊；2 以上一個畫面放不了幾行。
 *
 * **行高不只是可讀性**：終端的框線字元靠字型的 glyph 去拼，而 glyph 只有約 1em 高 —— 行高越大，
 * 上下列的 `│` 之間縫越明顯，表格越容易看起來是破的（見 `xterm.ts` 的 `DEFAULT_LINE_HEIGHT`）。
 */
const LINE_HEIGHT_MIN = 1
const LINE_HEIGHT_MAX = 2

/**
 * 字型 family 的清理。**去除控制字元與雙引號，但保留空白**（`MesloLGS NF` 這種含空白的字型名
 * 要留著）。family 會被拼進 xterm 的 CSS font-family 字串並以雙引號包住（見 `xterm.ts` 的
 * `resolveFamily`）—— 一個內嵌的 `"` 會破壞那個字串。空字串（清理後）視為未設定。
 *
 * 以 char code 過濾而非 regex 字元類別 —— 控制字元寫進 regex literal 會在原始碼裡變成看不見的
 * 位元組，難以審閱與比對。
 */
function sanitizeFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = [...value]
    .filter((ch) => ch !== '"' && ch.charCodeAt(0) >= 0x20)
    .join('')
    .trim()
  if (cleaned === '') return undefined
  return cleaned.slice(0, FONT_FAMILY_MAX_LENGTH)
}

/** 字型大小的夾制。非有限數視為未設定；否則四捨五入並夾於範圍內。 */
function clampSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/** 行高的夾制。非有限數視為未設定；否則夾於範圍內並取到小數兩位（行高是分數，不取整）。 */
function clampLineHeight(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const clamped = Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, value))
  return Math.round(clamped * 100) / 100
}

/**
 * 內容無法信任時一律回傳 `null`，由呼叫端隔離該檔並以預設偏好啟動。
 *
 * **對結構嚴格，對值寬容**：version 不符、`terminal` 不是物件 → `null`（整檔不可信，隔離）；
 * 但個別欄位（family／size）不合法時只是清理／夾制成預設，不因一個壞值就丟棄整份偏好。
 */
export function parsePreferences(raw: string): PersistedPreferences | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof data !== 'object' || data === null) return null
  const { version, terminal } = data as Record<string, unknown>

  if (version !== PREFERENCES_VERSION) return null
  if (typeof terminal !== 'object' || terminal === null) return null

  const { fontFamily, fontSize, lineHeight } = terminal as Record<string, unknown>
  const parsed: TerminalPreferences = {}
  const family = sanitizeFamily(fontFamily)
  const size = clampSize(fontSize)
  const height = clampLineHeight(lineHeight)
  if (family !== undefined) parsed.fontFamily = family
  if (size !== undefined) parsed.fontSize = size
  if (height !== undefined) parsed.lineHeight = height

  return { version: PREFERENCES_VERSION, terminal: parsed }
}

/**
 * 先寫暫存檔再更名。同一個檔案系統上 `rename` 是原子的，因此中途失敗只會留下
 * 舊內容或新內容，不會留下半截 JSON。比照 `workspace-store`。
 */
export function writePreferencesFileAtomic(
  filePath: string,
  preferences: PersistedPreferences,
): void {
  const tmp = `${filePath}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tmp, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8')
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

export class PreferencesStore {
  private preferences: TerminalPreferences = {}

  constructor(private readonly filePath: string) {}

  /**
   * 讀取偏好。**任何讀取失敗都不得讓應用程式開不起來** —— 那是最糟的失敗模式。
   * 無法信任的檔案改名保留（不刪除），以預設偏好繼續。比照 `workspace-store`。
   */
  load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[preferences] config unreadable, starting with defaults: ${String(error)}`)
      }
      this.preferences = {}
      return
    }

    const parsed = parsePreferences(raw)
    if (!parsed) {
      const kept = quarantine(this.filePath)
      console.error(
        `[preferences] config unparsable, starting with defaults` +
          (kept ? `; the original was kept at ${kept}` : `; the original could not be kept`),
      )
      this.preferences = {}
      return
    }

    this.preferences = parsed.terminal
  }

  /** 當前的終端偏好（複本）。 */
  get(): TerminalPreferences {
    return { ...this.preferences }
  }

  /**
   * 設定終端字型偏好（family／size／lineHeight 一起 —— 設定介面的欄位同時送）。
   *
   * 傳 `null`／不合法值即清為預設（該欄不占空間）。回傳套用後的偏好，供 renderer 立即使用。
   */
  setTerminalFont(
    fontFamily: string | null,
    fontSize: number | null,
    lineHeight: number | null,
  ): TerminalPreferences {
    const next: TerminalPreferences = {}
    const family = fontFamily === null ? undefined : sanitizeFamily(fontFamily)
    const size = fontSize === null ? undefined : clampSize(fontSize)
    const height = lineHeight === null ? undefined : clampLineHeight(lineHeight)
    if (family !== undefined) next.fontFamily = family
    if (size !== undefined) next.fontSize = size
    if (height !== undefined) next.lineHeight = height

    this.preferences = next
    this.save()
    return this.get()
  }

  private save(): void {
    writePreferencesFileAtomic(this.filePath, {
      version: PREFERENCES_VERSION,
      terminal: this.preferences,
    })
  }
}
