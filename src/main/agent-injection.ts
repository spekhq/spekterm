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

/** 合成後的設定檔落點。由 `configureAgentInjection()` 指定，主行程啟動時設定一次。 */
let injectionRoot: string | null = null

export function configureAgentInjection(userDataPath: string): void {
  injectionRoot = path.join(userDataPath, 'agent-injection')
}

/** **單一來源**：兩個功能共用同一份設定檔，因為接縫只有一個。 */
export function agentSettingsFile(): string {
  return injectionRoot ? path.join(injectionRoot, 'settings.json') : ''
}

export interface InjectionContribution {
  /** 併入設定 JSON 的頂層片段。不同貢獻者不得使用同一個 key。 */
  settings: Record<string, unknown>
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
  const env: Record<string, string> = {}
  for (const part of active) {
    Object.assign(settings, part.settings)
    Object.assign(env, part.env)
  }

  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(settingsFile, JSON.stringify(settings), 'utf8')
  } catch {
    // 寫不出設定就不注入。**降級方向安全** —— 兩個功能都少了，但 session 照常建立。
    return null
  }

  return { commandFragment: `--settings ${shellQuote(settingsFile)}`, env }
}
