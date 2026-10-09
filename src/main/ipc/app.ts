import { ipcMain } from 'electron'
import type { DirtyEntry, DirtyStateStore } from '../dirty-state'

export const APP_CHANNELS = {
  /** renderer → 主行程：dirty 集合的快照。每次變動就推一次。 */
  setDirtyState: 'workspace:app:setDirtyState',
  /** 主行程 → renderer：使用者於關閉對話框選了「儲存全部」。 */
  saveAllRequest: 'workspace:app:saveAllRequest',
  /** renderer → 主行程：儲存全部的結果。 */
  saveAllResult: 'workspace:app:saveAllResult',
  /**
   * renderer → main: the listeners that outside actions talk to (the inbox, handoff briefs, focusing a
   * session) are mounted. A notification click that had to open a window waits for this (`window-presence`).
   */
  rendererReady: 'workspace:app:rendererReady',
} as const

export function registerAppHandlers(dirty: DirtyStateStore, onRendererReady: (contentsId: number) => void): void {
  ipcMain.on(APP_CHANNELS.setDirtyState, (event, entries: DirtyEntry[]) => {
    dirty.set(event.sender.id, entries)
  })
  ipcMain.on(APP_CHANNELS.rendererReady, (event) => {
    onRendererReady(event.sender.id)
  })
}
