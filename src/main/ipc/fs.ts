import { ipcMain } from 'electron'
import { listDir } from '../fs-service'
import type { FolderLookup } from '../workspace-store'

export const FS_CHANNELS = {
  listDir: 'workspace:fs:listDir',
} as const

export function registerFsHandlers(store: FolderLookup): void {
  ipcMain.handle(FS_CHANNELS.listDir, (_event, folderId: string, relPath: string) =>
    listDir(store, folderId, relPath),
  )
}
