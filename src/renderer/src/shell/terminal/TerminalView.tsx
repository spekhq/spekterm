import { useEffect, useRef } from 'react'
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

  // 建立終端、接上 session、把使用者輸入送回 pty。這個 effect 一輩子只跑一次。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const handle = createXterm((uri) => {
      // 協定驗證在主行程。pty 的輸出是不受信任的內容，絕不讓它直接驅動導航（design D13）。
      void window.workspace.shell.openExternal(uri)
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

  return (
    <div
      ref={hostRef}
      // 隱藏而非卸載 —— scrollback 活在 xterm 實例裡，卸載即遺失。
      className={active ? 'h-full w-full' : 'hidden'}
    />
  )
}
