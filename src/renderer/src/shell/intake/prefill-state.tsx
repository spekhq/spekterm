import { createContext, useContext, useEffect, useMemo, useState } from 'react'

/**
 * 「這個 session 有一則尚未送出的 prompt」。
 *
 * ## 為什麼非有不可
 *
 * 預填寫進的是 **pty**，於是它在終端 view 裡直接看得到 —— 但在對話 view 裡看不到
 * （那個 view 不呈現終端畫面）。少了這個標示，使用者的全域偏好若是對話 view，
 * 接受一則 intake 之後他會看到一個空的對話畫面、**什麼提示都沒有** ——
 * 這條管線在他眼中就是「接受了卻什麼也沒發生」。
 *
 * ## 為什麼不由 renderer 自己判斷
 *
 * 「已經填進去了」與「使用者送出了」都是**主行程**才知道的事：前者是它自己寫的，
 * 後者發生在 pty 之內（使用者按下 Enter），renderer 收不到任何自己發出的訊號 ——
 * 唯一的線索是 agent 回報的等待狀態離開就緒，而那份狀態住在主行程。
 */

type PrefillState = 'pending' | 'timedOut'

const PrefillContext = createContext<ReadonlyMap<string, PrefillState>>(new Map())

export function PrefillProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [states, setStates] = useState<ReadonlyMap<string, PrefillState>>(new Map())

  useEffect(() => {
    return window.workspace.intake.onPrefill((sessionId, state) => {
      setStates((current) => {
        const next = new Map(current)
        if (state === 'sent') next.delete(sessionId)
        else next.set(sessionId, state)
        return next
      })
    })
  }, [])

  const value = useMemo(() => states, [states])
  return <PrefillContext.Provider value={value}>{children}</PrefillContext.Provider>
}

export function usePrefillState(sessionId: string): PrefillState | undefined {
  return useContext(PrefillContext).get(sessionId)
}
