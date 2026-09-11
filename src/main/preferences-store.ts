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
  /**
   * GPU 加速（＝ webgl renderer）。**未設定＝啟用** —— 省略即預設，與其他欄位同一條規則。
   *
   * 它是**逃生口**：終端已有自動降級（渲染資源取不到或執行期失效時退回），但那只擋得住
   * 「取不到」；擋不住「取得了、但驅動有缺陷而畫出錯的內容」—— 那不觸發任何事件，只有使用者
   * 看得出來，也只有使用者關得掉。
   */
  gpuAcceleration?: boolean
  /**
   * 與 agent 的狀態橋接（見 `agent-status.ts`）。**未設定＝啟用** —— 與 `gpuAcceleration` 同一條
   * 規則。預設啟用的前提是實測的零損失：未自訂 statusline 的使用者，那個位置本來就是空的
   * （agent 內建的模式提示行**不是** statusLine）。保留這個開關，是給不希望 spekterm 改變
   * agent 呼叫方式的使用者一條退路 —— 那是本能力唯一會改變 spekterm 之外行為的部分。
   */
  agentStatus?: boolean
  /**
   * 與 agent 的事件橋接（見 `agent-events.ts`）。**未設定＝啟用**，與上面同一條規則。
   *
   * **它與 `agentStatus` 是兩個獨立的開關，這是規格條款而不是方便**：兩者共用同一個注入接縫，
   * 但關掉狀態列 SHALL NOT 連帶關掉對話 view 的輸入能力。捆在一起的實作不會有任何型別錯誤。
   */
  agentEvents?: boolean
  /**
   * agent session 以哪一種 view 呈現（`agent-conversation-view`）。**未設定＝終端**。
   *
   * **它是全域的，不是 per-session** —— 使用者同時開著數個 agent session 時從不希望它們不一樣，
   * 而「一邊以對話 view 看 agent、一邊以終端 view 用 shell」這個曾經的理由不成立：
   * shell 目標根本不具備對話 view（那由 spawn 目標的判定保障，與這個偏好無關）。
   *
   * **名字上它不是「終端」偏好**，這個張力是真的 —— 但 `agentStatus` / `agentEvents` 已經
   * 住在這裡，先例在。**不要順手把這個區塊改名**：`parsePreferences` 在 `version` 不符時
   * 隔離整檔，一次版本遞增等於每個使用者的字型設定歸零。
   */
  agentView?: 'terminal' | 'conversation'
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
 * view 的白名單判定：**恰為那兩個字面值之一才採用**，其餘一律視為未設定。
 *
 * **不可寫成 `value === 'conversation' ? … : 'terminal'`** —— 那會把「檔案壞了」與
 * 「使用者選了終端」變成同一件事。前者的正確處置是回到未設定，讓「未設定＝終端」那條規則
 * 去決定，於是只有一個地方在決定。同 `gpuAcceleration` 那條「只認真正的布林」。
 */
function sanitizeAgentView(value: unknown): 'terminal' | 'conversation' | undefined {
  return value === 'terminal' || value === 'conversation' ? value : undefined
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

  // **這份解構清單是第二處白名單，而型別檢查對它零感知。** 加了欄位卻沒加在這裡，
  // 該欄位就寫得進磁碟卻讀不回來 —— 症狀是「這個偏好不跨重啟」，而沒有任何東西會紅。
  // （`agentStatus` 目前仍漏在這裡，見 issue；`agentEvents` 已由 `agent-intake-inbox` 補上
  // —— 它依賴「事件回報已關閉」這個前提，而那個前提原本在產品與驗收裡都造不出來。）
  const { fontFamily, fontSize, lineHeight, gpuAcceleration, agentView, agentEvents } =
    terminal as Record<string, unknown>
  const parsed: TerminalPreferences = {}
  const family = sanitizeFamily(fontFamily)
  const size = clampSize(fontSize)
  const height = clampLineHeight(lineHeight)
  if (family !== undefined) parsed.fontFamily = family
  if (size !== undefined) parsed.fontSize = size
  if (height !== undefined) parsed.lineHeight = height
  // 只認真正的布林 —— 檔案裡的 `"false"`／`0` 之類的東西一律當成未設定（＝預設啟用），
  // 而不是把它們硬轉成 false 而把 GPU 關掉。
  if (typeof gpuAcceleration === 'boolean') parsed.gpuAcceleration = gpuAcceleration
  const view = sanitizeAgentView(agentView)
  if (view !== undefined) parsed.agentView = view
  // 同 `gpuAcceleration`：只認真正的布林。
  if (typeof agentEvents === 'boolean') parsed.agentEvents = agentEvents

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

    // **GPU 偏好必須明確保留 —— 這個方法從一個空物件開始重建 `terminal`。**
    // 少了這一行，使用者每改一次字型就會**靜默地把 GPU 偏好重設回預設**：他關掉了 GPU（因為
    // 驅動有問題、畫面是壞的），接著調一下字級，GPU 就自己開回來了 —— 而那正是他關掉它的原因。
    // 這個方法只管字型。
    if (this.preferences.gpuAcceleration !== undefined) {
      next.gpuAcceleration = this.preferences.gpuAcceleration
    }
    // **view 的選擇同理必須保留。** 少了這一行：使用者切到對話 view，接著開設定調一次字級，
    // 畫面就**靜默地跳回終端** —— 沒有錯誤、沒有型別問題，看起來像「這個開關會自己彈回去」。
    if (this.preferences.agentView !== undefined) {
      next.agentView = this.preferences.agentView
    }
    // **事件回報的開關同理。** 只修讀取路徑而漏掉這裡，等於把「完全不生效」的缺陷換成
    // 「調一次字型就失效」—— 後者更難察覺，因為它在一段時間內是對的。
    if (this.preferences.agentEvents !== undefined) {
      next.agentEvents = this.preferences.agentEvents
    }

    this.preferences = next
    this.save()
    return this.get()
  }

  /**
   * 開／關 GPU 加速。`null` ＝清為預設（＝啟用）。
   *
   * 與 `setTerminalFont` 分開，是因為它**不是字型偏好** —— 把它塞進那個方法的第四個參數，
   * 方法名就開始說謊。字型偏好不受此方法影響（反之亦然，見 `setTerminalFont` 的保留邏輯）。
   */
  setGpuAcceleration(enabled: boolean | null): TerminalPreferences {
    const next: TerminalPreferences = { ...this.preferences }
    if (enabled === null) delete next.gpuAcceleration
    else next.gpuAcceleration = enabled

    this.preferences = next
    this.save()
    return this.get()
  }

  /** 與 agent 的狀態橋接。`null` ＝ 清除（回到預設的啟用）。 */
  setAgentStatus(enabled: boolean | null): TerminalPreferences {
    const next: TerminalPreferences = { ...this.preferences }
    if (enabled === null) delete next.agentStatus
    else next.agentStatus = enabled

    this.preferences = next
    this.save()
    return this.get()
  }

  /** agent session 的呈現方式。`null` ＝ 清除（回到預設的終端）。 */
  setAgentView(view: 'terminal' | 'conversation' | null): TerminalPreferences {
    const next: TerminalPreferences = { ...this.preferences }
    const sanitized = view === null ? undefined : sanitizeAgentView(view)
    if (sanitized === undefined) delete next.agentView
    else next.agentView = sanitized

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
