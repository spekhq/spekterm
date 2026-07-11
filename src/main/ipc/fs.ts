import { type WebContents, ipcMain } from 'electron'
import { FsBoundaryError } from '../fs-boundary'
import {
  FsServiceError,
  createDirectory,
  createFile,
  deleteEntry,
  listDir,
  readFile,
  rename,
  writeFile,
} from '../fs-service'
import { type WatchBatch, WatchService } from '../watch-service'
import type { FolderLookup } from '../workspace-store'

export const FS_CHANNELS = {
  listDir: 'workspace:fs:listDir',
  readFile: 'workspace:fs:readFile',
  writeFile: 'workspace:fs:writeFile',
  createFile: 'workspace:fs:createFile',
  createDirectory: 'workspace:fs:createDirectory',
  deleteEntry: 'workspace:fs:deleteEntry',
  rename: 'workspace:fs:rename',
  watch: 'workspace:fs:watch',
  unwatch: 'workspace:fs:unwatch',
  /** 主行程 → renderer 的單向推送。Phase 1 的 IPC 全是 invoke／回應，這是第一個。 */
  watchEvent: 'workspace:fs:watchEvent',
} as const

/** 存檔的回應。`realPath` 已在此接縫上剝除 —— renderer 只認得 `(folderId, relPath)`。 */
export interface WriteResponse {
  mtimeMs: number
  size: number
}

export interface FsFailure {
  ok: false
  code: string
  message: string
  /** 例如 TOO_LARGE 的 `size` 與 `limit`。UI 要拿它組訊息，不該去解析 message。 */
  detail?: Record<string, number>
}

export type FsResult<T> = { ok: true; value: T } | FsFailure

/**
 * 失敗以結果物件跨越 IPC，不以拋出。
 *
 * Electron 把 handler 拋出的 Error 序列化給 renderer 時**只保留 message** —— `code` 與
 * `detail` 會在途中消失。而 UI 需要它們：「檔案過大（12.4 MB），上限 2 MiB」不能靠解析
 * 錯誤訊息的字串生出來，那是把一個型別問題偽裝成剖析問題。
 *
 * `fs-service` 內部仍然拋錯 —— 它是不跨行程的純邏輯，拋錯在那裡是對的。轉換只發生在
 * 這道接縫上，也就是序列化真正發生的地方。
 */
async function toResult<T>(run: () => Promise<T>): Promise<FsResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof FsServiceError) {
      return { ok: false, code: error.code, message: error.message, detail: error.detail }
    }
    if (error instanceof FsBoundaryError) {
      return { ok: false, code: error.code, message: error.message }
    }
    return { ok: false, code: 'UNKNOWN', message: String(error) }
  }
}

/** 每個 renderer 一份 watcher 集合。key 是 `webContents.id`。 */
const services = new Map<number, WatchService>()

function serviceFor(store: FolderLookup, contents: WebContents): WatchService {
  const existing = services.get(contents.id)
  if (existing) return existing

  const service = new WatchService(store, (batch: WatchBatch) => {
    if (contents.isDestroyed()) return
    contents.send(FS_CHANNELS.watchEvent, batch)
  })
  services.set(contents.id, service)

  contents.once('destroyed', () => {
    services.delete(contents.id)
    void service.dispose()
  })

  // 重新載入不會銷毀 webContents，因此 'destroyed' 不會觸發 —— 舊頁面的監看集合會留下來，
  // 而新頁面會重新訂閱它需要的目錄。反覆重新載入即持續累積 watcher 與 inotify watch。
  //
  // **必須用 'did-navigate'（已 commit），不能用 'did-start-navigation'。** 後者對一次
  // 「開始、但隨即被 will-navigate 擋掉」的導航同樣會觸發 —— 於是一個 markdown 裡的
  // `location.href = ...` 就能讓所有 watcher 靜默消失，檔案樹與檢視器從此不再更新
  //（已實測：導航前事件送達、導航後不再送達）。
  contents.on('did-navigate', () => {
    void service.unwatchAll()
  })

  return service
}

/** folder 自 workspace 移除時，所有 renderer 對它的監看都該一併釋放。 */
export function releaseFolderWatchers(folderId: string): void {
  for (const service of services.values()) {
    void service.releaseFolder(folderId)
  }
}

export function registerFsHandlers(store: FolderLookup): void {
  ipcMain.handle(FS_CHANNELS.listDir, (_event, folderId: string, relPath: string) =>
    toResult(() => listDir(store, folderId, relPath)),
  )

  ipcMain.handle(FS_CHANNELS.readFile, (_event, folderId: string, relPath: string) =>
    toResult(() => readFile(store, folderId, relPath)),
  )

  ipcMain.handle(
    FS_CHANNELS.writeFile,
    (event, folderId: string, relPath: string, text: string, baseMtimeMs?: number) =>
      toResult(async (): Promise<WriteResponse> => {
        const result = await writeFile(store, folderId, relPath, text, baseMtimeMs)

        // 我們自己剛寫的那則 change 事件不該回頭警告使用者「檔案已在磁碟上變更」。
        // realPath 的用途到此為止 —— 它不隨回應跨過 IPC。
        serviceFor(store, event.sender).noteSelfWrite(result.realPath, result.mtimeMs)

        return { mtimeMs: result.mtimeMs, size: result.size }
      }),
  )

  ipcMain.handle(FS_CHANNELS.createFile, (_event, folderId: string, relPath: string) =>
    toResult(() => createFile(store, folderId, relPath)),
  )

  ipcMain.handle(FS_CHANNELS.createDirectory, (_event, folderId: string, relPath: string) =>
    toResult(() => createDirectory(store, folderId, relPath)),
  )

  ipcMain.handle(FS_CHANNELS.deleteEntry, (_event, folderId: string, relPath: string) =>
    toResult(() => deleteEntry(store, folderId, relPath)),
  )

  ipcMain.handle(
    FS_CHANNELS.rename,
    (_event, folderId: string, fromRelPath: string, toRelPath: string) =>
      toResult(() => rename(store, folderId, fromRelPath, toRelPath)),
  )

  ipcMain.handle(FS_CHANNELS.watch, (event, folderId: string, relPath: string) =>
    toResult(() => serviceFor(store, event.sender).watch(folderId, relPath)),
  )

  ipcMain.handle(FS_CHANNELS.unwatch, (event, folderId: string, relPath: string) =>
    toResult(async () => {
      serviceFor(store, event.sender).unwatch(folderId, relPath)
    }),
  )
}
