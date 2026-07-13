import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpawnTarget } from '../types'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import { type SessionStatus, useSessions } from './sessions'
import { type XtermHandle, createXterm } from './xterm'

interface TerminalViewProps {
  sessionId: string
  spawnTarget: SpawnTarget
  status: SessionStatus
  /** 喚醒失敗的原因（folder 路徑失效）。 */
  wakeError?: string
  /** 非 focused 的終端仍然掛載（保留 scrollback），只是隱藏起來（design D7）。 */
  active: boolean
}

/** 拖動分界時 resize 會連續觸發；pty 不需要每一幀都收到一次 SIGWINCH。 */
const RESIZE_DEBOUNCE_MS = 60

/**
 * 終端畫面快照的節流：pty 靜下來這麼久之後，序列化一次並送去落盤。
 *
 * **快照刻意不倚賴「關閉視窗時的同步往返」**（design D4）：那樣的話 renderer 一卡，關窗就跟著卡，
 * 而且 crash 或斷電時什麼都留不下。滾動快照的代價是最多丟失這段時間的畫面 —— 用它換掉一條在
 * 必要路徑上的 IPC 往返，划算。
 */
const SNAPSHOT_DEBOUNCE_MS = 2000

/**
 * 重播的歷史與 live 內容之間的分隔。
 *
 * **這不是裝飾，是誠實性。** 重播的字不是這個 pty 產生的 —— 新 shell 對它一無所知。不標示的話，
 * 使用者會以為那個 shell 還活著：去找他背景跑著的 job、以為 `cd` 過的位置與環境變數還在。
 */
const SEPARATOR = '\x1b[2m── 以上為上次的內容 · spekterm 已重新啟動 ──\x1b[0m\r\n'

export function TerminalView({
  sessionId,
  spawnTarget,
  status,
  wakeError,
  active,
}: TerminalViewProps): React.JSX.Element {
  // 解構出穩定的 callback。若依賴整個 api 物件，session 清單一變動就會重建 xterm
  // （連同 scrollback 一起消失）。
  const { attach, setTitle, restoredScrollbackOf } = useSessions()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<XtermHandle | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)

  const copy = useCallback(() => {
    const selection = handleRef.current?.getSelection()
    if (selection) window.workspace.clipboard.writeText(selection)
    // 焦點必須回到終端 —— 從選單操作完之後，使用者的下一個動作是繼續打字。
    handleRef.current?.focus()
  }, [])

  // **只在使用者明確要求貼上時讀取剪貼簿** —— 不主動讀、不輪詢（design D2）。
  const paste = useCallback(() => {
    void window.workspace.clipboard.readText().then((text) => {
      if (text) handleRef.current?.paste(text)
      // 少了這一行，自右鍵選單貼上之後按 Enter 不會執行 —— 焦點還在選單那邊，
      // 使用者得再點一次終端才能繼續（實測由探針抓到）。
      handleRef.current?.focus()
    })
  }, [])

  // **claude session 不做快照。** `claude --resume` 續接時會自行把先前的對話重現在終端上 ——
  // 再重播一次我們存的畫面，使用者會看到兩份歷史（design D3）。順帶省下絕大部分的快照 IO：
  // 一直在吐字的正是 agent。
  const snapshots = spawnTarget === 'shell'
  const snapshotTimer = useRef<number | undefined>(undefined)

  const scheduleSnapshot = useCallback(() => {
    if (!snapshots) return
    window.clearTimeout(snapshotTimer.current)
    snapshotTimer.current = window.setTimeout(() => {
      const data = handleRef.current?.serialize()
      if (data) window.workspace.terminal.snapshot(sessionId, data)
    }, SNAPSHOT_DEBOUNCE_MS)
  }, [sessionId, snapshots])

  // 關閉視窗前的 best-effort flush（補上最後這段還沒落盤的畫面）。
  //
  // **它不在必要路徑上** —— 拿不到也只是丟失最後兩秒，因為滾動快照一直在寫。這正是「非正常結束
  // 仍保有最近一次快照」那條 requirement 的實作依據：`kill -9` 收不到 beforeunload，但磁碟上
  // 仍有一份略舊的快照。
  useEffect(() => {
    if (!snapshots) return
    const flush = (): void => {
      const data = handleRef.current?.serialize()
      if (data) window.workspace.terminal.snapshot(sessionId, data)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [sessionId, snapshots])

  // 建立終端、接上 session、把使用者輸入送回 pty。這個 effect 一輩子只跑一次。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const handle = createXterm({
      openLink: (uri) => {
        // 協定驗證在主行程。pty 的輸出是不受信任的內容，絕不讓它直接驅動導航（design D13）。
        void window.workspace.shell.openExternal(uri)
      },
      onCopy: (text) => window.workspace.clipboard.writeText(text),
      onPaste: () => {
        void window.workspace.clipboard.readText().then((text) => {
          if (text) handle.paste(text)
        })
      },
    })
    handleRef.current = handle
    handle.open(host)

    // 重建的 session：先把上次的畫面重播完、寫上分隔，**然後才**接上 live 串流。
    //
    // 順序是承重的：pty 的輸出一律先進 backlog（`SessionsProvider` 在任何 create 之前就訂閱了），
    // 直到這裡 attach 才被倒出來 —— 於是「歷史 → 分隔 → pty 的第一個 prompt」的順序由 attach
    // 的時機決定。若在重播完成前就 attach，新 shell 的 prompt 會插進歷史中間（design D6）。
    let detach = () => {}
    let disposed = false

    const streamLive = (): void => {
      if (disposed) return
      detach = attach(sessionId, (chunk) => {
        handle.write(chunk)
        scheduleSnapshot()
      })
    }

    const history = restoredScrollbackOf(sessionId)
    if (history) handle.replay(history, SEPARATOR, streamLive)
    else streamLive()

    const stopInput = handle.onInput((data) => {
      window.workspace.terminal.write(sessionId, data)
    })
    // pty 裡的程式（如 claude）以 OSC 序列宣告自己是誰 —— 那就是這個 session 的名字。
    const stopTitle = handle.onTitle((title) => setTitle(sessionId, title))

    return () => {
      disposed = true
      window.clearTimeout(snapshotTimer.current)
      stopTitle()
      stopInput()
      detach()
      handle.dispose()
      handleRef.current = null
    }
  }, [sessionId, attach, setTitle, restoredScrollbackOf, scheduleSnapshot])

  // 尺寸同步。不同步的後果：agent 以為終端是 80 欄、實際更寬，輸出會在錯的位置換行。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let timer: number | undefined
    const sync = (): void => {
      const size = handleRef.current?.fit()
      // null＝尺寸未變，或容器不可見（display:none 時量到 0）—— 兩者都不必打擾 pty。
      if (size) window.workspace.terminal.resize(sessionId, size.cols, size.rows)
    }

    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(sync, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(host)
    sync()

    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [sessionId])

  /**
   * pty 誕生的那一刻，把終端**當下的**尺寸告訴它。
   *
   * **喚醒把「pty 先誕生、終端後掛載」的順序倒了過來**（dogfooding 抓到）：休眠的 session 其終端
   * 早就掛載並 `fit()` 過了，那次 `resize` 打在一個**還不存在的 pty** 上（主行程直接忽略）；等
   * `wake()` 真的 spawn 出 pty，已經沒有人會再送一次尺寸了 —— `fit()` 因為「尺寸沒變」一律回
   * `null`。於是新 pty **一輩子停在 spawn 時的 80×24**：claude 以 80 欄排版，畫面縮成一小塊，
   * 要等使用者手動拖動視窗才恢復。
   *
   * 新建的 session 不會踩到，因為它的 pty **先**誕生、終端**後**掛載 `fit()`。
   */
  useEffect(() => {
    if (status !== 'running') return
    const size = handleRef.current?.size()
    if (size) window.workspace.terminal.resize(sessionId, size.cols, size.rows)
  }, [status, sessionId])

  // 由隱藏轉為顯示的那一刻，容器才第一次有尺寸 —— 必須重新 fit 一次（design D7 的代價）。
  useEffect(() => {
    if (!active) return
    const size = handleRef.current?.fit()
    if (size) window.workspace.terminal.resize(sessionId, size.cols, size.rows)
    handleRef.current?.focus()
  }, [active, sessionId])

  const items: MenuItem[] = [
    {
      label: '複製',
      // 停用而非隱藏 —— 使用者要看得到這個操作存在。
      disabled: !menu?.hasSelection,
      onSelect: () => {
        setMenu(null)
        copy()
      },
    },
    {
      label: '貼上',
      onSelect: () => {
        setMenu(null)
        paste()
      },
    },
  ]

  return (
    <div
      ref={hostRef}
      // 隱藏而非卸載 —— scrollback 活在 xterm 實例裡，卸載即遺失。
      className={active ? 'h-full w-full' : 'hidden'}
      onContextMenu={(event) => {
        event.preventDefault()
        // 選取狀態要在開啟選單的當下取樣 —— 選單一旦開啟，焦點就離開終端了。
        setMenu({
          x: event.clientX,
          y: event.clientY,
          hasSelection: handleRef.current?.hasSelection() ?? false,
        })
      }}
      onMouseDown={(event) => {
        // 中鍵貼上（Linux 慣例）。preventDefault 以免 Chromium 進入自動捲動模式。
        // X11 的中鍵貼的是 PRIMARY selection，而瀏覽器拿不到它 —— 這裡貼的是 CLIPBOARD
        // （與快捷鍵同一個來源，design D5）。
        if (event.button !== 1) return
        event.preventDefault()
        paste()
      }}
    >
      {/*
        休眠態的呈現。**休眠的 session 絕不能只是一塊空白的終端** —— 那看起來像壞掉。

        兩個目標的處境不同（design D11）：shell 的歷史畫面已經重播進終端了，提示只能是一條
        不遮蔽它的細帶；claude 不重播（`--resume` 會自己重現對話），它背後真的是空的，所以
        提示置中、自己成為那個「有東西可看」。
      */}
      {status === 'dormant' &&
        (wakeError ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-shell/90 px-3 py-2 text-2xs text-danger">
            無法恢復這個 session：{wakeError}
          </div>
        ) : spawnTarget === 'shell' ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-shell/90 px-3 py-2 text-2xs text-ink-faint">
            休眠中 · 正在於上次的工作目錄重新開啟 shell（先前的行程不會回來）
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded border border-hairline bg-shell/90 px-4 py-3 text-center text-2xs text-ink-faint">
              休眠中 · 正在恢復對話…
            </div>
          </div>
        ))}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
