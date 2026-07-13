import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
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
  /**
   * 當前的 cols/rows —— **不重新量測，也不做「尺寸有沒有變」的偵測**。
   *
   * `fit()` 在尺寸未變時回 `null`（它的用途是「要不要打擾 pty」），因此它**沒辦法**回答
   * 「把現在的尺寸告訴一個**剛誕生**的 pty」。喚醒一個休眠的 session 時正是這個處境。
   */
  size(): { cols: number; rows: number }
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
  /**
   * 把當前畫面序列化成一段可以再寫回去的文字（含跳脫序列）。用於重開 app 後還原畫面。
   *
   * 只取最後 `SNAPSHOT_LINES` 行 —— 快照要落到磁碟上，而 scrollback 有 5000 行，一個 SGR
   * 密集的 agent 輸出序列化出來會非常大。
   */
  serialize(): string
  /**
   * 重播上次的畫面，接著寫入一段分隔，完成後呼叫 `done`。
   *
   * **不能只是 `write(history + separator)`。** `SerializeAddon` 的輸出**結尾帶一個絕對的游標定位**
   * （把游標還原到快照當下的位置）—— 而那個位置對一個「即將接上新 pty」的終端毫無意義：實測新
   * shell 的 prompt 會直接**蓋掉歷史中間的某一行**（探針抓到 `$ RK_42` —— `MARK_42` 的前兩個字
   * 被 `$ ` 覆寫掉了）。
   *
   * 因此重播完要把游標挪到**內容之後**再寫分隔，而且只用相對移動（`\n` 會正確捲動，絕對定位不會）。
   * `done` 必須等到分隔也寫完才呼叫 —— 呼叫端要在那之後才接上 live 串流，否則 pty 的第一個
   * prompt 會插進歷史裡。
   */
  replay(history: string, separator: string, done: () => void): void
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

/**
 * 快照保留的行數。xterm 的 scrollback 是 5000 行，但快照要寫進磁碟、每個 session 一份 ——
 * 全部序列化並不划算。1000 行足以讓使用者認出「上次做到哪」。
 */
const SNAPSHOT_LINES = 1000

/**
 * 重播之後送出的模式重置：**不移動游標**。
 *
 * 快照裡可能殘留滑鼠追蹤（使用者關 app 時正開著 vim 或任何吃滑鼠的 TUI）與 SGR ——
 * `SerializeAddon` **會把終端模式一起序列化**（實測，快照裡真的有 `\x1b[?1049h` 與 `\x1b[?1003h`）。
 * 歷史是死的文字，新的 pty 不該繼承它的狀態。
 *
 * **這裡刻意沒有 `?1049l`** —— 那個要條件式地送（見 `replay`）。
 */
const RESET_MODES = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[0m'

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

  const serializeAddon = new SerializeAddon()
  term.loadAddon(serializeAddon)

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
    size() {
      return { cols: term.cols, rows: term.rows }
    },
    write(data) {
      term.write(data)
    },
    serialize() {
      return serializeAddon.serialize({ scrollback: SNAPSHOT_LINES })
    },
    replay(history, separator, done) {
      term.write(history, () => {
        // **快照裡可能含 `?1049h`**（實測：`SerializeAddon` 會把終端模式一起序列化）——
        // 使用者關掉 app 時若正開著 vim，重播到這裡我們就**站在 alternate buffer 裡**。
        // 不離開它，新的 shell 就跑在 vim 的畫面上：歷史全部看不見、沒有 scrollback。
        //
        // **`?1049l` 只在確實處於 alt buffer 時才送。** 它會還原「進入 alt screen 當下所儲存的
        // 游標」—— 真的進去過時，那正是我們要的位置；**沒進去過時，那個位置是 (0,0)**，游標會被
        // 拉回左上角，接著寫入的分隔線就蓋掉歷史的第二行、live 的第一個 prompt 再蓋掉第三行。
        const leaveAlt = term.buffer.active.type === 'alternate' ? '\x1b[?1049l' : ''

        term.write(`${leaveAlt}${RESET_MODES}`, () => {
          const buffer = term.buffer.active

          // 內容的最後一個非空行（絕對座標）。
          let last = buffer.length - 1
          while (last > 0 && (buffer.getLine(last)?.translateToString(true).trim() ?? '') === '') {
            last -= 1
          }

          // 游標若停在內容之上，往下挪到內容之後。**只用相對移動** —— `\n` 會正確捲動，而絕對
          // 定位在一個「尺寸與快照當下不同」的終端上會落在錯的地方。
          const cursor = buffer.baseY + buffer.cursorY
          const down = Math.max(0, last - cursor)
          term.write(`${'\n'.repeat(down + 1)}\r${separator}`, done)
        })
      })
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
      serializeAddon.dispose()
      fitAddon.dispose()
      term.dispose()
    },
  }
}
