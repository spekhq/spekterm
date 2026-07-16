import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { TerminalPreferences } from './types'

export interface PreferencesApi {
  /** 當前終端偏好。載入完成前為空物件（＝全用預設）。 */
  terminal: TerminalPreferences
  /** 設定終端字型（family + size + lineHeight 一起）。`null` ＝清為預設。 */
  updateTerminalFont: (
    fontFamily: string | null,
    fontSize: number | null,
    lineHeight: number | null,
  ) => void
}

const PreferencesContext = createContext<PreferencesApi | null>(null)

/**
 * 使用者偏好的持有者。本輪只有終端字型。
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
    (fontFamily: string | null, fontSize: number | null, lineHeight: number | null) => {
      void window.workspace.settings
        .setTerminalFont(fontFamily, fontSize, lineHeight)
        .then(setTerminal)
    },
    [],
  )

  const api = useMemo<PreferencesApi>(
    () => ({ terminal, updateTerminalFont }),
    [terminal, updateTerminalFont],
  )

  return <PreferencesContext.Provider value={api}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesApi {
  const api = useContext(PreferencesContext)
  if (!api) throw new Error('usePreferences must be used inside a PreferencesProvider')
  return api
}
