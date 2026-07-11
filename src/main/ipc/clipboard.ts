import { clipboard, ipcMain } from 'electron'

export const CLIPBOARD_CHANNELS = {
  readText: 'workspace:clipboard:readText',
  writeText: 'workspace:clipboard:writeText',
} as const

/**
 * 系統剪貼簿的文字讀寫。終端的複製貼上沒有它就不成立。
 *
 * **不走 renderer 的 `navigator.clipboard`**：它的 `readText()` 在 Electron 中受 Chromium
 * 的權限模型管轄（`clipboard-read`），沒有 permission handler 時行為並不保證，且跨平台不
 * 一致。主行程的 `clipboard` module 沒有這個問題（design D1）。
 *
 * **這道能力沒有 workspace 邊界可言** —— 剪貼簿裡可能是使用者剛複製的密碼。它之所以可
 * 接受，靠的是另外兩道前提（design D2）：
 *
 * 1. renderer 不會變成別人的頁面 —— `applyNavigationGuards` 是這道能力的**前提**，不是加分項。
 * 2. renderer 只在使用者明確要求貼上時才讀取（右鍵選單／快捷鍵／中鍵），不主動讀、不輪詢。
 *
 * 只處理文字。圖片與檔案格式不在此暴露。
 */
export function registerClipboardHandlers(): void {
  ipcMain.handle(CLIPBOARD_CHANNELS.readText, () => clipboard.readText())

  ipcMain.on(CLIPBOARD_CHANNELS.writeText, (_event, text: string) => {
    clipboard.writeText(text)
  })
}
