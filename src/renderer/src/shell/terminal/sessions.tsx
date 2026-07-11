import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FsFailure, SpawnTarget } from '../types'

export type SessionStatus = 'running' | 'exited'

export interface SessionState {
  id: string
  folderId: string
  spawnTarget: SpawnTarget
  status: SessionStatus
  exitCode?: number
  /** 該 folder 內的建立序號（自 1 起）。pty 未宣告標題時，標籤的退路。 */
  ordinal: number
  /**
   * pty 以 OSC 序列設定的終端標題。
   *
   * session 的身分由**跑在裡面的東西**宣告（`claude` 會主動送這個），而不是由我們的流水號
   * 決定。未設定時為 `undefined`，標籤退回 `${spawnTarget} ${ordinal}`。
   */
  title?: string
}

export type CreateOutcome =
  | { status: 'created'; sessionId: string }
  | { status: 'failed'; failure: FsFailure }

export interface SessionsApi {
  /**
   * 所有 folder 的所有 session。
   *
   * 終端必須**跨切換 folder 常駐**：若只掛載當前 folder 的 session，切走再切回時 xterm 實例
   * 已被卸載，先前的 scrollback 就消失了（backlog 只補得回未顯示期間的新輸出，補不回已經
   * 卸載的歷史）。掛載以此為準，顯示才以當前 folder 為準（design D7）。
   */
  all(): SessionState[]
  forFolder(folderId: string): SessionState[]
  countFor(folderId: string): number
  /** 該 folder 當前聚焦的 session。未明確指定時退回它的第一個。 */
  focusedIdFor(folderId: string): string | null
  focus(folderId: string, sessionId: string): void
  create(folderId: string, spawnTarget: SpawnTarget): Promise<CreateOutcome>
  close(sessionId: string): void
  /** pty 宣告的終端標題。空字串視為未設定。 */
  setTitle(sessionId: string, title: string): void
  /**
   * 把一個終端接上它的 session：先補回 attach 之前累積的輸出，再接續 live 串流。
   * 回傳解除接續的函式。
   */
  attach(sessionId: string, write: (chunk: string) => void): () => void
}

const SessionsContext = createContext<SessionsApi | null>(null)

/**
 * session 清單的所有者。
 *
 * **必須位於 `MainStage` 之上**：session 綁在 folder 上，切換選中的 repo 不該讓清單消失，
 * 而 rail 要同時呈現**所有** folder 的 session（design D9）。
 */
export function SessionsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [focused, setFocused] = useState<ReadonlyMap<string, string>>(() => new Map())

  // 回呼需要當下的清單，但不該因清單變動而重新產生。
  const sessionsRef = useRef(sessions)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  /** 尚未有終端接上的 session，其輸出暫存於此。 */
  const backlog = useRef(new Map<string, string[]>())
  /** 已接上的終端。 */
  const sinks = useRef(new Map<string, (chunk: string) => void>())
  /**
   * 每個 folder 下一個 session 的序號。**單調遞增，不因關閉而回退** —— 若改用「當前
   * session 數 + 1」，關掉一個之後新開的會拿到已用過的序號（實測：關掉 shell 1 後開的
   * claude 標成 `claude 2`，與現存的 `shell 2` 撞號）。
   */
  const nextOrdinal = useRef(new Map<string, number>())

  /**
   * **這個訂閱必須早於任何一次 `create`。**
   *
   * pty 在 `create` 回傳的那一刻就開始吐出 shell 的第一個 prompt，而 `TerminalView` 要等
   * React 完成渲染才 attach —— 中間這段沒有接收者的輸出會直接消失。因此輸出一律先進
   * backlog，等終端接上再補。與 Phase 2「先訂閱、再列目錄」同源：**訂閱要早於會產生事件的
   * 那個動作**。
   */
  useEffect(() => {
    return window.workspace.terminal.onData((sessionId, chunk) => {
      const sink = sinks.current.get(sessionId)
      if (sink) {
        sink(chunk)
        return
      }
      const pending = backlog.current.get(sessionId)
      if (pending) pending.push(chunk)
      else backlog.current.set(sessionId, [chunk])
    })
  }, [])

  // pty 自行結束（使用者打了 exit、claude 收工、或命令啟動失敗）。標示為已結束但**不移除**
  // —— 使用者要看得到它結束了，也要讀得到最後的輸出（design D9、D15）。
  useEffect(() => {
    return window.workspace.terminal.onExit((sessionId, exitCode) => {
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId ? { ...session, status: 'exited', exitCode } : session,
        ),
      )
    })
  }, [])

  const create = useCallback(
    async (folderId: string, spawnTarget: SpawnTarget): Promise<CreateOutcome> => {
      const result = await window.workspace.terminal.create(folderId, spawnTarget)
      if (!result.ok) return { status: 'failed', failure: result }

      const { sessionId } = result.value
      const ordinal = (nextOrdinal.current.get(folderId) ?? 0) + 1
      nextOrdinal.current.set(folderId, ordinal)

      setSessions((previous) => [
        ...previous,
        { id: sessionId, folderId, spawnTarget, status: 'running', ordinal },
      ])
      setFocused((previous) => new Map(previous).set(folderId, sessionId))

      return { status: 'created', sessionId }
    },
    [],
  )

  const close = useCallback((sessionId: string) => {
    const target = sessionsRef.current.find((session) => session.id === sessionId)

    // 已結束的 session 主行程已無該 pty，kill 是 no-op —— 一律呼叫，不必分支（design D12）。
    window.workspace.terminal.kill(sessionId)
    sinks.current.delete(sessionId)
    backlog.current.delete(sessionId)

    setSessions((previous) => previous.filter((session) => session.id !== sessionId))
    if (!target) return

    setFocused((previous) => {
      if (previous.get(target.folderId) !== sessionId) return previous
      const sibling = sessionsRef.current.find(
        (session) => session.folderId === target.folderId && session.id !== sessionId,
      )
      const next = new Map(previous)
      if (sibling) next.set(target.folderId, sibling.id)
      else next.delete(target.folderId)
      return next
    })
  }, [])

  const focus = useCallback((folderId: string, sessionId: string) => {
    setFocused((previous) => new Map(previous).set(folderId, sessionId))
  }, [])

  const setTitle = useCallback((sessionId: string, title: string) => {
    const trimmed = title.trim()
    const next = trimmed === '' ? undefined : trimmed

    setSessions((previous) => {
      const target = previous.find((session) => session.id === sessionId)
      // agent 可能反覆送同一個標題 —— 值沒變就不要製造新的陣列（否則每次都重繪整棵樹）。
      if (!target || target.title === next) return previous
      return previous.map((session) =>
        session.id === sessionId ? { ...session, title: next } : session,
      )
    })
  }, [])

  const attach = useCallback((sessionId: string, write: (chunk: string) => void) => {
    const pending = backlog.current.get(sessionId)
    if (pending) {
      backlog.current.delete(sessionId)
      for (const chunk of pending) write(chunk)
    }
    sinks.current.set(sessionId, write)

    return () => {
      if (sinks.current.get(sessionId) === write) sinks.current.delete(sessionId)
    }
  }, [])

  const api = useMemo<SessionsApi>(
    () => ({
      all: () => sessions,
      forFolder: (folderId) => sessions.filter((session) => session.folderId === folderId),
      countFor: (folderId) =>
        sessions.reduce((total, session) => (session.folderId === folderId ? total + 1 : total), 0),
      focusedIdFor: (folderId) => {
        const explicit = focused.get(folderId)
        if (explicit && sessions.some((session) => session.id === explicit)) return explicit
        return sessions.find((session) => session.folderId === folderId)?.id ?? null
      },
      focus,
      create,
      close,
      setTitle,
      attach,
    }),
    [sessions, focused, focus, create, close, setTitle, attach],
  )

  return <SessionsContext.Provider value={api}>{children}</SessionsContext.Provider>
}

export function useSessions(): SessionsApi {
  const api = useContext(SessionsContext)
  if (!api) throw new Error('useSessions 必須用在 SessionsProvider 之內')
  return api
}
