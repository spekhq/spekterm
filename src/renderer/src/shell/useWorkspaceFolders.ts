import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceFolder } from './types'

export interface WorkspaceFoldersState {
  folders: WorkspaceFolder[]
  selectedId: string | null
  select: (id: string) => void
  addFolder: () => Promise<void>
  removeFolder: (id: string) => Promise<void>
}

export function useWorkspaceFolders(): WorkspaceFoldersState {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
    setSelectedId((current) => (current === id ? null : current))
  }, [])

  return { folders, selectedId, select: setSelectedId, addFolder, removeFolder }
}
