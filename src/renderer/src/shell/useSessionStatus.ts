import { useEffect, useState } from 'react'
import type { SessionStatus } from './types'

/**
 * 訂閱 focused session 的主行程側狀態（pty 的 cwd、git 工作區、agent 回報的用量）。
 *
 * **只盯一個** —— 輪詢的成本由主行程綁在「當下 focused 的那一個 session」上，這個 hook 就是
 * 告訴它盯誰的地方。`null` 代表沒有可盯的對象（沒有 repo／沒有 session），此時主行程停止輪詢。
 *
 * 換 session 時**立刻清掉舊的快照**：留著它會讓狀態列在下一個 tick 之前顯示**上一個 session 的
 * cwd 與用量** —— 那比空白更糟，因為它看起來像是真的（與側欄「換 key 就清資料」同一條理由）。
 */
export function useSessionStatus(sessionId: string | null): SessionStatus | null {
  const [status, setStatus] = useState<SessionStatus | null>(null)

  // **清空發生在渲染期間，不在 effect 裡**（React 官方的「渲染期間調整 state」）。寫在 effect
  // 裡的話，舊 session 的快照會多活一次繪製 —— 而那正是這個 hook 要避免的東西。
  const [seenSessionId, setSeenSessionId] = useState(sessionId)
  if (seenSessionId !== sessionId) {
    setSeenSessionId(sessionId)
    setStatus(null)
  }

  useEffect(() => {
    window.workspace.terminal.watchStatus(sessionId)
    if (sessionId === null) return

    const stop = window.workspace.terminal.onStatus((incoming) => {
      // 遲到的推送可能屬於上一個 session（切換與 IPC 之間有時序差）。
      if (incoming.sessionId !== sessionId) return
      setStatus(incoming)
    })
    return () => {
      stop()
    }
  }, [sessionId])

  return status
}
