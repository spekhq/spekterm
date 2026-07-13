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
   *
   * **它恆被記錄，即使使用者已接管命名權**（此時它只是不被呈現）—— 於是使用者清空名稱、
   * 交還命名權的那一刻，標籤能**立即**回到 pty 最近一次宣告的標題，而不必空等它下一次宣告
   *（那可能是好幾分鐘後，session 閒置的話甚至永遠不會來）。「清空名稱」是交還命名權的唯一
   * 路徑，它必須即時且確定（session-title-authority 的 design D3）。
   */
  title?: string
  /**
   * 使用者親自取的名字。**優先於 pty 宣告的標題。**
   *
   * 一旦設定，就代表使用者**永久接管了這個 session 的命名權** —— 此後 pty 宣告的標題一律
   * 靜默地不予呈現：不覆蓋、不確認、不提示。**連 pty 反覆宣告同一個標題也一樣。**
   *
   * 這裡曾經有一個確認對話框（「pty 想改名，要採用嗎？」），已於 session-title-authority
   * 移除：`claude` 隨任務進展**持續**改標題，那個對話框於是無限重跳（第二次 dogfooding 抓到）；
   * 而它問的又是一個答案可預測的問題 —— 使用者才剛親手命名，當然是保留自己的。**「使用者指定
   * 的名稱 > pty 宣告的標題」這條優先序本身就已經是那個裁決**，不需要再問第二次（design D1）。
   *
   * 交還命名權：把名字清空（見 `rename`）。
   */
  customTitle?: string
  /**
   * 這個 session 正在做的 change。側欄的「本 change」視圖跟著它走。
   *
   * **由使用者建立，不由系統從 pty 的輸出推測**（`openspec-side-panel` 的 design D3）。
   * pty 裡跑的 agent 不會宣告它在處理哪個 change —— 拿終端標題去比對 slug，會在「標題碰巧
   * 提到某個 slug」時假陽性、在「agent 用別的說法描述同一件事」時假陰性。一個偶爾莫名其妙
   * 跳到別的 change 的側欄，比沒有側欄更糟，因為使用者會開始不信任它。
   *
   * 這與「標籤跟隨 pty 宣告的標題」不矛盾：那條之所以成立，是因為 pty **真的用 OSC 序列宣告
   * 了標題**（一個明確的協定）。change 的錨定沒有這樣的協定。
   *
   * 唯一的自動值來自建立時：該 folder 恰有一個 active change 時錨定它，否則留空。
   */
  anchoredChange?: string
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
  /**
   * `anchoredChange` 是新 session 的初始錨定。呼叫端（`MainStage`）在該 folder **恰有一個**
   * active change 時傳它，否則傳 `undefined` —— 多個候選之間不猜（design D3）。
   */
  create(
    folderId: string,
    spawnTarget: SpawnTarget,
    anchoredChange?: string,
  ): Promise<CreateOutcome>
  /** 把一個 change 錨定到某個 session。`null` 解除錨定。 */
  anchorChange(sessionId: string, slug: string | null): void
  /** 該 session 錨定的 change。 */
  anchoredChangeOf(sessionId: string | null): string | null
  close(sessionId: string): void
  /**
   * pty 宣告的終端標題。空字串視為未設定。
   *
   * 使用者已接管命名權時**照樣記錄，只是不呈現** —— 不覆蓋、不確認、不打斷（design D1／D3）。
   */
  setTitle(sessionId: string, title: string): void
  /** 使用者親自命名（＝永久接管命名權）。空字串＝交還命名權，回到跟隨 pty。 */
  rename(sessionId: string, name: string): void
  /** 重排同一個 folder 之內的 session 順序。索引是該 folder 之內的序位。 */
  reorder(folderId: string, fromIndex: number, toIndex: number): void
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
    async (
      folderId: string,
      spawnTarget: SpawnTarget,
      anchoredChange?: string,
    ): Promise<CreateOutcome> => {
      const result = await window.workspace.terminal.create(folderId, spawnTarget)
      if (!result.ok) return { status: 'failed', failure: result }

      const { sessionId } = result.value
      const ordinal = (nextOrdinal.current.get(folderId) ?? 0) + 1
      nextOrdinal.current.set(folderId, ordinal)

      setSessions((previous) => [
        ...previous,
        { id: sessionId, folderId, spawnTarget, status: 'running', ordinal, anchoredChange },
      ])
      setFocused((previous) => new Map(previous).set(folderId, sessionId))

      return { status: 'created', sessionId }
    },
    [],
  )

  const anchorChange = useCallback((sessionId: string, slug: string | null) => {
    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId ? { ...session, anchoredChange: slug ?? undefined } : session,
      ),
    )
  }, [])

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
      if (!target) return previous

      // **login shell 宣告的標題一律丟棄。**
      //
      // shell 送的是它預設的 prompt 標題（`使用者@主機:/路徑`），對使用者零識別意義 —— 那不
      // 回答「這個 session 在幹嘛」。更糟的是它比 session 晚一秒多才到（shell 要先載完 rc、
      // 畫出第一個 prompt），抵達時分頁的標籤由 `shell 1` 暴增為一長串，寬度從約 60px 撐到
      // 約 210px，把緊鄰其後的「+ session」入口往右推 150px —— 使用者正要點下去時，按鈕從
      // 游標底下跳走。`claude` 宣告的標題則相反：短、且正是我們要的身分。
      //
      // **擋在這裡，而不是擋在顯示層**（session-navigation-and-labels 的 design D4）：這是 OSC
      // 標題進入 session 狀態的唯一入口，於是 shell session 的 `title` 恆為 undefined —— 標籤
      // 自然退回本地標籤，而「清空名稱後回到本地標籤（即使 pty 曾宣告過標題）」也自然成立，
      // 顯示層與 `rename` 都不必為 spawn 目標特判。
      if (target.spawnTarget === 'shell') return previous

      // **使用者已接管命名權時，標題照樣記錄下來 —— 只是不被呈現。**
      //
      // 這裡不做任何裁決：不覆蓋（標籤的優先序自然讓 `customTitle` 贏），也不呈現確認。`claude`
      // 隨任務進展持續改標題，每次都問一遍就是無限打斷，而那個問題的答案又是可預測的 —— 使用者
      // 才剛親手命名（design D1）。
      //
      // **記錄而不丟棄**是有目的的：使用者清空名稱交還命名權時，標籤要能立即回到 pty 最近一次
      // 宣告的標題，不必空等它下一次宣告（design D3）。

      // agent 可能反覆送同一個標題 —— 值沒變就不要製造新的陣列（否則每次都重繪整棵樹）。
      if (target.title === next) return previous
      return previous.map((session) =>
        session.id === sessionId ? { ...session, title: next } : session,
      )
    })
  }, [])

  const rename = useCallback((sessionId: string, name: string) => {
    const trimmed = name.trim()
    const next = trimmed === '' ? undefined : trimmed

    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId
          ? // 清空＝交還命名權，標籤回到跟隨 pty。`title` 一直都在記錄（見 `setTitle`），
            // 所以這一刻標籤立即變成 pty 最近宣告的標題，不必等它下一次宣告。
            { ...session, customTitle: next }
          : session,
      ),
    )
  }, [])

  const reorder = useCallback((folderId: string, fromIndex: number, toIndex: number) => {
    setSessions((previous) => {
      // 只重排該 folder 佔據的那些位置，其餘 folder 的相對順序完全不動。
      const slots = previous.reduce<number[]>((acc, session, index) => {
        if (session.folderId === folderId) acc.push(index)
        return acc
      }, [])

      if (fromIndex < 0 || fromIndex >= slots.length) return previous
      if (toIndex < 0 || toIndex >= slots.length) return previous
      if (fromIndex === toIndex) return previous

      const group = slots.map((index) => previous[index])
      const [moved] = group.splice(fromIndex, 1)
      group.splice(toIndex, 0, moved)

      const next = [...previous]
      slots.forEach((index, position) => {
        next[index] = group[position]
      })
      return next
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
      anchoredChangeOf: (sessionId) =>
        sessionId === null
          ? null
          : (sessions.find((session) => session.id === sessionId)?.anchoredChange ?? null),
      focus,
      create,
      close,
      setTitle,
      rename,
      anchorChange,
      reorder,
      attach,
    }),
    [sessions, focused, focus, create, close, setTitle, rename, anchorChange, reorder, attach],
  )

  return <SessionsContext.Provider value={api}>{children}</SessionsContext.Provider>
}

export function useSessions(): SessionsApi {
  const api = useContext(SessionsContext)
  if (!api) throw new Error('useSessions 必須用在 SessionsProvider 之內')
  return api
}
