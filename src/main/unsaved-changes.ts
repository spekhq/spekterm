import { type BrowserWindow, dialog, ipcMain } from 'electron'
import type { DirtyEntry, DirtyStateStore } from './dirty-state'
import { APP_CHANNELS } from './ipc/app'

/** 「儲存全部」的往返上限。renderer 沒回應時退回對話框，而不是默默關閉。 */
const SAVE_ALL_TIMEOUT_MS = 10_000

/** 對話框中最多列出幾個檔案。再多就只給數字 —— 一個捲不動的清單幫不上決定。 */
const MAX_LISTED = 10

/** 物件常數而非 `const enum` —— 後者在 `isolatedModules` 下無法被逐檔轉譯。 */
const Choice = { SaveAll: 0, Discard: 1, Cancel: 2 } as const

function describe(entries: DirtyEntry[]): string {
  const listed = entries
    .slice(0, MAX_LISTED)
    .map((entry) => `${entry.folderName}/${entry.relPath}`)
    .join('\n')

  const remaining = entries.length - MAX_LISTED
  return remaining > 0 ? `${listed}\n…以及另外 ${remaining} 個檔案` : listed
}

/**
 * 請 renderer 存下所有未存的變更，並等它回報。
 *
 * 逾時視為失敗 —— 呼叫端會退回對話框，讓使用者改選「不儲存並關閉」或「取消」。
 * 靜默關閉不是選項。
 */
function requestSaveAll(window: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const contentsId = window.webContents.id

    const finish = (ok: boolean): void => {
      clearTimeout(timer)
      ipcMain.off(APP_CHANNELS.saveAllResult, onResult)
      resolve(ok)
    }

    const onResult = (event: Electron.IpcMainEvent, ok: boolean): void => {
      if (event.sender.id !== contentsId) return
      finish(ok)
    }

    const timer = setTimeout(() => finish(false), SAVE_ALL_TIMEOUT_MS)
    ipcMain.on(APP_CHANNELS.saveAllResult, onResult)
    window.webContents.send(APP_CHANNELS.saveAllRequest)
  })
}

/**
 * 以**原生**對話框詢問如何處置未存的變更，回傳是否可以關閉。
 *
 * 用原生而非 renderer 的 modal：此刻要呈現的是使用者 repo 裡的檔案路徑，而 renderer
 * 正處在「即將關閉」的狀態。原生對話框不受頁面狀態影響（design D15）。
 */
export async function confirmDiscardOrSave(
  window: BrowserWindow,
  dirty: DirtyStateStore,
): Promise<boolean> {
  const entries = dirty.list(window.webContents.id)
  if (entries.length === 0) return true

  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: ['儲存全部', '不儲存並關閉', '取消'],
    defaultId: Choice.SaveAll,
    cancelId: Choice.Cancel,
    noLink: true,
    message: `有 ${entries.length} 個檔案尚未儲存`,
    detail: describe(entries),
  })

  if (response === Choice.Cancel) return false
  if (response === Choice.Discard) return true

  if (await requestSaveAll(window)) return true

  // 存檔失敗或逾時（例如遇上衝突）。再問一次，而不是替使用者決定丟棄。
  return confirmDiscardOrSave(window, dirty)
}

/**
 * 掛上關閉前的未存變更確認。
 *
 * `close` 的 handler 必須**同步**決定是否 `preventDefault()`，因此它只能讀取一份
 * renderer 事先推送的快照 —— 這正是 `DirtyStateStore` 存在的理由。
 */
export function guardUnsavedChanges(window: BrowserWindow, dirty: DirtyStateStore): void {
  let allowClose = false

  window.on('close', (event) => {
    if (allowClose) return
    if (dirty.list(window.webContents.id).length === 0) return

    event.preventDefault()
    void confirmDiscardOrSave(window, dirty).then((shouldClose) => {
      if (!shouldClose) return
      allowClose = true
      window.close()
    })
  })
}
