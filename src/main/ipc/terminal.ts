import { type WebContents, ipcMain } from 'electron'
import { type SpawnTarget, TerminalError, TerminalService } from '../terminal'
import type { FolderLookup } from '../workspace-store'
import type { FsResult } from './fs'

export const TERMINAL_CHANNELS = {
  create: 'workspace:terminal:create',
  write: 'workspace:terminal:write',
  resize: 'workspace:terminal:resize',
  kill: 'workspace:terminal:kill',
  /** 主行程 → renderer 的單向推送。與 fs 的 watchEvent 同類。 */
  data: 'workspace:terminal:data',
  exit: 'workspace:terminal:exit',
} as const

/**
 * 失敗以結果物件跨越 IPC，不以拋出 —— Electron 序列化 Error 只保留 message，`code` 會遺失
 * （與 `ipc/fs.ts` 的 `toResult` 同源；那一份是該模組私有的）。
 */
async function toResult<T>(run: () => T | Promise<T>): Promise<FsResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof TerminalError) {
      return { ok: false, code: error.code, message: error.message }
    }
    return { ok: false, code: 'UNKNOWN', message: String(error) }
  }
}

/** 每個 renderer 一份 pty 集合。key 是 `webContents.id`（與 watcher 的擁有者記帳同構）。 */
const services = new Map<number, TerminalService>()

function serviceFor(store: FolderLookup, contents: WebContents): TerminalService {
  const existing = services.get(contents.id)
  if (existing) return existing

  const service = new TerminalService(store, {
    data: (sessionId, chunk) => {
      if (contents.isDestroyed()) return
      contents.send(TERMINAL_CHANNELS.data, sessionId, chunk)
    },
    exit: (sessionId, exitCode) => {
      if (contents.isDestroyed()) return
      contents.send(TERMINAL_CHANNELS.exit, sessionId, exitCode)
    },
  })
  services.set(contents.id, service)

  contents.once('destroyed', () => {
    services.delete(contents.id)
    service.dispose()
  })

  // 重新載入不會銷毀 webContents，因此 'destroyed' 不會觸發 —— 舊 pty 會變成孤兒行程，
  // 且新頁面的 xterm 永遠收不到它們的輸出（listener 綁在已消失的舊 renderer 上）。必須在
  // 'did-navigate' 殺光（design D2）。沿用 watcher 的教訓：用 'did-navigate'（已 commit），
  // 不是 'did-start-navigation'（那對被擋下的導航也會觸發）。
  contents.on('did-navigate', () => {
    service.dispose()
  })

  return service
}

export function registerTerminalHandlers(store: FolderLookup): void {
  ipcMain.handle(TERMINAL_CHANNELS.create, (event, folderId: string, target: SpawnTarget) =>
    toResult(() => ({ sessionId: serviceFor(store, event.sender).create(folderId, target) })),
  )

  // write／resize／kill 是單向 fire-and-forget（design D4）：逐鍵輸入若每次都等一次
  // round-trip 的回應是浪費。
  ipcMain.on(TERMINAL_CHANNELS.write, (event, sessionId: string, data: string) => {
    serviceFor(store, event.sender).write(sessionId, data)
  })

  ipcMain.on(TERMINAL_CHANNELS.resize, (event, sessionId: string, cols: number, rows: number) => {
    serviceFor(store, event.sender).resize(sessionId, cols, rows)
  })

  ipcMain.on(TERMINAL_CHANNELS.kill, (event, sessionId: string) => {
    serviceFor(store, event.sender).kill(sessionId)
  })
}
