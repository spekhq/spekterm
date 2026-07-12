import { useEffect } from 'react'
import { useSessions } from './terminal/sessions'
import type { WorkspaceFolder } from './types'

interface KeyboardNavigationProps {
  folders: WorkspaceFolder[]
  selectedId: string | null
  onSelectFolder: (id: string) => void
}

/** 下一個／上一個，到末端就繞回去。清單為空時回傳 `null`。 */
function cycle<T>(items: T[], currentIndex: number, delta: number): T | null {
  if (items.length === 0) return null
  const next = (currentIndex + delta + items.length) % items.length
  return items[next] ?? null
}

/**
 * 導航快捷鍵。**沒有 UI** —— 它只是把按鍵接到既有的切換動作上。
 *
 * | | |
 * |---|---|
 * | `Ctrl+Tab` / `Ctrl+Shift+Tab` | 當前 repo 內的下一個／上一個 session（**分頁位置序**，可循環） |
 * | `Ctrl+↓` / `Ctrl+↑` | rail 上的下一個／上一個 repo（可循環） |
 * | `Ctrl+T` | 開啟建立 session 的入口（spawn 選單） |
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
 */
export function KeyboardNavigation({
  folders,
  selectedId,
  onSelectFolder,
}: KeyboardNavigationProps): null {
  const sessions = useSessions()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return

      // 對話框與選單正在等使用者的裁決 —— 導航一律讓位。對話框：否則使用者會在回答問題的同時
      // 把畫面切走。選單：否則他正用方向鍵挑選項時，一個 Ctrl+Tab 就把畫面切走了（design D9）。
      //
      // 以 `role` 判定：任何遵守這個無障礙慣例的新對話框／選單都自動被尊重，不必記得去某份清單
      // 註冊（design D5）。
      if (document.querySelector('[role="dialog"], [role="menu"]')) return

      const isTab = event.key === 'Tab'
      const isUp = event.key === 'ArrowUp'
      const isDown = event.key === 'ArrowDown'
      const isNewSession = event.key.toLowerCase() === 't'
      if (!isTab && !isUp && !isDown && !isNewSession) return
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
        const entry = document.querySelector<HTMLElement>('[aria-label="新增 session"]')
        entry?.click()
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
  }, [folders, selectedId, onSelectFolder, sessions])

  return null
}
