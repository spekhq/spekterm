import { type WebContents, ipcMain } from 'electron'
import type { RendererSession, SessionStore } from '../session-store'
import { type SpawnTarget, TerminalError, TerminalService } from '../terminal'
import type { FolderLookup } from '../workspace-store'
import type { FsResult } from './fs'

export const TERMINAL_CHANNELS = {
  create: 'workspace:terminal:create',
  /** 喚醒一個休眠的（已重建但還沒有 pty 的）session。 */
  wake: 'workspace:terminal:wake',
  write: 'workspace:terminal:write',
  resize: 'workspace:terminal:resize',
  kill: 'workspace:terminal:kill',
  /** renderer 啟動時取回要重建的 session（含各自的終端畫面快照）。 */
  restore: 'workspace:terminal:restore',
  /** renderer 推送 session 清單（**不含任何路徑、不含對話識別碼**）。 */
  persist: 'workspace:terminal:persist',
  /** renderer 推送終端畫面快照。 */
  snapshot: 'workspace:terminal:snapshot',
  /** 主行程 → renderer 的單向推送。與 fs 的 watchEvent 同類。 */
  data: 'workspace:terminal:data',
  exit: 'workspace:terminal:exit',
} as const

/** 重建一個 session 所需的一切。`scrollback` 只有 shell 目標會有（design D3）。 */
export interface RestoredSession extends RendererSession {
  scrollback?: string
}

/**
 * metadata 的落盤 debounce。`title` 會隨 claude 的任務進展**持續**變動 —— 每次都同步寫一次檔
 * 是浪費。快照走自己的檔案，不受這個節流影響。
 */
const PERSIST_DEBOUNCE_MS = 500

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

function serviceFor(
  store: FolderLookup,
  sessions: SessionStore,
  contents: WebContents,
): TerminalService {
  const existing = services.get(contents.id)
  if (existing) return existing

  const service = new TerminalService(store, {
    data: (sessionId, chunk) => {
      if (contents.isDestroyed()) return
      contents.send(TERMINAL_CHANNELS.data, sessionId, chunk)
    },
    exit: (sessionId, exitCode, reason) => {
      // **`disposed` 是關視窗／reload 時我們自己殺的 —— 那不是 session 結束。**
      //
      // 少了這道分支，關一次視窗就會把整份持久化清空（每個 pty 都會 exit，每個 exit 都被當成
      // 「這個 session 死了，別再留著它」）—— 也就是這個 change 要修的那個 bug 本人，換了個寫法。
      //
      // 也不可把它推給 renderer：reload 後的新頁面**已經用同樣的 id 重建了這些 session**（休眠），
      // 一則遲到的 exit 會把剛重建好的分頁標成已結束。
      if (reason === 'disposed') return

      // 真的結束了（pty 自己死掉、或使用者關掉）—— 立刻把它連同快照從磁碟上抹掉。不能等 renderer
      // 的下一次 persist：若使用者就在此時關掉 app，那筆已死的 session 會被當成休眠的重建回來。
      sessions.remove(sessionId)
      if (contents.isDestroyed()) return
      contents.send(TERMINAL_CHANNELS.exit, sessionId, exitCode)
    },
    // 對話識別碼是**主行程的知識**（renderer 沒有這個詞彙），因此直接落盤，不經 renderer 轉手。
    conversation: (sessionId, conversationId) => {
      sessions.update(sessionId, { claudeSessionId: conversationId })
    },
  })
  services.set(contents.id, service)

  contents.once('destroyed', () => {
    services.delete(contents.id)
    flush(service, sessions)
    service.dispose()
  })

  // 重新載入不會銷毀 webContents，因此 'destroyed' 不會觸發 —— 舊 pty 會變成孤兒行程，
  // 且新頁面的 xterm 永遠收不到它們的輸出（listener 綁在已消失的舊 renderer 上）。必須在
  // 'did-navigate' 殺光（design D2）。沿用 watcher 的教訓：用 'did-navigate'（已 commit），
  // 不是 'did-start-navigation'（那對被擋下的導航也會觸發）。
  contents.on('did-navigate', () => {
    flush(service, sessions)
    service.dispose()
  })

  return service
}

/** 待落盤的 metadata（每個 renderer 一份）。 */
const pending = new Map<number, { timer: NodeJS.Timeout; incoming: RendererSession[] }>()

/**
 * 每個 shell session 的最後 cwd。**由主行程自己讀 `/proc`**，renderer 從未經手 —— 它連
 * 「工作目錄」這個詞彙都沒有（session-persistence 的「持久化不得把路徑詞彙交給 renderer」）。
 */
function refreshCwd(service: TerminalService, sessions: SessionStore): void {
  for (const session of sessions.list()) {
    if (session.spawnTarget !== 'shell') continue
    const cwd = service.cwdOf(session.id)
    if (cwd) sessions.update(session.id, { cwd })
  }
}

/** 把待落盤的東西立刻寫下去。關視窗與 reload 都必須先走這裡，否則最後一次改動就飛了。 */
function flush(service: TerminalService, sessions: SessionStore): void {
  for (const [contentsId, entry] of pending) {
    clearTimeout(entry.timer)
    sessions.replace(entry.incoming)
    pending.delete(contentsId)
  }
  refreshCwd(service, sessions)
}

export function registerTerminalHandlers(store: FolderLookup, sessions: SessionStore): void {
  ipcMain.handle(TERMINAL_CHANNELS.create, (event, folderId: string, target: SpawnTarget) =>
    toResult(() => {
      const result = serviceFor(store, sessions, event.sender).create(folderId, target)

      // **對話識別碼必須在這裡就落下去。** 它是主行程在 `create` 回傳當下就知道的東西，而 renderer
      // 永遠不會看到它 —— 漏掉這一行，claude session 的對話 id 就從來沒有被持久化過，於是每次
      // 重建都以「沒有東西可以續接」開一個全新的對話。**症狀是靜默的**：分頁、名字、順序全都好好地
      // 回來了，只有對話內容永遠是空的（探針抓到：重建時的 argv 是 `--session-id <新 id>`，
      // 而不是 `--resume <原 id>`）。
      if (result.conversationId) {
        sessions.update(result.sessionId, { claudeSessionId: result.conversationId })
      }
      return { sessionId: result.sessionId }
    }),
  )

  // 喚醒＝以持久化的續接資訊重新 spawn，**沿用同一個 sessionId**（分頁、名字、順序、錨定都掛在
  // 它身上，不能因為重建而改變）。renderer 只給 sessionId —— 對話識別碼與 cwd 都在主行程手上。
  ipcMain.handle(TERMINAL_CHANNELS.wake, (event, sessionId: string) =>
    toResult(() => {
      const persisted = sessions.get(sessionId)
      if (!persisted) throw new TerminalError('UNKNOWN_FOLDER', `unknown session: ${sessionId}`)

      const service = serviceFor(store, sessions, event.sender)
      const result = service.create(persisted.folderId, persisted.spawnTarget, {
        sessionId: persisted.id,
        resumeConversationId: persisted.claudeSessionId,
        cwd: persisted.cwd,
      })
      if (result.conversationId) {
        sessions.update(sessionId, { claudeSessionId: result.conversationId })
      }
      return { sessionId: result.sessionId }
    }),
  )

  ipcMain.handle(TERMINAL_CHANNELS.restore, (event): RestoredSession[] => {
    // folder 已被移出 workspace → 它的 session 不再有歸屬，從持久化移除（design D11）。
    const known = new Set(store.list().map((folder) => folder.id))
    for (const session of sessions.list()) {
      if (!known.has(session.folderId)) sessions.remove(session.id)
    }

    // 建立 service（若尚未存在）—— 於是 did-navigate／destroyed 的清理鉤子在第一次重建時就掛上。
    serviceFor(store, sessions, event.sender)

    return sessions.list().map(({ claudeSessionId: _c, cwd: _w, ...rest }) => ({
      ...rest,
      // claude 續接時會自行重現先前的對話 —— 再重播一次快照，使用者會看到兩份歷史（design D3）。
      scrollback:
        rest.spawnTarget === 'shell' ? (sessions.readScrollback(rest.id) ?? undefined) : undefined,
    }))
  })

  ipcMain.on(TERMINAL_CHANNELS.persist, (event, incoming: RendererSession[]) => {
    if (!Array.isArray(incoming)) return
    const service = serviceFor(store, sessions, event.sender)
    const contentsId = event.sender.id

    const existing = pending.get(contentsId)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      pending.delete(contentsId)
      sessions.replace(incoming)
      refreshCwd(service, sessions)
    }, PERSIST_DEBOUNCE_MS)
    pending.set(contentsId, { timer, incoming })
  })

  ipcMain.on(TERMINAL_CHANNELS.snapshot, (event, sessionId: string, data: string) => {
    if (typeof sessionId !== 'string' || typeof data !== 'string') return
    sessions.writeScrollback(sessionId, data)

    // 快照大約每兩秒來一次（session 有輸出時）—— 順道把 cwd 一起刷新，於是「使用者 cd 過去、
    // 然後 app 被強制結束」也留得住最後的位置，不必倚賴關窗時的收尾。
    const service = serviceFor(store, sessions, event.sender)
    const cwd = service.cwdOf(sessionId)
    if (cwd) sessions.update(sessionId, { cwd })
  })

  // write／resize／kill 是單向 fire-and-forget（design D4）：逐鍵輸入若每次都等一次
  // round-trip 的回應是浪費。
  ipcMain.on(TERMINAL_CHANNELS.write, (event, sessionId: string, data: string) => {
    serviceFor(store, sessions, event.sender).write(sessionId, data)
  })

  ipcMain.on(TERMINAL_CHANNELS.resize, (event, sessionId: string, cols: number, rows: number) => {
    serviceFor(store, sessions, event.sender).resize(sessionId, cols, rows)
  })

  ipcMain.on(TERMINAL_CHANNELS.kill, (event, sessionId: string) => {
    serviceFor(store, sessions, event.sender).kill(sessionId)
    sessions.remove(sessionId)
  })
}
