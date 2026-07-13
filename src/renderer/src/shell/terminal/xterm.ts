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
  /**
   * pty 內的程式以 OSC 序列（`ESC ] 0 ; <title> BEL`）設定的終端標題。
   *
   * 這是程式**主動宣告的身分**（`claude` 就是這樣讓終端模擬器的分頁自動改名的），
   * 不是我們去猜的。回傳解除訂閱的函式。
   */
  onTitle(listener: (title: string) => void): () => void
  /** 目前選取的內容（xterm 的選取不是 DOM selection，瀏覽器原生的複製抓不到它）。 */
  getSelection(): string
  hasSelection(): boolean
  /** 把文字送進 pty。xterm 會處理 bracketed paste（程式若啟用了它）。 */
  paste(text: string): void
  focus(): void
  dispose(): void
}

/**
 * 複製／貼上的快捷鍵。
 *
 * **`Ctrl+C` 不在其中，而且不能在。** 終端裡的 `Ctrl+C` 是中斷訊號 —— agent 跑失控時要
 * 中斷它的能力，不能因為畫面上剛好有一段選取就失靈。這正是終端模擬器普遍採用
 * `Ctrl+Shift+C` 的理由。macOS 的 `Cmd+C` 不與中斷訊號衝突，故該平台用 `Cmd`（design D3）。
 */
function matchClipboardKey(event: KeyboardEvent): 'copy' | 'paste' | null {
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  const modifier = isMac ? event.metaKey : event.ctrlKey && event.shiftKey
  if (!modifier) return null

  const key = event.key.toLowerCase()
  if (key === 'c') return 'copy'
  if (key === 'v') return 'paste'
  return null
}

export interface XtermOptions {
  /** 點到連結。wrapper 不認得 `workspace.shell` —— 它只把 URI 交出去。 */
  openLink: (uri: string) => void
  /** 使用者以快捷鍵要求複製。`text` 是當下的選取內容（非空才會呼叫）。 */
  onCopy: (text: string) => void
  /** 使用者以快捷鍵要求貼上。呼叫端負責讀剪貼簿，再呼叫 `paste()`。 */
  onPaste: () => void
}

/**
 * 建立一個終端把手。所有與外界的接觸（開連結、讀寫剪貼簿）都由呼叫端注入 —— wrapper 不認得
 * `workspace.*`，信任決策留在這道接縫之外。
 */
/**
 * 終端的字級。
 *
 * xterm 的 `fontSize` 是數字（它用 canvas 量測 cell 尺寸），吃不到 CSS token —— 因此從
 * `--text-terminal` 讀出來再交給它。等寬字在相同 px 下的視覺比例與比例字不同，故終端自成
 * 一級；但那一級仍由 `--text-base` 這個旋鈕推導，不是一個與字級尺度無關的常數。
 *
 * **不能直接讀那個自訂屬性（實測，而且它會靜默失敗）**：CSS 自訂屬性的 computed value
 * **不會求值 `calc()`** —— `getPropertyValue('--text-terminal')` 回傳的是字面的
 * `"calc(15px - 1px)"`，`parseFloat` 於是得到 `NaN`，悄悄退回下面那個 fallback。因為 fallback
 * 剛好等於當時的正確值，畫面上完全看不出來：終端的字級從此與尺度脫鉤，旋鈕轉了它也不動。
 *
 * 解法是讓**瀏覽器**去求值：`font-size` 是有型別的屬性，它的 computed value 一定是絕對 px。
 * 把 `var(--text-terminal)` 餵給一個離屏元素的 `font-size`，再讀回它 computed 的 `fontSize`。
 */
const TERMINAL_FONT_SIZE_FALLBACK = 14

function terminalFontSize(): number {
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.fontSize = 'var(--text-terminal)'
  document.body.appendChild(probe)
  const px = Number.parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()

  // 終端字級是使用者最常盯著的東西 —— 變數若不見了，也不能變成瀏覽器預設的 16px 或 0。
  return Number.isFinite(px) && px > 0 ? px : TERMINAL_FONT_SIZE_FALLBACK
}

export function createXterm(options: XtermOptions): XtermHandle {
  const { openLink, onCopy, onPaste } = options
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: terminalFontSize(),
    lineHeight: 1.3,
    cursorBlink: true,
    // 換行由 pty 內的程式自理，不要 xterm 代為轉換。
    convertEol: false,
    scrollback: 5000,
    theme: { ...THEME },
    // OSC 8 escape-sequence 超連結由 xterm 核心的 OscLinkProvider 處理，走 `Terminal.linkHandler`
    // —— 與 WebLinksAddon（純文字 URL）是**兩套**機制。未設 linkHandler 會落入 xterm 內建預設：
    // 一個 `confirm()`（其 URL 文字由不受信任的 pty 輸出控制）+ `window.open()`。導向 `openLink`，
    // 讓兩套連結都匯到同一條 `openExternal`（主行程驗協定）。不設 `allowNonHttpProtocols`
    // （預設 false）：非 http／https 的 URI 根本不會被 OscLinkProvider 建成可點連結（design D4）。
    linkHandler: {
      activate: (_event, uri) => openLink(uri),
    },
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

  // 回傳 false＝「這個按鍵我們處理了，xterm 不要再送給 pty」。其餘按鍵一律放行 ——
  // **包含 Ctrl+C**，它必須維持中斷訊號（design D3）。
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true

    const action = matchClipboardKey(event)
    if (!action) return true

    if (action === 'copy') {
      const selection = term.getSelection()
      if (selection) onCopy(selection)
    } else {
      onPaste()
    }
    return false
  })

  let lastCols = 0
  let lastRows = 0

  return {
    open(parent) {
      term.open(parent)
    },
    fit() {
      // 字級決定 cell 尺寸，cell 尺寸決定行列數 —— 字級變了而不重新量測，pty 手上的 cols/rows
      // 就與畫面錯位。在這裡（而不是另開一個 API）重新讀取，是因為 fit 本來就在 attach 與
      // 每次 resize 時被呼叫；於是尺度的旋鈕一轉（dev 的 HMR 會即時改寫 CSS 變數），終端
      // 下一次 fit 就跟上，不必重啟。
      const fontSize = terminalFontSize()
      if (fontSize !== term.options.fontSize) term.options.fontSize = fontSize

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
    onTitle(listener) {
      const disposable = term.onTitleChange(listener)
      return () => disposable.dispose()
    },
    getSelection() {
      return term.getSelection()
    },
    hasSelection() {
      return term.hasSelection()
    },
    paste(text) {
      // 原封不動送交 pty。xterm 會處理 bracketed paste（程式若啟用了它，shell 就知道
      // 這是「貼上」而非逐鍵輸入）。
      term.paste(text)
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
