import { randomUUID } from 'node:crypto'
import { type IPty, spawn } from 'node-pty'
import type { FolderLookup } from './workspace-store'

/** 新 session 的 spawn 目標。兩者都經 login shell 啟動（design D6）。 */
export type SpawnTarget = 'claude' | 'shell'

export type TerminalCode = 'UNKNOWN_FOLDER' | 'FOLDER_UNAVAILABLE' | 'SPAWN_FAILED'

export class TerminalError extends Error {
  constructor(
    readonly code: TerminalCode,
    message: string,
  ) {
    super(message)
    this.name = 'TerminalError'
  }
}

/**
 * pty 事件的出口。與 `WatchService` 同源：管理器不依賴 Electron，推送的出口由建構端注入，
 * 因此可由單元測試直接驅動（餵它一個假的 sink，斷言收到的事件）。
 */
export interface TerminalSink {
  data(sessionId: string, chunk: string): void
  exit(sessionId: string, exitCode: number): void
}

/** pty 初始尺寸。renderer 掛載後會 fit 並 resize 校正，這只是 spawn 當下的暫定值。 */
const INITIAL_COLS = 80
const INITIAL_ROWS = 24

/** 桌面啟動的 GUI app 常缺使用者 shell 的 PATH，故一律經 login shell（design D6）。 */
function resolveShell(): string {
  return process.env.SHELL || '/bin/bash'
}

/**
 * login shell 模式：互動 login shell（`-l`）。
 * claude 模式：以 login shell 執行 `claude`（`-l -c claude`）——讓 nvm／Homebrew 等
 * 由 profile 載入的 PATH 生效，`claude` 才找得到；claude 收工後 session 隨之結束。
 */
function spawnArgs(target: SpawnTarget): string[] {
  return target === 'claude' ? ['-l', '-c', 'claude'] : ['-l']
}

/**
 * 多 session 的 pty 管理器。每個 session 對應一個 node-pty 行程，其生命週期由**擁有者**
 * （某個 `webContents`）在 ipc 層界定：擁有者銷毀或重新載入時，`dispose()` 殺光全部
 * （design D1、D2）。
 *
 * `#sessions` 恆等於「**還活著**的 pty」：`onExit` 一觸發就從 Map 移除——pty 已死，它的
 * 輸出早已串流至 renderer，主行程再留著實例沒有意義。renderer 端仍會在 UI 保留這個
 * 已結束的 session（標示 exited、輸出仍可讀），那是 renderer 的清單，與此 Map 無關。
 */
export class TerminalService {
  readonly #sessions = new Map<string, IPty>()

  constructor(
    private readonly store: FolderLookup,
    private readonly sink: TerminalSink,
  ) {}

  /** 還活著的 pty 數量。驗收「關閉／dispose 後確實清理」用得上。 */
  get sessionCount(): number {
    return this.#sessions.size
  }

  /**
   * 在指定 folder 的根目錄開一個 session。**只接受 folderId、不接受任何路徑**——於是
   * renderer 在語彙上無從把初始 cwd 指向 workspace 之外（design D5）。
   */
  create(folderId: string, target: SpawnTarget): string {
    const folder = this.store.list().find((candidate) => candidate.id === folderId)
    if (!folder) throw new TerminalError('UNKNOWN_FOLDER', `unknown folder: ${folderId}`)
    if (folder.status !== 'ok') {
      throw new TerminalError('FOLDER_UNAVAILABLE', `folder is unavailable: ${folder.path}`)
    }

    const sessionId = randomUUID()
    let pty: IPty
    try {
      pty = spawn(resolveShell(), spawnArgs(target), {
        name: 'xterm-256color',
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
        cwd: folder.path,
        // TERM 明確設定以對齊前端 xterm；其餘環境自 process.env 繼承（含 login shell
        // 之外的既有變數）。encoding 不設，node-pty 預設 utf8，onData 交付 string。
        env: { ...process.env, TERM: 'xterm-256color' },
      })
    } catch (error) {
      // 罕見：底層 pty 配置不出來時 node-pty 才會同步拋錯。
      //
      // **shell 路徑無效不走這裡。** 實測：node-pty 對 execvp 失敗不同步拋錯 —— 它成功
      // 回傳一個 pty，該 pty 隨即以非零碼 exit，`execvp(3) failed.` 由 onData 送出。
      // 於是「shell 路徑錯」與「claude 找不到」殊途同歸，都經 onExit 呈現。
      throw new TerminalError('SPAWN_FAILED', `failed to allocate pty: ${String(error)}`)
    }

    this.#sessions.set(sessionId, pty)
    pty.onData((chunk) => this.sink.data(sessionId, chunk))
    pty.onExit(({ exitCode }) => {
      this.#sessions.delete(sessionId)
      this.sink.exit(sessionId, exitCode)
    })

    return sessionId
  }

  /** renderer → pty。未知或已結束的 session 靜默忽略（renderer 可能有時序落差）。 */
  write(sessionId: string, data: string): void {
    const pty = this.#sessions.get(sessionId)
    if (!pty) return
    try {
      pty.write(data)
    } catch {
      // pty 剛好在此刻結束——輸入丟棄即可。
    }
  }

  /** 同步 pty 尺寸。node-pty 對 0 尺寸會拋錯，故先夾制到至少 1x1。 */
  resize(sessionId: string, cols: number, rows: number): void {
    const pty = this.#sessions.get(sessionId)
    if (!pty) return
    const safeCols = Math.max(1, Math.floor(cols))
    const safeRows = Math.max(1, Math.floor(rows))
    try {
      pty.resize(safeCols, safeRows)
    } catch {
      // 尺寸事件與 pty 結束競態時的殘留呼叫，忽略。
    }
  }

  /** 明確關閉一個 session。已結束者（不在 Map）為 no-op。 */
  kill(sessionId: string): void {
    const pty = this.#sessions.get(sessionId)
    if (!pty) return
    this.#sessions.delete(sessionId)
    try {
      pty.kill()
    } catch {
      // 已死的 pty，kill 可能拋錯，無妨。
    }
  }

  /** 殺光所有 pty。擁有者銷毀或重新載入時呼叫（design D2）——不留孤兒行程。 */
  dispose(): void {
    for (const pty of this.#sessions.values()) {
      try {
        pty.kill()
      } catch {
        // 個別 pty 已死不影響其餘清理。
      }
    }
    this.#sessions.clear()
  }
}
