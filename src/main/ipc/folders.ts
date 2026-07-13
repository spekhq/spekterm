import { BrowserWindow, type WebContents, dialog, ipcMain } from 'electron'
import { BranchService } from '../branch-service'
import type { WorkspaceFolder, WorkspaceStore } from '../workspace-store'
import { releaseFolderWatchers } from './fs'
import { releaseFolderOpenSpec } from './openspec'

export const FOLDER_CHANNELS = {
  list: 'workspace:folders:list',
  add: 'workspace:folders:add',
  remove: 'workspace:folders:remove',
  /** 主行程 → renderer。目前唯一的推送來源是 git 分支變動（使用者在 terminal 裡切 branch）。 */
  changed: 'workspace:folders:changed',
} as const

/**
 * 每個 renderer 一組分支 watcher。
 *
 * **必須在 `did-navigate` 銷毀，不能只靠 `destroyed`** —— 重新載入不會銷毀 `webContents`，
 * 於是舊頁面的 watcher 會留下來，而它推送的事件已經沒有接收者了（Phase 2 在 fs watcher 上
 * 實測過這個 bug，Phase 4 又在 pty 上踩了一次）。
 */
const branchServices = new Map<number, BranchService>()

function branchServiceFor(store: WorkspaceStore, sender: WebContents): BranchService {
  const existing = branchServices.get(sender.id)
  if (existing) return existing

  const service = new BranchService(store, () => {
    if (!sender.isDestroyed()) sender.send(FOLDER_CHANNELS.changed, store.list())
  })
  branchServices.set(sender.id, service)

  const release = (): void => {
    branchServices.delete(sender.id)
    void service.dispose()
  }
  sender.on('did-navigate', release)
  sender.once('destroyed', release)

  service.sync()
  return service
}

/**
 * 對話框只負責取得一個路徑，其餘全部交給 store —— renderer 與 UI 都不直接碰檔案系統。
 * 這道接縫也讓 store 的行為（realpath 去重、持久化、損毀降級）能以單元測試涵蓋，
 * 而原生對話框本身無法自動化驅動。
 */
async function pickDirectory(): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = parent
    ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory'] })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export function registerFolderHandlers(store: WorkspaceStore): void {
  ipcMain.handle(FOLDER_CHANNELS.list, (event): WorkspaceFolder[] => {
    // 第一次列清單時順帶掛上分支 watcher —— renderer 不必為此多發一個請求，也就不需要一個
    // 「開始監看分支」的 API（分支不是 renderer 要求來的能力，它是 folder 狀態的一部分）。
    branchServiceFor(store, event.sender).sync()
    return store.list()
  })

  ipcMain.handle(FOLDER_CHANNELS.add, async (event): Promise<WorkspaceFolder[]> => {
    const picked = await pickDirectory()
    if (picked) store.add(picked)
    branchServiceFor(store, event.sender).sync()
    return store.list()
  })

  ipcMain.handle(FOLDER_CHANNELS.remove, (event, id: string): WorkspaceFolder[] => {
    // 先釋放 watcher 再改動 store —— 反過來的話，watcher 服務已經查不到這個 folder 了
    releaseFolderWatchers(id)
    releaseFolderOpenSpec(id)
    store.remove(id)
    branchServiceFor(store, event.sender).sync()
    return store.list()
  })
}
