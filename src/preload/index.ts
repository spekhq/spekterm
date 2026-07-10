import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron'
import type { FsResult } from '../main/ipc/fs'
import type { DirEntry, FileContent } from '../main/fs-service'
import type { WatchBatch } from '../main/watch-service'
import type { WorkspaceFolder } from '../main/workspace-store'

/**
 * 主行程能力一律以具名白名單暴露（PRD §12）。
 * 不要把 ipcRenderer 整個交給 renderer —— 那等於繞過白名單。
 *
 * `fs` 之下的每一個能力，都必須先由 `filesystem-access` 規格定義其邊界要求，才能出現在
 * 這裡。這條約束的形式是白名單，不是清單：`writeFile` 之所以不在，不是因為忘了加，
 * 而是因為還沒有人為它定義寫入時的邊界（TOCTOU、`O_NOFOLLOW`）。
 */
const workspaceApi = {
  fs: {
    listDir: (folderId: string, relPath: string): Promise<FsResult<DirEntry[]>> =>
      ipcRenderer.invoke('workspace:fs:listDir', folderId, relPath),
    readFile: (folderId: string, relPath: string): Promise<FsResult<FileContent>> =>
      ipcRenderer.invoke('workspace:fs:readFile', folderId, relPath),
    watch: (folderId: string, relPath: string): Promise<FsResult<void>> =>
      ipcRenderer.invoke('workspace:fs:watch', folderId, relPath),
    unwatch: (folderId: string, relPath: string): Promise<FsResult<void>> =>
      ipcRenderer.invoke('workspace:fs:unwatch', folderId, relPath),
    /** 回傳取消訂閱的函式。renderer 拿不到 ipcRenderer，因此也無從自行解除其他監聽器。 */
    onWatchEvent: (listener: (batch: WatchBatch) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, batch: WatchBatch): void => {
        listener(batch)
      }
      ipcRenderer.on('workspace:fs:watchEvent', handler)
      return () => {
        ipcRenderer.off('workspace:fs:watchEvent', handler)
      }
    },
  },
  folders: {
    list: (): Promise<WorkspaceFolder[]> => ipcRenderer.invoke('workspace:folders:list'),
    add: (): Promise<WorkspaceFolder[]> => ipcRenderer.invoke('workspace:folders:add'),
    remove: (id: string): Promise<WorkspaceFolder[]> =>
      ipcRenderer.invoke('workspace:folders:remove', id),
  },
  shell: {
    /** 協定的驗證在主行程。此處只是把 URL 交過去。 */
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('workspace:shell:openExternal', url),
  },
} as const

export type WorkspaceApi = typeof workspaceApi

if (!process.contextIsolated) {
  throw new Error('contextIsolation 必須啟用，否則 preload 白名單形同虛設')
}

contextBridge.exposeInMainWorld('workspace', workspaceApi)
