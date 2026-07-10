import { contextBridge, ipcRenderer } from 'electron'
import type { DirEntry } from '../main/fs-service'
import type { WorkspaceFolder } from '../main/workspace-store'

/**
 * 主行程能力一律以具名白名單暴露（PRD §12）。
 * 不要把 ipcRenderer 整個交給 renderer —— 那等於繞過白名單。
 *
 * `fs` 之下目前只有 `listDir`。`readFile` / `writeFile` 等能力必須等到後續 change
 * 為它們定義邊界要求之後才可加入 —— 邊界檢查在主行程，而不是這裡。
 */
const workspaceApi = {
  fs: {
    listDir: (folderId: string, relPath: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke('workspace:fs:listDir', folderId, relPath),
  },
  folders: {
    list: (): Promise<WorkspaceFolder[]> => ipcRenderer.invoke('workspace:folders:list'),
    add: (): Promise<WorkspaceFolder[]> => ipcRenderer.invoke('workspace:folders:add'),
    remove: (id: string): Promise<WorkspaceFolder[]> =>
      ipcRenderer.invoke('workspace:folders:remove', id),
  },
} as const

export type WorkspaceApi = typeof workspaceApi

if (!process.contextIsolated) {
  throw new Error('contextIsolation 必須啟用，否則 preload 白名單形同虛設')
}

contextBridge.exposeInMainWorld('workspace', workspaceApi)
