import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { TerminalPreferences } from './types'

export interface PreferencesApi {
  /** 當前終端偏好。載入完成前為空物件（＝全用預設）。 */
  terminal: TerminalPreferences
  /**
   * 設定終端字型（family + size + lineHeight 一起）。`null` ＝清為預設。
   *
   * **回傳 Promise，而呼叫端要 await 它** —— 設定對話框一次送出會同時改字型與 GPU，兩者是
   * 不同的 IPC。若兩邊都 fire-and-forget，**誰後 resolve，本地 state 就是誰的**：使用者關掉
   * GPU 又順手改了字級，字型那條若後到，state 裡的 GPU 就被它帶回舊值了（磁碟是對的，畫面不是）。
   */
  updateTerminalFont: (
    fontFamily: string | null,
    fontSize: number | null,
    lineHeight: number | null,
  ) => Promise<void>
  /** 開／關 GPU 加速。`null` ＝回到預設（＝啟用）。同上，呼叫端要 await。 */
  updateGpuAcceleration: (enabled: boolean | null) => Promise<void>
  /**
   * GPU 加速當下是否**應該**啟用 —— **未設定即為啟用**（省略＝預設，與其他偏好同一條規則）。
   *
   * 這是一個衍生值而非另一個 state：把「undefined 代表啟用」這個判斷收在一處，呼叫端就不會
   * 各自寫一次 `?? true`（漏掉一處就是「偏好沒設定時 GPU 沒開」）。
   */
  gpuEnabled: boolean
  /**
   * 開／關與 agent 的狀態橋接。`null` ＝回到預設（＝啟用）。同上，呼叫端要 await。
   *
   * **它只影響其後建立或重建的 session** —— 注入發生在 spawn 當下。這是誠實的限制，
   * 設定介面必須說明，否則使用者會以為這個開關壞了。
   */
  updateAgentStatus: (enabled: boolean | null) => Promise<void>
  /** 狀態橋接當下是否**應該**啟用 —— 未設定即為啟用（同 `gpuEnabled`）。 */
  agentStatusEnabled: boolean
}

const PreferencesContext = createContext<PreferencesApi | null>(null)

/**
 * 使用者偏好的持有者（終端的字型與 GPU 加速）。
 *
 * **掛在終端掛載之上**（`AppShell` 樹的最外層）—— 偏好是一次非同步 IPC，越早載入，終端越可能在
 * 建立前就拿到偏好，減少「先以預設字型起、偏好到達再套用」的閃動。ActivityBar 的設定介面與所有
 * `TerminalView` 都消費這個 context。
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [terminal, setTerminal] = useState<TerminalPreferences>({})

  useEffect(() => {
    void window.workspace.settings.get().then(setTerminal)
  }, [])

  // 主行程回傳套用後的偏好（已清理／夾制）—— 直接以它更新本地 state，renderer 與磁碟一致。
  const updateTerminalFont = useCallback(
    (fontFamily: string | null, fontSize: number | null, lineHeight: number | null) =>
      window.workspace.settings.setTerminalFont(fontFamily, fontSize, lineHeight).then(setTerminal),
    [],
  )

  const updateGpuAcceleration = useCallback(
    (enabled: boolean | null) =>
      window.workspace.settings.setGpuAcceleration(enabled).then(setTerminal),
    [],
  )

  const updateAgentStatus = useCallback(
    (enabled: boolean | null) =>
      window.workspace.settings.setAgentStatus(enabled).then(setTerminal),
    [],
  )

  const api = useMemo<PreferencesApi>(
    () => ({
      terminal,
      updateTerminalFont,
      updateGpuAcceleration,
      updateAgentStatus,
      gpuEnabled: terminal.gpuAcceleration ?? true,
      // 未設定＝啟用（與 GPU 加速同一條規則）。
      agentStatusEnabled: terminal.agentStatus !== false,
    }),
    [terminal, updateTerminalFont, updateGpuAcceleration, updateAgentStatus],
  )

  return <PreferencesContext.Provider value={api}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesApi {
  const api = useContext(PreferencesContext)
  if (!api) throw new Error('usePreferences must be used inside a PreferencesProvider')
  return api
}
