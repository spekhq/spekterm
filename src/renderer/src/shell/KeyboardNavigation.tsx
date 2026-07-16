import { useEffect } from 'react'
import { t } from '@shared/i18n'
import { useSessions } from './terminal/sessions'
import type { WorkspaceFolder } from './types'

interface KeyboardNavigationProps {
  folders: WorkspaceFolder[]
  selectedId: string | null
  onSelectFolder: (id: string) => void
  /** 把某個 folder 移到第 `toIndex` 個位置。**以 id 指定，不以位置**（design D5）。 */
  onReorderFolder: (id: string, toIndex: number) => void
}

/** 下一個／上一個，到末端就繞回去。清單為空時回傳 `null`。 */
function cycle<T>(items: T[], currentIndex: number, delta: number): T | null {
  if (items.length === 0) return null
  const next = (currentIndex + delta + items.length) % items.length
  return items[next] ?? null
}

/**
 * 焦點是否落在**可編輯文字**上 —— 排序快捷鍵在那裡必須讓路。
 *
 * `Shift+arrow` **就是文字選取鍵**。全域攔截它會讓 side panel 的編輯器連「選一個字元」都做不到。
 *
 * **終端不算可編輯文字。** 這是本判準的整個重點：xterm 的輸入路徑是一個隱形的 `<textarea>`
 * （`.xterm-helper-textarea`），而 Monaco 的輸入路徑**也是** `<textarea>`（我們刻意關掉了它的
 * native EditContext）—— 若判準寫成「activeElement 是不是 textarea」，排序快捷鍵會在終端持有
 * 焦點時（也就是這個 app 絕大多數的時間）**靜默失效**。
 *
 * 因此先問「在不在終端之內」，再問「是不是可編輯文字」。第二問寫成通則而非列舉 Monaco，是為了
 * 讓任何新的輸入框自動被尊重（比照 `[role="dialog"]` 的判定哲學）。
 */
function editableTextHasFocus(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  if (active.closest('.xterm')) return false
  if (active.isContentEditable) return true
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
}

/**
 * 導航與排序的快捷鍵。**沒有 UI** —— 它只是把按鍵接到既有的動作上。
 *
 * | | |
 * |---|---|
 * | `Ctrl+Tab` / `Ctrl+Shift+Tab` | 當前 repo 內的下一個／上一個 session（**分頁位置序**，可循環） |
 * | `Ctrl+↓` / `Ctrl+↑` | rail 上的下一個／上一個 repo（可循環） |
 * | `Ctrl+T` | 開啟建立 session 的入口（spawn 選單） |
 * | `Ctrl+Shift+W` | 關閉當前 focused 的 session |
 * | `Shift+↓` / `Shift+↑` | 把選中的 repo 在 rail 上往下／往上移動一格（**不循環**） |
 * | `Shift+→` / `Shift+←` | 把 focused session 在分頁列上往右／往左移動一格（**不循環**） |
 *
 * ## 為什麼是 capture 階段
 *
 * 終端幾乎永遠持有焦點 —— 那是這個 app 的常態。xterm 會把按鍵直接寫進 pty，Monaco 也會吃掉
 * 按鍵。**capture 由 window 往下傳，早於兩者**綁在各自 DOM 節點上的 listener，因此
 * `stopPropagation()` 一下，它們都收不到，被攔下的按鍵也就不會流進 agent。
 *
 * > 既有的 `Ctrl+S` 之所以**被迫**註冊在 Monaco 內部（見 `editor/index.tsx`），不是因為
 * > 「window listener 沒用」，而是因為它註冊在 **bubble** 階段 —— Monaco 攔下該鍵並停止傳播，
 * > 它永遠冒不到 window。**階段選對就沒有這個問題。**
 *
 * ## 按鍵的取捨
 *
 * - **`Ctrl+Tab` 是白撿的**：終端協定裡 `Tab` 就是 `Ctrl+I`（`0x09`），而 `Ctrl+Tab`
 *   **編碼不出來** —— 沒有任何 shell 或 agent 綁得了它。拿走它，pty 內零損失。
 * - **`Ctrl+↑/↓` 是有代價的**：它送得出去（`CSI 1;5A` / `CSI 1;5B`），攔截它等於從 pty 裡的
 *   程式手上**永久沒收**這顆鍵。實測 zsh／bash 預設皆未綁定，唯一的犧牲者是 tmux
 *   （`prefix + C-Up/C-Down` 的 pane resize 與 copy-mode 捲動）—— 而這個 app 本身就是要取代
 *   那個用途。詳見 change 的 design D2。
 * - **`Ctrl+T` 的代價更貴**：zsh 與 bash readline **都**把它綁成 `transpose-chars`（實測）。
 *   採用它的前提有二：使用者的終端模擬器（GNOME Terminal）本來就把 `Ctrl+T` 拿去開新分頁了
 *   （所以那個 `transpose-chars` 早就沒有），而且 **`claude` 沒有使用 `Ctrl+T`** —— 後者是關鍵，
 *   claude session 是這個 app 的主場。**此結論有前提**：日後若 claude 開始用它，本裁決即失效
 *   （退路是 `Ctrl+Shift+T`，零成本）。詳見 design D8。
 * - **`Ctrl+C` 絕不挪用**：它必須維持中斷訊號。
 * - **`Shift+arrow` 的代價與前幾顆不同種**：它同樣送得出去（`CSI 1;2A`–`D`，實測 zsh／bash 皆未
 *   綁定），但**已知的犧牲者正是 `claude` 自己的 agents view** —— 也就是說這個 app 的**主場**在
 *   用它。`Ctrl+T` 之所以能拿，關鍵前提是「claude 沒在用它」；這一顆是**明知它在用，仍然拿走**
 *   （使用者在知情下的裁決：在 rail 上排 repo 的頻率遠高於在 agents view 裡按 `Shift+↑↓`）。
 *   **此裁決有前提**，前提若不再成立，退路是 `Ctrl+Shift+arrow`（同樣未被 shell 綁定，且與
 *   `Ctrl+↑↓`／`Ctrl+Tab` 成對：Ctrl ＝ 移動游標，加 Shift ＝ 移動東西）。詳見 design D1。
 * - **排序快捷鍵有一條導航快捷鍵沒有的例外**：焦點在**可編輯文字**上時它讓路（見
 *   `editableTextHasFocus`）—— `Shift+arrow` 就是文字選取鍵。導航快捷鍵不受此限（`Ctrl+Tab` 在
 *   編輯器裡沒有這種代價，而 spec 明文要求它在編輯器持有焦點時仍生效）。
 */
export function KeyboardNavigation({
  folders,
  selectedId,
  onSelectFolder,
  onReorderFolder,
}: KeyboardNavigationProps): null {
  const sessions = useSessions()

  useEffect(() => {
    /**
     * 排序：`Shift+↑↓` 移動選中的 repo、`Shift+←→` 移動 focused session。
     *
     * **端點不循環**（無操作）。導航是巡覽 —— 越過末端繞回開頭什麼都沒被改變；排序是**改變
     * 資料**，繞回去等於「把第一名丟到最後一名」，那是使用者按過頭時最不想發生的事，而且要
     * 再按 N-1 次才回得來（design D3）。
     *
     * 回傳「是否處理了這顆按鍵」—— 未處理時**完全不攔**（不 preventDefault、不 stopPropagation），
     * 該按鍵照常抵達它本來要去的地方。
     */
    const handleReorder = (event: KeyboardEvent): boolean => {
      const isUp = event.key === 'ArrowUp'
      const isDown = event.key === 'ArrowDown'
      const isLeft = event.key === 'ArrowLeft'
      const isRight = event.key === 'ArrowRight'
      if (!isUp && !isDown && !isLeft && !isRight) return false

      // 文字選取優先 —— 這一顆鍵在編輯器與輸入框裡有它自己的、更根本的意義。
      if (editableTextHasFocus()) return false

      if (!selectedId) return true

      if (isUp || isDown) {
        const index = folders.findIndex((folder) => folder.id === selectedId)
        if (index === -1) return true

        const toIndex = index + (isDown ? 1 : -1)
        if (toIndex < 0 || toIndex >= folders.length) return true
        onReorderFolder(selectedId, toIndex)
        return true
      }

      const list = sessions.forFolder(selectedId)
      const focusedId = sessions.focusedIdFor(selectedId)
      const index = list.findIndex((session) => session.id === focusedId)
      if (index === -1) return true

      const toIndex = index + (isRight ? 1 : -1)
      if (toIndex < 0 || toIndex >= list.length) return true
      sessions.reorder(selectedId, index, toIndex)
      return true
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.metaKey) return

      // 對話框與選單正在等使用者的裁決 —— 快捷鍵一律讓位。對話框：否則使用者會在回答問題的同時
      // 把畫面切走、或把清單重排。選單：否則他正用方向鍵挑選項時，一個 Ctrl+Tab 就把畫面切走了
      // （design D9）。
      //
      // 以 `role` 判定：任何遵守這個無障礙慣例的新對話框／選單都自動被尊重，不必記得去某份清單
      // 註冊（design D5）。
      if (document.querySelector('[role="dialog"], [role="menu"]')) return

      // 排序：純 Shift（`Ctrl+Shift+Tab` 仍是導航，因此這裡要求 `!ctrlKey`）。
      if (event.shiftKey && !event.ctrlKey) {
        if (!handleReorder(event)) return
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (!event.ctrlKey) return

      const isTab = event.key === 'Tab'
      const isUp = event.key === 'ArrowUp'
      const isDown = event.key === 'ArrowDown'
      const isNewSession = event.key.toLowerCase() === 't'
      // `Ctrl+Shift+W` 關閉當前 session。選 Shift 版而非 `Ctrl+W`：後者是 zsh／bash 的高頻刪字鍵，
      // 且沒有 `Ctrl+T` 的「GNOME Terminal 早已拿走」豁免；`Ctrl+Shift+<字母>` 編碼不出來，pty 內
      // 收不到，代價為零（design D1）。
      const isCloseSession = event.shiftKey && event.key.toLowerCase() === 'w'
      if (!isTab && !isUp && !isDown && !isNewSession && !isCloseSession) return
      if ((isUp || isDown || isNewSession) && event.shiftKey) return

      // **早於 xterm 與 Monaco 攔下它。** stopPropagation 讓事件到不了它們綁在 DOM 節點上的
      // listener，於是按鍵不會被寫進 pty。
      event.preventDefault()
      event.stopPropagation()

      if (isNewSession) {
        // **觸發既有的建立入口，不另闢路徑。** `useSpawnMenu.open` 是從 `event.currentTarget`
        // 的 rect 算出選單位置的 —— 走這條路，鍵盤叫出的選單與滑鼠點出來的**錨定在同一個地方**，
        // 而 spawn 選單的狀態也不必從 `SessionTabs` 搬出來。鍵盤的接縫仍然只有這一處（design D9）。
        //
        // 沒有選中的 repo 時，這顆按鈕根本不在 DOM 裡 —— 自然成為無操作。
        //
        // **文案自字典取得，絕不硬編。** `aria-label` 在這裡同時是選擇器：寫死它，一次文案
        // 改動就會**靜默地**廢掉這顆快捷鍵 —— 字串比對不會使型別檢查失敗，也不會有任何紅燈
        // （`ui-localization`：以文案定位介面元素的程式碼自字典取得該文案）。
        const entry = document.querySelector<HTMLElement>(`[aria-label="${t('sessions.new')}"]`)
        entry?.click()
        return
      }

      if (isCloseSession) {
        // 關閉當前 focused 的 session。沒有選中的 repo 或該 repo 沒有 session 時為無操作。
        // 走既有的 `close` 路徑（Phase 4 的生命週期，不留孤兒 pty）—— 與點分頁的 ✕ 無異。
        if (!selectedId) return
        const focusedId = sessions.focusedIdFor(selectedId)
        if (focusedId) sessions.close(focusedId)
        return
      }

      if (isTab) {
        if (!selectedId) return
        const list = sessions.forFolder(selectedId)
        const focusedId = sessions.focusedIdFor(selectedId)
        const index = list.findIndex((session) => session.id === focusedId)
        if (index === -1) return

        const next = cycle(list, index, event.shiftKey ? -1 : 1)
        if (next) sessions.focus(selectedId, next.id)
        return
      }

      const index = folders.findIndex((folder) => folder.id === selectedId)
      if (index === -1) return

      const next = cycle(folders, index, isDown ? 1 : -1)
      if (next) onSelectFolder(next.id)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [folders, selectedId, onSelectFolder, onReorderFolder, sessions])

  return null
}
