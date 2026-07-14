import type { GraphData } from '@spekjs/core'
import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron'
import type { DirtyEntry } from '../main/dirty-state'
import type { FsResult, WriteResponse } from '../main/ipc/fs'
import type { RestoredSession } from '../main/ipc/terminal'
import type { DirEntry, FileContent } from '../main/fs-service'
import type { RendererSession } from '../main/session-store'
import type {
  ChangeDetailView,
  ChangesData,
  OverviewData,
  SpecDetailView,
  SpecSummary,
  SpecVersionView,
} from '../main/openspec-service'
import type { SpawnTarget } from '../main/terminal'
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
  /**
   * OpenSpec 結構的唯讀存取。`fs.*` 是「檔案」的詞彙，這裡是「spec 與 change」的詞彙。
   *
   * method 的形狀刻意對齊 spek 前端既有的 `ApiAdapter`（`openspec-side-panel` 的 design D1）
   * —— 差別只在每個 method 的第一個參數是 `folderId`。日後若真要接 `@spekjs/ui`，換的是 UI，
   * 不是這道接縫。
   *
   * **`slug` 與 `topic` 是不受信任的輸入**：它們會被 core 拿去拼接檔案路徑。主行程一律先在
   * 掃描結果裡查表，只對確實存在的 identifier 呼叫 core（design D6）—— 這裡不做任何驗證，
   * preload 與 renderer 同屬一個行程樹，在這裡檢查等同沒有檢查。
   */
  openspec: {
    getOverview: (folderId: string): Promise<FsResult<OverviewData>> =>
      ipcRenderer.invoke('workspace:openspec:getOverview', folderId),
    getSpecs: (folderId: string): Promise<FsResult<SpecSummary[]>> =>
      ipcRenderer.invoke('workspace:openspec:getSpecs', folderId),
    getSpec: (folderId: string, topic: string): Promise<FsResult<SpecDetailView>> =>
      ipcRenderer.invoke('workspace:openspec:getSpec', folderId, topic),
    getSpecAtChange: (
      folderId: string,
      topic: string,
      slug: string,
    ): Promise<FsResult<SpecVersionView>> =>
      ipcRenderer.invoke('workspace:openspec:getSpecAtChange', folderId, topic, slug),
    getChanges: (folderId: string): Promise<FsResult<ChangesData>> =>
      ipcRenderer.invoke('workspace:openspec:getChanges', folderId),
    getChange: (folderId: string, slug: string): Promise<FsResult<ChangeDetailView>> =>
      ipcRenderer.invoke('workspace:openspec:getChange', folderId, slug),
    getGraphData: (folderId: string): Promise<FsResult<GraphData>> =>
      ipcRenderer.invoke('workspace:openspec:getGraphData', folderId),
    /** 該 folder 的 OpenSpec 結構已變更（agent 改了檔）。回傳取消訂閱的函式。 */
    onChanged: (listener: (folderId: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, folderId: string): void => {
        listener(folderId)
      }
      ipcRenderer.on('workspace:openspec:changed', handler)
      return () => {
        ipcRenderer.off('workspace:openspec:changed', handler)
      }
    },
  },
  folders: {
    list: (): Promise<WorkspaceFolder[]> => ipcRenderer.invoke('workspace:folders:list'),
    add: (): Promise<WorkspaceFolder[]> => ipcRenderer.invoke('workspace:folders:add'),
    remove: (id: string): Promise<WorkspaceFolder[]> =>
      ipcRenderer.invoke('workspace:folders:remove', id),
    /**
     * folder 清單的推送更新（目前唯一的來源是 git 分支變動 —— 使用者在 terminal 裡切 branch）。
     * 回傳取消訂閱的函式：renderer 拿不到 `ipcRenderer`，因此也無從自行解除其他監聽器。
     */
    onChanged: (listener: (folders: WorkspaceFolder[]) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, folders: WorkspaceFolder[]): void => {
        listener(folders)
      }
      ipcRenderer.on('workspace:folders:changed', handler)
      return () => {
        ipcRenderer.off('workspace:folders:changed', handler)
      }
    },
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
  /**
   * 系統剪貼簿的文字讀寫。終端的複製貼上沒有它就不成立。
   *
   * **這道能力沒有 workspace 邊界可言** —— 剪貼簿裡可能是使用者剛複製的密碼。它與 `fs.*`
   * 那種「只能碰已加入的 folder」是**不同性質**的東西，不要照著 fs 的直覺去推論它的安全性。
   *
   * 可接受性建立在兩道前提上（`terminal-clipboard` 的 design D2）：
   *
   * 1. **renderer 不會變成別人的頁面** —— `navigation.ts` 的導航防護是這道能力的**前提**。
   *    少了它，使用者 repo 裡一個 markdown 連結就能把遠端頁面帶進這個 renderer，而那個
   *    頁面會拿到 `readText`。
   * 2. **只在使用者明確要求貼上時讀取**（右鍵選單／快捷鍵／中鍵）—— 不主動讀、不背景輪詢、
   *    不在啟動時讀。
   */
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke('workspace:clipboard:readText'),
    writeText: (text: string): void => {
      ipcRenderer.send('workspace:clipboard:writeText', text)
    },
  },
  /**
   * terminal 的邊界要求見 `terminal-agent-sessions` 的 `design.md` D5：`create` **只收
   * folderId、不收路徑**，cwd 恆為該 folder 的根目錄 —— renderer 在語彙上無從把初始 cwd
   * 指向 workspace 之外。
   *
   * **此邊界只約束「初始 cwd」。** session 一旦啟動即為真實 shell，其內執行的命令不受此
   * 邊界限制（使用者可以 `cd` 到任何地方 —— 那正是終端的用途）。這與 `fs` 白名單的沙箱
   * 語意**不同**，不要把它當成沙箱來推論。
   */
  terminal: {
    create: (folderId: string, spawnTarget: SpawnTarget): Promise<FsResult<{ sessionId: string }>> =>
      ipcRenderer.invoke('workspace:terminal:create', folderId, spawnTarget),
    /**
     * 喚醒一個休眠的 session（重建後尚無 pty）。
     *
     * **只收 sessionId** —— 續接用的對話識別碼與最後的工作目錄都在主行程手上，renderer 連
     * 這兩個詞彙都沒有（session-persistence 的「持久化不得把路徑詞彙交給 renderer」）。
     */
    wake: (sessionId: string): Promise<FsResult<{ sessionId: string }>> =>
      ipcRenderer.invoke('workspace:terminal:wake', sessionId),
    /** 啟動時取回要重建的 session（含各自的終端畫面快照）。 */
    restore: (): Promise<RestoredSession[]> => ipcRenderer.invoke('workspace:terminal:restore'),
    /** 推送 session 清單以供持久化。payload **不含任何路徑，也不含對話識別碼**。 */
    persist: (sessions: RendererSession[]): void => {
      ipcRenderer.send('workspace:terminal:persist', sessions)
    },
    /** 推送終端畫面快照（僅 shell 目標 —— claude 續接時會自行重現對話）。 */
    snapshot: (sessionId: string, data: string): void => {
      ipcRenderer.send('workspace:terminal:snapshot', sessionId, data)
    },
    /** renderer → pty，單向 fire-and-forget：逐鍵輸入不必等一次 round-trip 的回應。 */
    write: (sessionId: string, data: string): void => {
      ipcRenderer.send('workspace:terminal:write', sessionId, data)
    },
    resize: (sessionId: string, cols: number, rows: number): void => {
      ipcRenderer.send('workspace:terminal:resize', sessionId, cols, rows)
    },
    kill: (sessionId: string): void => {
      ipcRenderer.send('workspace:terminal:kill', sessionId)
    },
    /** pty → renderer 的輸出。回傳取消訂閱的函式。 */
    onData: (listener: (sessionId: string, chunk: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, sessionId: string, chunk: string): void => {
        listener(sessionId, chunk)
      }
      ipcRenderer.on('workspace:terminal:data', handler)
      return () => {
        ipcRenderer.off('workspace:terminal:data', handler)
      }
    },
    /** pty 結束。回傳取消訂閱的函式。 */
    onExit: (listener: (sessionId: string, exitCode: number) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, sessionId: string, exitCode: number): void => {
        listener(sessionId, exitCode)
      }
      ipcRenderer.on('workspace:terminal:exit', handler)
      return () => {
        ipcRenderer.off('workspace:terminal:exit', handler)
      }
    },
  },
} as const

export type WorkspaceApi = typeof workspaceApi

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled, otherwise the preload allowlist is meaningless')
}

contextBridge.exposeInMainWorld('workspace', workspaceApi)
