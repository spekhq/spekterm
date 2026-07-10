import { ipcMain } from 'electron'
import { openExternalUrl } from '../navigation'

export const SHELL_CHANNELS = {
  openExternal: 'workspace:shell:openExternal',
} as const

/**
 * renderer 唯一被允許「離開 app」的方式。協定的驗證在 `openExternalUrl` 內、
 * 也就是在主行程 —— renderer 端 markdown 渲染器的過濾不構成防護。
 */
export function registerShellHandlers(): void {
  ipcMain.handle(SHELL_CHANNELS.openExternal, (_event, url: string) => openExternalUrl(url))
}
