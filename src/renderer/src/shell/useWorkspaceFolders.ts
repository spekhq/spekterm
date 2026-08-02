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
  reorderFolders: (id: string, toIndex: number) => Promise<void>
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

  const reorderFolders = useCallback(async (id: string, toIndex: number) => {
    // **先樂觀套用，再以主行程的回覆對帳。**
    //
    // 少了這一步，**連按 `Shift+↓` 會靜默丟失移動**：第二次按下時 `folders` 仍是舊的（IPC 還沒
    // 回來 —— 中間隔著一次同步的 `writeFileSync`，而主行程本來就會被 OpenSpec 掃描阻塞），於是
    // 算出**同一個** `toIndex`，主行程看到 `to === from` 直接返回。使用者按兩次只動一格，看起來
    // 像「快捷鍵有時候沒反應」。
    //
    // updater 必須是**純函式**（StrictMode 會 double-invoke 它）—— 這裡只計算新陣列，IPC 在外面。
    setFolders((current) => {
      const from = current.findIndex((folder) => folder.id === id)
      if (from === -1) return current

      const to = Math.min(Math.max(toIndex, 0), current.length - 1)
      if (to === from) return current

      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })

    // 權威仍在主行程 —— 它的回覆是最終的順序（樂觀更新只是把等待藏起來）。
    setFolders(await window.workspace.folders.reorder(id, toIndex))
  }, [])

  return { folders, selection, select: setSelection, addFolder, removeFolder, reorderFolders }
}
