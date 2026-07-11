import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

/**
 * xterm 的唯一 wrapper 模組 —— 比照編輯器的約束（`workspace-app-shell` 的「編輯器透過
 * wrapper 介面存取」）：renderer 的其他模組一律不直接 import `@xterm/*`，退守替代終端時
 * 改動侷限於此。
 *
 * 這裡不碰 IPC、不碰 React：只把 xterm 三件套（Terminal + fit + web-links）組裝成一個
 * 好操作的把手，並確保連結點擊不由 xterm 自行導航（design D13）。
 */

/** 對齊 app 的深色主題與 mockup 的終端配色（--color-shell / ink-dim / accent）。 */
const THEME = {
  background: '#07090c',
  foreground: '#94a3b8',
  cursor: '#f59e0b',
  cursorAccent: '#07090c',
  selectionBackground: '#243044',
} as const

export interface XtermHandle {
  /** 掛載到 DOM。回傳之後才量得到尺寸。 */
  open(parent: HTMLElement): void
  /** 依容器尺寸重排。回傳新的 cols/rows；尺寸未變或容器不可見時回傳 null。 */
  fit(): { cols: number; rows: number } | null
  write(data: string): void
  /** 使用者鍵入的出口。回傳解除訂閱的函式。 */
  onInput(listener: (data: string) => void): () => void
  focus(): void
  dispose(): void
}

/**
 * 建立一個終端把手。`openLink` 由呼叫端注入 —— wrapper 不認得 `workspace.shell`，它只知道
 * 「點到連結就把 URI 交出去」，把信任決策（協定驗證在主行程）留在這道接縫之外。
 */
export function createXterm(openLink: (uri: string) => void): XtermHandle {
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.3,
    cursorBlink: true,
    // 換行由 pty 內的程式自理，不要 xterm 代為轉換。
    convertEol: false,
    scrollback: 5000,
    theme: { ...THEME },
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  // 覆寫預設的「開新視窗」：pty 的輸出是不受信任的內容（使用者 repo 裡的任何東西都可能
  // 印出一個 URL），絕不讓它直接驅動導航或開窗 —— 一律交給主行程驗證協定後以系統瀏覽器
  // 開啟。與渲染 markdown 連結同源的信任考量（design D13）。
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault()
      openLink(uri)
    }),
  )

  let lastCols = 0
  let lastRows = 0

  return {
    open(parent) {
      term.open(parent)
    },
    fit() {
      // 容器為 display:none（未 focused 的 session）時尺寸為 0，proposeDimensions 會給出
      // 無效值 —— 此時不該 fit，也不該拿 0 去打擾 pty。
      const proposed = fitAddon.proposeDimensions()
      if (!proposed) return null
      if (!Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return null
      if (proposed.cols < 1 || proposed.rows < 1) return null

      fitAddon.fit()
      if (term.cols === lastCols && term.rows === lastRows) return null

      lastCols = term.cols
      lastRows = term.rows
      return { cols: term.cols, rows: term.rows }
    },
    write(data) {
      term.write(data)
    },
    onInput(listener) {
      const disposable = term.onData(listener)
      return () => disposable.dispose()
    },
    focus() {
      term.focus()
    },
    dispose() {
      fitAddon.dispose()
      term.dispose()
    },
  }
}
