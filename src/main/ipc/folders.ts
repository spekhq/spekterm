import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { WorkspaceFolder, WorkspaceStore } from '../workspace-store'
import { releaseFolderWatchers } from './fs'
import { releaseFolderOpenSpec } from './openspec'

export const FOLDER_CHANNELS = {
  list: 'workspace:folders:list',
  add: 'workspace:folders:add',
  remove: 'workspace:folders:remove',
} as const

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
  ipcMain.handle(FOLDER_CHANNELS.list, (): WorkspaceFolder[] => store.list())

  ipcMain.handle(FOLDER_CHANNELS.add, async (): Promise<WorkspaceFolder[]> => {
    const picked = await pickDirectory()
    if (picked) store.add(picked)
    return store.list()
  })

  ipcMain.handle(FOLDER_CHANNELS.remove, (_event, id: string): WorkspaceFolder[] => {
    // 先釋放 watcher 再改動 store —— 反過來的話，watcher 服務已經查不到這個 folder 了
    releaseFolderWatchers(id)
    releaseFolderOpenSpec(id)
    store.remove(id)
    return store.list()
  })
}
