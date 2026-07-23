import type { GraphData } from '@spekjs/core'
import { type WebContents, ipcMain } from 'electron'
import {
  type ChangeDetailView,
  type ChangesData,
  type OverviewData,
  OpenSpecService,
  OpenSpecServiceError,
  type SpecDetailView,
  type SpecSummary,
  type SpecVersionView,
} from '../openspec-service'
import type { FolderLookup } from '../workspace-store'
import type { FsResult } from './fs'

export const OPENSPEC_CHANNELS = {
  getOverview: 'workspace:openspec:getOverview',
  getSpecs: 'workspace:openspec:getSpecs',
  getSpec: 'workspace:openspec:getSpec',
  getSpecAtChange: 'workspace:openspec:getSpecAtChange',
  getChanges: 'workspace:openspec:getChanges',
  getChange: 'workspace:openspec:getChange',
  getGraphData: 'workspace:openspec:getGraphData',
  getWorktreeRoots: 'workspace:openspec:getWorktreeRoots',
  /** 主行程 → renderer：該 folder 的 OpenSpec 結構已變更（帶 folderId）。 */
  changed: 'workspace:openspec:changed',
} as const

/**
 * 失敗以結果物件跨越 IPC，不以拋出 —— 與 `fs.*` 同一條理由：Electron 序列化 Error 時
 * **只保留 message**，`code` 會在途中消失，而 renderer 需要它來區分「這個 folder 沒有
 * openspec」與「這個 slug 不存在」。
 *
 * `OpenSpecService` 內部仍然拋錯：它是不跨行程的純邏輯。轉換只發生在這道接縫上。
 */
async function toResult<T>(run: () => Promise<T>): Promise<FsResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof OpenSpecServiceError) {
      return { ok: false, code: error.code, message: error.message }
    }
    return { ok: false, code: 'UNKNOWN', message: String(error) }
  }
}

/** 每個 renderer 一份。key 是 `webContents.id`。 */
const services = new Map<number, OpenSpecService>()

function serviceFor(store: FolderLookup, contents: WebContents): OpenSpecService {
  const existing = services.get(contents.id)
  if (existing) return existing

  const service = new OpenSpecService(store, (folderId: string) => {
    if (contents.isDestroyed()) return
    contents.send(OPENSPEC_CHANNELS.changed, folderId)
  })
  services.set(contents.id, service)

  contents.once('destroyed', () => {
    services.delete(contents.id)
    void service.dispose()
  })

  // 重新載入不會銷毀 webContents，因此 'destroyed' 不會觸發 —— 舊頁面的 watcher 會留下來，
  // 而它推送的事件已經沒有接收者了。**必須是 'did-navigate'，不是 'did-start-navigation'**：
  // 後者對一次「開始、但隨即被 will-navigate 擋掉」的導航同樣會觸發，於是一個 markdown 裡的
  // 連結就能讓側欄從此不再更新（Phase 2 在 fs watcher 上實測過這個 bug）。
  contents.on('did-navigate', () => {
    void service.dispose()
  })

  return service
}

/** folder 自 workspace 移除時，所有 renderer 對它的監看與快取都該一併釋放。 */
export function releaseFolderOpenSpec(folderId: string): void {
  for (const service of services.values()) {
    void service.releaseFolder(folderId)
  }
}

export function registerOpenSpecHandlers(store: FolderLookup): void {
  ipcMain.handle(
    OPENSPEC_CHANNELS.getOverview,
    (event, folderId: string): Promise<FsResult<OverviewData>> =>
      toResult(() => serviceFor(store, event.sender).getOverview(folderId)),
  )

  ipcMain.handle(
    OPENSPEC_CHANNELS.getSpecs,
    (event, folderId: string): Promise<FsResult<SpecSummary[]>> =>
      toResult(() => serviceFor(store, event.sender).getSpecs(folderId)),
  )

  ipcMain.handle(
    OPENSPEC_CHANNELS.getSpec,
    (event, folderId: string, topic: string): Promise<FsResult<SpecDetailView>> =>
      toResult(() => serviceFor(store, event.sender).getSpec(folderId, topic)),
  )

  ipcMain.handle(
    OPENSPEC_CHANNELS.getSpecAtChange,
    (
      event,
      folderId: string,
      topic: string,
      slug: string,
    ): Promise<FsResult<SpecVersionView>> =>
      toResult(() => serviceFor(store, event.sender).getSpecAtChange(folderId, topic, slug)),
  )

  ipcMain.handle(
    OPENSPEC_CHANNELS.getChanges,
    (event, folderId: string): Promise<FsResult<ChangesData>> =>
      toResult(() => serviceFor(store, event.sender).getChanges(folderId)),
  )

  ipcMain.handle(
    OPENSPEC_CHANNELS.getChange,
    (event, folderId: string, slug: string): Promise<FsResult<ChangeDetailView>> =>
      toResult(() => serviceFor(store, event.sender).getChange(folderId, slug)),
  )

  ipcMain.handle(
    OPENSPEC_CHANNELS.getGraphData,
    (event, folderId: string): Promise<FsResult<GraphData>> =>
      toResult(() => serviceFor(store, event.sender).getGraphData(folderId)),
  )

  ipcMain.handle(
    OPENSPEC_CHANNELS.getWorktreeRoots,
    (event, folderId: string): Promise<FsResult<string[]>> =>
      toResult(() => serviceFor(store, event.sender).getWorktreeRoots(folderId)),
  )
}
