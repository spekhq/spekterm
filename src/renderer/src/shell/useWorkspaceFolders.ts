import { useCallback, useEffect, useState } from 'react'
import type { RailSelection, WorkspaceFolder } from './types'

export interface WorkspaceFoldersState {
  folders: WorkspaceFolder[]
  /**
   * rail 上選中的項目。**`null` ＝ 尚未選中任何項目**，與「選中全域項目」互斥可辨
   * （design D8）—— 冷啟動時它是 `null`，而那正是 `session-persistence`「至多啟動一個
   * session」所倚賴的前提。
   */
  selection: RailSelection | null
  select: (selection: RailSelection) => void
  addFolder: () => Promise<void>
  removeFolder: (id: string) => Promise<void>
  /**
   * 把一個 folder 移到清單的第 `toIndex` 個位置。
   *
   * **以識別碼指定要移動的 folder** —— 權威在主行程，這裡的 `folders` 只是一份會被推送更新的
   * 複本（design D5）。`selectedId` 不必跟著調整：它存的是 id，不是位置，重排後選中的自然
   * 仍是同一個 repo。
   */
  reorderFolders: (id: string, toIndex: number, pinned: boolean) => Promise<void>
  /**
   * 切換置頂狀態。位置由狀態推導（跨越分界的最小移動），與 `reorderFolders`「位置是權威、
   * 狀態由落點推導」恰好互為表裡。
   */
  setPinned: (id: string, pinned: boolean) => Promise<void>
}

export function useWorkspaceFolders(): WorkspaceFoldersState {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [selection, setSelection] = useState<RailSelection | null>(null)

  useEffect(() => {
    // **先訂閱、再列清單。** 兩者之間的窗口裡發生的分支變動會兩頭落空：清單沒看到它，推送也
    // 還沒開始收。這與 Phase 2 的「先訂閱、再列目錄」、Phase 4 的「輸出的訂閱必須早於 create」
    // 同源 —— 這個 app 的前提就是旁邊有 agent 與使用者一直在動這些 repo。
    const unsubscribe = window.workspace.folders.onChanged(setFolders)
    void window.workspace.folders.list().then(setFolders)
    return unsubscribe
  }, [])

  const addFolder = useCallback(async () => {
    // 取消對話框時主行程回傳未變動的清單，因此這裡不需要區分「取消」與「加入」
    setFolders(await window.workspace.folders.add())
  }, [])

  const removeFolder = useCallback(async (id: string) => {
    setFolders(await window.workspace.folders.remove(id))
    // 被移除的正是選中的那個 folder 時才清空選取。選中全域項目時不受影響 —— 它不是 workspace
    // 的成員，移除任何 folder 都動不到它。
    setSelection((current) =>
      current?.kind === 'folder' && current.id === id ? null : current,
    )
  }, [])

  const reorderFolders = useCallback(async (id: string, toIndex: number, pinned: boolean) => {
    // **先樂觀套用，再以主行程的回覆對帳。**
    //
    // 少了這一步，**連按 `Shift+↓` 會靜默丟失移動**：第二次按下時 `folders` 仍是舊的（IPC 還沒
    // 回來 —— 中間隔著一次同步的 `writeFileSync`，而主行程本來就會被 OpenSpec 掃描阻塞），於是
    // 算出**同一個** `toIndex`，主行程看到 `to === from` 直接返回。使用者按兩次只動一格，看起來
    // 像「快捷鍵有時候沒反應」。
    //
    // updater 必須是**純函式**（StrictMode 會 double-invoke 它）—— 這裡只計算新陣列，IPC 在外面。
    setFolders((current) => applyPlacement(current, id, toIndex, pinned))

    // 權威仍在主行程 —— 它的回覆是最終的順序（樂觀更新只是把等待藏起來）。
    setFolders(await window.workspace.folders.reorder(id, toIndex, pinned))
  }, [])

  const setPinned = useCallback(async (id: string, pinned: boolean) => {
    // 落點是「跨越分界的最小移動」，與主行程 `setPinned` 的推導一致 —— 樂觀更新若算出別的位置，
    // 使用者會看到它先跳到一個地方、再被主行程的回覆挪到另一個地方。
    setFolders((current) => {
      const rest = current.filter((folder) => folder.id !== id)
      return applyPlacement(current, id, rest.filter((folder) => folder.pinned).length, pinned)
    })
    setFolders(await window.workspace.folders.setPinned(id, pinned))
  }, [])

  return {
    folders,
    selection,
    select: setSelection,
    addFolder,
    removeFolder,
    reorderFolders,
    setPinned,
  }
}

/**
 * 樂觀更新用的擺放 —— 與主行程 `WorkspaceStore.place()` 同語意的一份複本。
 *
 * **早退的條件是「位置與置頂狀態**皆**未改變」。** 跨越分界的移動其序位前後**同值**（置頂段的
 * 最後一個變成其餘段的第一個）；以「位置相同即返回」為早退條件時，樂觀更新會保留舊的置頂狀態，
 * 畫面上就是「按了沒反應」，直到主行程的回覆才跳一下 —— 而若主行程那道閘門也沒改，就永遠不會
 * 跳。這是同一個 bug 的第二份，兩道都要改。
 */
function applyPlacement(
  folders: WorkspaceFolder[],
  id: string,
  folderIndex: number,
  pinned: boolean,
): WorkspaceFolder[] {
  const from = folders.findIndex((folder) => folder.id === id)
  if (from === -1) return folders

  const next = [...folders]
  const [moved] = next.splice(from, 1)
  const pinnedCount = next.filter((folder) => folder.pinned).length

  // 置頂者只能落在前綴之內，未置頂者只能落在其後 —— 與主行程同一條不變式。
  const to = Math.min(
    Math.max(folderIndex, pinned ? 0 : pinnedCount),
    pinned ? pinnedCount : next.length,
  )
  if (to === from && pinned === moved.pinned) return folders

  next.splice(to, 0, { ...moved, pinned })
  return next
}
