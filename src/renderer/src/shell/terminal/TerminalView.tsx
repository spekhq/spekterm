import { useCallback, useEffect, useRef, useState } from 'react'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import { useSessions } from './sessions'
import { type XtermHandle, createXterm } from './xterm'

interface TerminalViewProps {
  sessionId: string
  /** 非 focused 的終端仍然掛載（保留 scrollback），只是隱藏起來（design D7）。 */
  active: boolean
}

/** 拖動分界時 resize 會連續觸發；pty 不需要每一幀都收到一次 SIGWINCH。 */
const RESIZE_DEBOUNCE_MS = 60

export function TerminalView({ sessionId, active }: TerminalViewProps): React.JSX.Element {
  // 解構出穩定的 callback。若依賴整個 api 物件，session 清單一變動就會重建 xterm
  // （連同 scrollback 一起消失）。
  const { attach, setTitle } = useSessions()
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

    // 先補回 attach 之前累積的輸出（含 shell 的第一個 prompt），再接續 live 串流。
    const detach = attach(sessionId, (chunk) => handle.write(chunk))
    const stopInput = handle.onInput((data) => {
      window.workspace.terminal.write(sessionId, data)
    })
    // pty 裡的程式（如 claude）以 OSC 序列宣告自己是誰 —— 那就是這個 session 的名字。
    const stopTitle = handle.onTitle((title) => setTitle(sessionId, title))

    return () => {
      stopTitle()
      stopInput()
      detach()
      handle.dispose()
      handleRef.current = null
    }
  }, [sessionId, attach, setTitle])

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
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
