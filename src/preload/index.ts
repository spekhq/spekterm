import { contextBridge, ipcRenderer } from 'electron'

/**
 * 主行程能力一律以具名白名單暴露（PRD §12）。
 * 不要把 ipcRenderer 整個交給 renderer —— 那等於繞過白名單。
 */
const workspaceApi = {
  ping: (): Promise<string> => ipcRenderer.invoke('workspace:ping'),
} as const

export type WorkspaceApi = typeof workspaceApi

if (!process.contextIsolated) {
  throw new Error('contextIsolation 必須啟用，否則 preload 白名單形同虛設')
}

contextBridge.exposeInMainWorld('workspace', workspaceApi)
