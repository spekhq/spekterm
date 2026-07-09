import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'

const currentDir = dirname(fileURLToPath(import.meta.url))

/**
 * PRD §12 的信任模型。明確寫出而非依賴 Electron 預設值 —— 預設值會隨版本改變，
 * 而 spec 要求「檢查建立視窗時傳入的 webPreferences」時能讀到這兩個值。
 */
const trustModel = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
} as const

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0c0f',
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      ...trustModel,
    },
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'))
  }

  return window
}

function registerIpcHandlers(): void {
  // Phase 0 只需要一個最小的具名 API，用來證明 preload 白名單這條路是通的。
  ipcMain.handle('workspace:ping', () => 'pong')
}

void app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
