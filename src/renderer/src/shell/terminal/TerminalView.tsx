import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpawnTarget } from '../types'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import { usePreferences } from '../PreferencesProvider'
import { type SessionStatus, useSessions } from './sessions'
import { type XtermHandle, createXterm } from './xterm'
import { useTranslation } from 'react-i18next'
import { t } from '@shared/i18n'

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
function separator(): string {
  // 只有**文字**進字典 —— ANSI 與框線字元是呈現，不是文案。
  return `\x1b[2m── ${t('sessions.replaySeparator')} ──\x1b[0m\r\n`
}

export function TerminalView({
  sessionId,
  spawnTarget,
  status,
  wakeError,
  active,
}: TerminalViewProps): React.JSX.Element {
  const { t } = useTranslation()
  // 解構出穩定的 callback。若依賴整個 api 物件，session 清單一變動就會重建 xterm
  // （連同 scrollback 一起消失）。
  const { attach, setTitle, restoredScrollbackOf } = useSessions()
  const { terminal: termPrefs } = usePreferences()
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
    // **只有真的有 pty 的 session 才可以覆寫自己的快照。**
    //
    // 一個從未被喚醒的休眠 shell session，它的 xterm 裡已經被 `replay()` 寫進了「歷史 + 分隔線」。
    // 若關窗時照樣序列化，那份**含分隔線**的內容就會被寫回快照檔 —— 下次開啟再重播一次、再追加
    // 一條新的分隔線。使用者一路不碰它，**每重開一次就多一條「以上為上次的內容」**。而且隱藏中的
    // 終端從未 `fit()` 過，它是以 80 欄重新序列化的，歷史每輪還會被重排一次。
    if (status !== 'running') return

    const flush = (): void => {
      const data = handleRef.current?.serialize()
      if (data) window.workspace.terminal.snapshot(sessionId, data)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [sessionId, snapshots, status])

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
    if (history) handle.replay(history, separator(), streamLive)
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

  // 中鍵貼上：**在 capture 階段完全接管中鍵**，只貼一次。
  //
  // 中鍵貼上是**終端的**慣例，不是 pty 內程式的慣例 —— 由我們擁有它、只貼一次，才是確定的行為。
  // dogfood 抓到：login shell（mouse off）與 claude（mouse on）中鍵**都貼兩次** —— 兇手是 Chromium 的
  // native 中鍵貼上（X11 PRIMARY selection）一直在發生，加上我們自己的貼上就是兩次。原本走 React 的
  // `onMouseDown`（bubble 階段）擋不掉它：其一 bubble 晚於 xterm 掛在 `.xterm-screen`（host 子節點）
  // 上的 listener（xterm 已把中鍵轉發給 claude）；其二 native 貼上掛在 `auxclick` 而非 mousedown，
  // mousedown 的 `preventDefault` 打不到它。
  //
  // capture 由 host 往下傳、早於子節點的 listener：對中鍵的 mousedown／mouseup／auxclick 一律
  // `preventDefault`（擋掉 native 貼上，不論它掛在哪個事件）+ `stopPropagation`（xterm 收不到、不會
  // 轉發給 claude），並在 mousedown 時做**唯一一次**我們的貼上。於是中鍵恆為一次乾淨的貼上，與
  // mouse reporting 開不開無關（貼的是 CLIPBOARD，與快捷鍵同源，design D5）。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const suppress = (event: MouseEvent): void => {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onDown = (event: MouseEvent): void => {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
      paste()
    }
    host.addEventListener('mousedown', onDown, true)
    host.addEventListener('mouseup', suppress, true)
    host.addEventListener('auxclick', suppress, true)
    return () => {
      host.removeEventListener('mousedown', onDown, true)
      host.removeEventListener('mouseup', suppress, true)
      host.removeEventListener('auxclick', suppress, true)
    }
  }, [paste])

  // 由隱藏轉為顯示的那一刻，容器才第一次有尺寸 —— 必須重新 fit 一次（design D7 的代價）。
  useEffect(() => {
    if (!active) return
    const size = handleRef.current?.fit()
    if (size) window.workspace.terminal.resize(sessionId, size.cols, size.rows)
    handleRef.current?.focus()
  }, [active, sessionId])

  // 套用終端字型偏好。掛載時套一次（偏好通常已由 `PreferencesProvider` 早載入備妥），偏好變更時再套。
  //
  // **只有 `setFont` 真的改動了選項才 `fit()`／`resize()`。** 掛載時偏好通常等於預設 —— 什麼都沒變卻
  // 照樣 resize，等於對 pty 多送一次無謂的 SIGWINCH，而 shell 收到它會重畫 prompt，把終端既有的輸出
  // 往上推（probe 抓到：「切回 session 後其先前的輸出仍在」讀不到早期內容，baseline 168/168 卻是綠的）。
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    const changed = handle.setFont({
      family: termPrefs.fontFamily ?? null,
      size: termPrefs.fontSize ?? null,
      lineHeight: termPrefs.lineHeight ?? null,
    })
    if (!changed) return
    // 字級與行高改變會改 cell 尺寸 —— 新的行列數必須告知 pty。
    const size = handle.fit()
    if (size) window.workspace.terminal.resize(sessionId, size.cols, size.rows)
  }, [termPrefs.fontFamily, termPrefs.fontSize, termPrefs.lineHeight, sessionId])

  const items: MenuItem[] = [
    {
      label: t('sessions.copy'),
      // 停用而非隱藏 —— 使用者要看得到這個操作存在。
      disabled: !menu?.hasSelection,
      onSelect: () => {
        setMenu(null)
        copy()
      },
    },
    {
      label: t('sessions.paste'),
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
      //
      // **`relative` 是承重的**：底下那些休眠提示是 `absolute` 的，需要一個定位祖先；少了它，
      // 它們會相對於更外層的 `<section>` 定位。而真正致命的是**堆疊順序** —— xterm 的 `.xterm`
      // 是 `position: relative`（它自己的 CSS），且由 `handle.open(host)` 在 effect 裡 append，
      // 也就是排在 React children **之後**。兩者都是 `z-index: auto` → 依 tree order 繪製 →
      // **xterm 蓋在提示上**，而 `.xterm-viewport` 的背景是不透明的。於是休眠的 claude 分頁
      // 看起來就是一塊空白終端 —— 正是 spec 明文禁止的那件事。提示因此必須明確拿到 z-index。
      className={active ? 'relative h-full w-full' : 'hidden'}
      onContextMenu={(event) => {
        // 原生選單一律擋掉。
        event.preventDefault()
        // **mouse reporting 開啟時（claude 接管滑鼠），右鍵讓位給程式** —— 不開我們的選單，
        // 讓 claude 的右鍵貼上等慣例生效（xterm 已把 mousedown 轉發給它）。未接管時才用我們的
        // 複製／貼上選單（design D1）。狀態在事件當下讀取 —— 程式會動態開關 mouse mode。
        if (handleRef.current?.mouseTrackingActive()) return
        // 選取狀態要在開啟選單的當下取樣 —— 選單一旦開啟，焦點就離開終端了。
        setMenu({
          x: event.clientX,
          y: event.clientY,
          hasSelection: handleRef.current?.hasSelection() ?? false,
        })
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
          // **恢復不了是個錯誤狀態，它必須看得見。** 貼在底部的一條細帶太弱 —— 使用者面對的仍是
          // 一大塊黑色空白，只有邊緣一行小字。置中呈現，與 claude 的休眠提示同一種載體。
          //
          // **這一個刻意不是 `pointer-events-none`**（另外兩個是）：它背後是一個**永遠不會活過來**
          // 的終端，沒有東西值得點。讓它接住指標事件，這塊提示才是實心的 —— 而不是一層點得穿的
          // 幽靈。順帶也讓探針能以 `elementFromPoint` 做真正的 hit-test（`pointer-events-none`
          // 的元素會被它跳過，於是「它有沒有被 xterm 蓋住」根本量不到）。
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="max-w-[80%] rounded border border-hairline bg-shell/90 px-4 py-3 text-center text-2xs text-danger">
              {t('sessions.wakeFailed', { message: wakeError })}
            </div>
          </div>
        ) : spawnTarget === 'shell' ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-shell/90 px-3 py-2 text-2xs text-ink-faint">
            {t('sessions.dormantShell')}
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded border border-hairline bg-shell/90 px-4 py-3 text-center text-2xs text-ink-faint">
              {t('sessions.dormantClaude')}
            </div>
          </div>
        ))}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
