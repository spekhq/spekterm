import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron'
import type { DirtyEntry } from '../main/dirty-state'
import type { FsResult, WriteResponse } from '../main/ipc/fs'
import type { DirEntry, FileContent } from '../main/fs-service'
import type { WatchBatch } from '../main/watch-service'
import type { WorkspaceFolder } from '../main/workspace-store'

/**
 * 主行程能力一律以具名白名單暴露（PRD §12）。
 * 不要把 ipcRenderer 整個交給 renderer —— 那等於繞過白名單。
 *
 * `fs` 之下的每一個能力，都必須先由 `filesystem-access` 規格定義其邊界要求，才能出現在
 * 這裡。這條約束的形式是白名單，不是清單：**任何函式進入這個介面之前，都必須先有邊界要求**。
 *
 * 寫入類的五個能力（`writeFile` / `createFile` / `createDirectory` / `deleteEntry` /
 * `rename`）於 `file-editing-and-crud` 引入，其邊界要求見該 change 的 `design.md` D1–D8。
 * **這裡沒有 `symlink`，而且不能有** —— renderer 一旦能建立符號連結，就能自己製造中間目錄段
 * 的 TOCTOU race，而 Node 沒有 `openat()` 可以擋（design D3）。
 */
const workspaceApi = {
  fs: {
    listDir: (folderId: string, relPath: string): Promise<FsResult<DirEntry[]>> =>
      ipcRenderer.invoke('workspace:fs:listDir', folderId, relPath),
    readFile: (folderId: string, relPath: string): Promise<FsResult<FileContent>> =>
      ipcRenderer.invoke('workspace:fs:readFile', folderId, relPath),
    /** `baseMtimeMs` 省略即為明確要求覆寫，主行程會略過衝突比對。 */
    writeFile: (
      folderId: string,
      relPath: string,
      text: string,
      baseMtimeMs?: number,
    ): Promise<FsResult<WriteResponse>> =>
      ipcRenderer.invoke('workspace:fs:writeFile', folderId, relPath, text, baseMtimeMs),
    createFile: (folderId: string, relPath: string): Promise<FsResult<void>> =>
      ipcRenderer.invoke('workspace:fs:createFile', folderId, relPath),
    createDirectory: (folderId: string, relPath: string): Promise<FsResult<void>> =>
      ipcRenderer.invoke('workspace:fs:createDirectory', folderId, relPath),
    deleteEntry: (folderId: string, relPath: string): Promise<FsResult<void>> =>
      ipcRenderer.invoke('workspace:fs:deleteEntry', folderId, relPath),
    rename: (folderId: string, fromRelPath: string, toRelPath: string): Promise<FsResult<void>> =>
      ipcRenderer.invoke('workspace:fs:rename', folderId, fromRelPath, toRelPath),
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
  app: {
    /**
     * 推送未存變更的快照。主行程在 `close` 事件中同步讀取它 —— 那一刻已經來不及發問。
     * 每次 dirty 集合變動都要推一次，包括變回空集合。
     */
    setDirtyState: (entries: DirtyEntry[]): void => {
      ipcRenderer.send('workspace:app:setDirtyState', entries)
    },
    /** 使用者在關閉對話框選了「儲存全部」。回傳取消訂閱的函式。 */
    onSaveAllRequest: (listener: () => void): (() => void) => {
      const handler = (): void => {
        listener()
      }
      ipcRenderer.on('workspace:app:saveAllRequest', handler)
      return () => {
        ipcRenderer.off('workspace:app:saveAllRequest', handler)
      }
    },
    /** 回報「儲存全部」的結果。`ok` 為 false 時主行程取消關閉。 */
    sendSaveAllResult: (ok: boolean): void => {
      ipcRenderer.send('workspace:app:saveAllResult', ok)
    },
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
