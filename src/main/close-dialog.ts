import { type BrowserWindow, dialog, ipcMain } from 'electron'
import type { AskClose } from './close-guard'
import { APP_CHANNELS } from './ipc/app'

/** The Save All round trip's limit. A renderer that does not answer leads back to the dialog. */
const SAVE_ALL_TIMEOUT_MS = 10_000

/**
 * Ask the renderer to save every unsaved change and wait for its report.
 *
 * A timeout counts as failure — the guard then asks again, so the user can choose to close without
 * saving or to cancel. Closing silently is not an option.
 */
export function requestSaveAll(window: BrowserWindow): Promise<boolean> {
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
 * The prompt as a **native** dialog, not a renderer modal: it lists paths from the user's repos and
 * sessions while the renderer is about to close, and a native dialog does not depend on the page's
 * state (design D15 of `file-editing-and-crud`).
 *
 * Roles map to button positions here and nowhere else, so the default and cancel answers are named,
 * not counted.
 */
export function nativeCloseDialog(window: BrowserWindow): AskClose {
  return async (prompt) => {
    const index = (role: string): number => prompt.buttons.findIndex((button) => button.role === role)
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: prompt.buttons.map((button) => button.label),
      defaultId: index(prompt.defaultRole),
      cancelId: index(prompt.cancelRole),
      noLink: true,
      message: prompt.message,
      detail: prompt.detail,
    })
    return prompt.buttons[response]?.role ?? prompt.cancelRole
  }
}
