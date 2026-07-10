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
    void window.workspace.folders.list().then(setFolders)
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
