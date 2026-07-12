import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, session } from 'electron'
import { applyContentSecurityPolicy } from './content-security-policy'
import { DirtyStateStore } from './dirty-state'
import { registerAppHandlers } from './ipc/app'
import { registerClipboardHandlers } from './ipc/clipboard'
import { registerFsHandlers } from './ipc/fs'
import { registerFolderHandlers } from './ipc/folders'
import { registerOpenSpecHandlers } from './ipc/openspec'
import { registerShellHandlers } from './ipc/shell'
import { registerTerminalHandlers } from './ipc/terminal'
import { applyNavigationGuards } from './navigation'
import { formatScanSummary, scanRepo } from './openspec'
import { guardUnsavedChanges } from './unsaved-changes'
import { WorkspaceStore } from './workspace-store'

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

function createWindow(dirty: DirtyStateStore): BrowserWindow {
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

  // 在載入任何內容之前掛上。renderer 從第一幀起就會渲染使用者 repo 裡的不受信任內容。
  applyNavigationGuards(window.webContents)
  guardUnsavedChanges(window, dirty)

  const contentsId = window.webContents.id
  // 重新載入不會銷毀 webContents，但新頁面沒有任何未存的變更 —— 舊快照必須作廢，
  // 否則關閉時會對著一份不存在的 dirty 集合發問（與 watcher 的釋放同源）。
  window.webContents.on('did-navigate', () => dirty.release(contentsId))
  window.webContents.once('destroyed', () => dirty.release(contentsId))

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

/**
 * 開發模式的掃描目標。預設掃描 repo 自身 —— 它就是一個含 `openspec/` 的 repo。
 * `SPEKTERM_SCAN_PATH` 可指向任意 repo，供實測其他專案。
 */
function resolveScanTarget(): string {
  return process.env.SPEKTERM_SCAN_PATH ?? app.getAppPath()
}

/**
 * 開發模式下輸出掃描摘要，作為 core 整合的可見驗收依據。
 *
 * 掃描不到 `openspec/` 時 core 回傳空結構而非拋錯，因此路徑給錯只會印出一行零，
 * 不該讓工作台開不起來 —— 這裡的 catch 是為了真正的例外（如權限不足）。
 */
async function logScanSummary(): Promise<void> {
  const target = resolveScanTarget()
  try {
    console.log(formatScanSummary(await scanRepo(target)))
  } catch (error) {
    console.error(`[openspec] scan failed ${target}: ${String(error)}`)
  }
}

void app.whenReady().then(() => {
  // workspace 設定隨使用者資料目錄走，因此 `--user-data-dir` 可指向暫存 profile，
  // 讓驗收得以反覆重啟應用程式而不污染真實設定。
  const store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'))
  store.load()

  const dirty = new DirtyStateStore()

  // 在建立視窗、載入任何 renderer 內容之前施加 CSP —— renderer 從第一幀起就會渲染使用者
  // repo 裡的不受信任內容（與 applyNavigationGuards 同屬信任模型的前置防護）。
  // dev／production 政策的切換依「是否載入 Vite dev server」（ELECTRON_RENDERER_URL），**不是**
  // app.isPackaged —— 未打包但載入 file:// build 產物（如 probe 的建置模式）應拿 production 政策，
  // 否則 production 政策永遠不會被任何 probe 覆蓋（見 content-security-policy.ts）。
  applyContentSecurityPolicy(session.defaultSession, Boolean(process.env.ELECTRON_RENDERER_URL))

  registerFolderHandlers(store)
  registerFsHandlers(store)
  registerOpenSpecHandlers(store)
  registerShellHandlers()
  registerAppHandlers(dirty)
  registerTerminalHandlers(store)
  registerClipboardHandlers()

  createWindow(dirty)

  // 未打包的執行一律視為開發模式（`electron-vite dev` 與直接 `electron .` 皆涵蓋）。
  if (!app.isPackaged) {
    void logScanSummary()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(dirty)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
