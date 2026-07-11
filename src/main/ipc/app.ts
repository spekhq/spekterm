import { ipcMain } from 'electron'
import type { DirtyEntry, DirtyStateStore } from '../dirty-state'

export const APP_CHANNELS = {
  /** renderer → 主行程：dirty 集合的快照。每次變動就推一次。 */
  setDirtyState: 'workspace:app:setDirtyState',
  /** 主行程 → renderer：使用者於關閉對話框選了「儲存全部」。 */
  saveAllRequest: 'workspace:app:saveAllRequest',
  /** renderer → 主行程：儲存全部的結果。 */
  saveAllResult: 'workspace:app:saveAllResult',
} as const

export function registerAppHandlers(dirty: DirtyStateStore): void {
  ipcMain.on(APP_CHANNELS.setDirtyState, (event, entries: DirtyEntry[]) => {
    dirty.set(event.sender.id, entries)
  })
}
