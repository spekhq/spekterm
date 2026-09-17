import fs from 'node:fs'
import path from 'node:path'

/**
 * 注入設定的合成 —— **接縫只有一個，因此合成的結果也只能有一份**。
 *
 * agent 的設定經由一個公開的 CLI 旗標注入，而那個旗標只吃一份設定。本 repo 現在有兩個功能要用它
 * （狀態回報與事件回報），日後可能更多。
 *
 * ## 為什麼一定要合成，不能各寫各的
 *
 * 「各自寫一次」的實作，其失效是**後寫的把先寫的蓋掉，而兩個功能都會回報自己已啟用** ——
 * 症狀是其中一個安靜地失去作用，沒有任何錯誤、沒有紅燈。
 *
 * ## 各功能的啟用狀態彼此獨立
 *
 * 一個功能回傳 `null`（不參與）**SHALL NOT** 使另一個一併不注入。這一條有實際的觸發情境：
 * 狀態回報在「使用者已有自訂狀態列而我們串不上」時不參與，而那與事件回報毫無關係。
 *
 * ## 使用者原有的設定
 *
 * **`hooks` 不需要我們自己合併** —— 實測（2026-09-06、CLI 2.1.263）注入的 hooks 與使用者
 * `settings.json` 裡的 hooks 是**合併**而非覆寫：兩邊都定義 `SessionStart` 時兩者都被呼叫。
 * `statusLine` 則相反（單一值），因此它自己負責串接使用者原有的命令。
 * **這個差異是每個貢獻者自己的事，不是合成器的事。**
 */

/** hooks 在設定 JSON 中的 key。**貢獻者不得經 `settings` 使用它。** */
const HOOKS_KEY = 'hooks'

interface HookEntry {
  matcher: string
  hooks: { type: 'command'; command: string }[]
}

/** 合成後的設定檔落點。由 `configureAgentInjection()` 指定，主行程啟動時設定一次。 */
let injectionRoot: string | null = null

export function configureAgentInjection(userDataPath: string): void {
  injectionRoot = path.join(userDataPath, 'agent-injection')
}

/** **單一來源**：兩個功能共用同一份設定檔，因為接縫只有一個。 */
export function agentSettingsFile(): string {
  return injectionRoot ? path.join(injectionRoot, 'settings.json') : ''
}

/**
 * 一個貢獻者要註冊的 hook 命令：事件名 → 命令清單。
 *
 * **hooks 與 `settings` 分開是結構性的，不是整理上的偏好。** 它是**已知會被多個功能貢獻**的
 * 設定項（事件橋接佔著 `SessionStart`，自我介紹也要用它），而逐鍵覆蓋的合成會讓後者把前者
 * 整份丟掉 —— **兩個功能仍然都會回報自己已啟用**，症狀與「各自注入」完全相同。
 *
 * 拉成獨立欄位之後，「兩個貢獻者各寫一份 hooks 而後者蓋掉前者」**在型別上表達不出來**：
 * 貢獻者交出的是命令，巢狀的 matcher 結構由合成器產生，它們沒有詞彙可以覆蓋彼此。
 *
 * **CLI 端會把同一事件的多條命令都跑完**（2026-09-17、CLI 2.1.274 實測，見
 * `docs/lessons/handoff.md`）—— 但那與本欄位是兩件事：合成器若覆蓋，第二條命令根本不會出現在
 * 送出去的設定裡，**CLI 沒有機會執行一條它沒收到的命令**。兩邊都要對。
 */
export type HookContribution = Record<string, readonly string[]>

export interface InjectionContribution {
  /** 併入設定 JSON 的頂層片段。**同一個 key 被貢獻兩次即為不變式違反**（見 `composeInjection`）。 */
  settings: Record<string, unknown>
  /** 要註冊的 hook 命令。**不要寫進 `settings.hooks`** —— 那條路徑會被合成器拒絕。 */
  hooks?: HookContribution
  /** 併入 pty 環境的變數。 */
  env: Record<string, string>
}

export interface Injection {
  /** 併入命令列的片段（已 shell-quote）。 */
  commandFragment: string
  env: Record<string, string>
}

/** 單引號包裹，供拼接進 `sh -c` 的命令字串（路徑可能含空白）。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * 把所有貢獻合成為單一份設定並寫出。
 *
 * 全部都不參與時回 `null` —— 此時不注入任何東西，命令列上不會多出一個指向空設定的旗標。
 *
 * 設定檔為所有 session 共用（per-session 的差異全在環境變數裡），每次都重寫：內容可能隨版本
 * 改變，而它很小。
 */
export function composeInjection(
  settingsFile: string,
  parts: readonly (InjectionContribution | null)[],
): Injection | null {
  if (!settingsFile) return null
  const active = parts.filter((part): part is InjectionContribution => part !== null)
  if (active.length === 0) return null

  const settings: Record<string, unknown> = {}
  const hooks: Record<string, HookEntry[]> = {}
  const env: Record<string, string> = {}
  for (const part of active) {
    for (const [key, value] of Object.entries(part.settings)) {
      // `hooks` 有自己的欄位，而它的合併語意與其餘設定項相反（串接 vs 獨佔）。
      // 走 `settings` 進來的一律拒絕 —— 否則同一個 key 會有兩種語意，而分不清是哪一種。
      if (key === HOOKS_KEY) throw new Error(`injection: contribute hooks via the hooks field, not settings.${HOOKS_KEY}`)
      // **型別上的分開只涵蓋今天已知的那一項。** 明天某個尚未存在的設定項也成為多人貢獻的
      // 對象時，它在分類上仍在「單一功能持有」那一邊，而覆蓋會再次靜默發生。
      // 當場失敗的代價遠低於一個安靜失效的功能。
      if (key in settings) throw new Error(`injection: setting "${key}" contributed twice`)
      settings[key] = value
    }
    for (const [event, commands] of Object.entries(part.hooks ?? {})) {
      // 一個事件一組 matcher，多個貢獻者的命令**串接**進同一組。
      const entry = (hooks[event] ??= [{ matcher: '', hooks: [] }])
      for (const command of commands) entry[0].hooks.push({ type: 'command', command })
    }
    for (const [key, value] of Object.entries(part.env)) {
      // 與設定項同一條理由：同名的環境變數被貢獻兩次，其中一個功能會安靜地拿到別人的值。
      if (key in env) throw new Error(`injection: env "${key}" contributed twice`)
      env[key] = value
    }
  }
  if (Object.keys(hooks).length > 0) settings[HOOKS_KEY] = hooks

  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(settingsFile, JSON.stringify(settings), 'utf8')
  } catch {
    // 寫不出設定就不注入。**降級方向安全** —— 兩個功能都少了，但 session 照常建立。
    return null
  }

  return { commandFragment: `--settings ${shellQuote(settingsFile)}`, env }
}
