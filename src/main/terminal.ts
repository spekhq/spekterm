import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { type IPty, spawn } from 'node-pty'
import { isWithin } from './fs-boundary'
import { isUuid } from './session-store'
import type { FolderLookup } from './workspace-store'

/** 新 session 的 spawn 目標。兩者都經 login shell 啟動（design D6）。 */
export type SpawnTarget = 'claude' | 'shell'

export type TerminalCode =
  | 'UNKNOWN_FOLDER'
  | 'UNKNOWN_SESSION'
  | 'FOLDER_UNAVAILABLE'
  | 'SPAWN_FAILED'

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
/**
 * pty 為什麼結束了。**這個區分是承重的**（session-persistence）。
 *
 * - `self` —— pty 自己死了（使用者打了 `exit`、claude 收工、命令啟動失敗）。這是**真的**
 *   session 結束：它不再被持久化，重開 app 不該把一個死掉的分頁重建回來。
 * - `killed` —— 使用者關掉了這個 session。同上。
 * - `disposed` —— **關視窗或 reload 時我們自己殺的。** pty 死是設計（不留孤兒行程），
 *   **session 沒有結束** —— 它正要被持久化下來，等下次開啟時重建。
 *
 * 少了這個區分，關視窗時每個 pty 的 exit 都會被當成「session 結束了」而把它從持久化裡抹掉
 * —— 那就是「關掉 app 之後 session 全部不見」本人，只是換了一種寫法。
 */
export type ExitReason = 'self' | 'killed' | 'disposed'

export interface TerminalSink {
  data(sessionId: string, chunk: string): void
  exit(sessionId: string, exitCode: number, reason: ExitReason): void
  /**
   * claude 的對話識別碼確定了（新建時是剛產生的；續接失敗自癒後是**換過的那一個**）。
   *
   * 這個事件存在的理由：對話 id 是**主行程的知識**，renderer 從來沒有這個詞彙，但它必須被
   * 持久化，而持久化的落點也在主行程 —— 於是這個 sink 只通知擁有者「該把它記下來了」。
   */
  conversation(sessionId: string, conversationId: string): void
}

/** pty 初始尺寸。renderer 掛載後會 fit 並 resize 校正，這只是 spawn 當下的暫定值。 */
const INITIAL_COLS = 80
const INITIAL_ROWS = 24

/**
 * 續接失敗的判定窗口：pty 在這段時間內以**非零碼**結束，視為 `claude --resume` 沒接上
 * （實測：`No conversation found with session ID: …` 之後 exit 1，發生在啟動階段、數百毫秒內）。
 *
 * **判準只看「時間 + 結束碼」，不解析 claude 的輸出** —— 不去 parse 別人的錯誤訊息。
 *
 * 代價（已知且有界）：一個**續接成功後隨即崩潰**的 claude 會被誤判為續接失敗，於是自癒成一個
 * 全新的對話，舊對話的指標就此遺失（那份對話仍在磁碟上，使用者仍可在 shell 裡 `claude --resume`
 * 用選單找回來）。窗口取得短，是為了壓低這個誤判的機率。
 */
const RESUME_FAILURE_WINDOW_MS = 3000

/** 桌面啟動的 GUI app 常缺使用者 shell 的 PATH，故一律經 login shell（design D6）。 */
function resolveShell(): string {
  return process.env.SHELL || '/bin/bash'
}

/**
 * 「我正跑在一個 Claude Code session 裡」的標記。**spekterm 的終端是頂層終端，不是誰的子行程**
 * —— 這些標記不得洩漏進 pty。
 *
 * **為什麼這是承重的（實測）**：spekterm 若由一個 agent 啟動（`npm run dev` 是 agent 幫忙跑的 ——
 * dogfooding 時的常態），Electron 會繼承那個 Claude Code session 的 env，pty 再整份繼承下去。
 * 於是裡面每一個 `claude` 都認為自己是**巢狀的子 session**，而**巢狀的 claude 不寫 transcript**
 * —— `--resume` 於是必然失敗，`session-persistence` 的核心承諾（續接對話）**靜默地失效**。
 *
 * 而自癒機制會把這個失敗**蓋掉**：使用者拿到一個能用的 claude，只是對話永遠是全新的。
 * **最糟的那種 bug —— 它看起來像正常運作。**
 *
 * 二分實測出的元兇只有 **`CLAUDE_CODE_CHILD_SESSION`** 一個（單獨拿掉它，transcript 就寫出來了；
 * 單獨拿掉 `CLAUDECODE` 或 `CLAUDE_CODE_ENTRYPOINT` 都無效）。其餘一併移除，是因為它們表達的是
 * 同一件事——「這個行程隸屬於某個 Claude Code session」——而那對 spekterm 的 pty 一律不成立。
 *
 * **絕不以 `CLAUDE*` 前綴一概剝除**：`CLAUDE_CODE_OAUTH_TOKEN` 是認證用的，剝掉它 claude 會登不進去。
 * 名單是明確列舉的，且不含任何帶 KEY／TOKEN 的名字。
 *
 * 副作用很小：使用者自己在 `~/.zshrc` 之類設定的變數**不受影響** —— 我們 spawn 的是 login shell，
 * 它會重新 source 那些檔案。這裡拿掉的只有「啟動 spekterm 的那個行程注入的」。
 */
const NESTED_CLAUDE_ENV = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_AGENT',
  'CLAUDE_JOB_DIR',
] as const

/**
 * pty 的環境。整份繼承主行程，但抹掉「巢狀 Claude Code」的標記（見上）。
 *
 * 這對**兩種** spawn 目標都適用：使用者在 login shell session 裡手動打 `claude`，會踩到一模一樣的坑。
 */
export function ptyEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, TERM: 'xterm-256color' }
  for (const key of NESTED_CLAUDE_ENV) delete env[key]
  return env
}

/**
 * login shell 模式：互動 login shell（`-l`）。
 * claude 模式：以 login shell 執行 `claude`（`-l -c <命令>`）——讓 nvm／Homebrew 等
 * 由 profile 載入的 PATH 生效，`claude` 才找得到；claude 收工後 session 隨之結束。
 *
 * **`conversationId` 會被拼接進一個字串命令，因此它必須是 UUID** —— 呼叫端已驗證，這裡再擋一次
 * （這種東西不值得只擋一層）。新建對話用 `--session-id`（由我們指定 id，於是它可被持久化並在
 * 下次續接）；續接用 `--resume`（實測：它**沿用**原 id，不會換號 —— `--fork-session` 才換）。
 */
function spawnArgs(target: SpawnTarget, conversation: ClaudeConversation | undefined): string[] {
  // claude 目標**恆有**一個對話（`create()` 不是續接就是新建）—— 沒有「不帶 id 的 claude」。
  if (target !== 'claude' || !conversation) return ['-l']

  const { id, mode } = conversation
  if (!isUuid(id)) throw new TerminalError('SPAWN_FAILED', 'conversation id 不是合法的 UUID')

  const flag = mode === 'resume' ? '--resume' : '--session-id'
  return ['-l', '-c', `claude ${flag} ${id}`]
}

interface ClaudeConversation {
  id: string
  mode: 'resume' | 'new'
}

export interface SpawnOptions {
  /**
   * 重建一個既有 session 時沿用它的識別碼。**分頁、focus、順序、錨定全掛在這個 id 上**，
   * 它不能因為重建而改變（design D1）。
   */
  sessionId?: string
  /** claude：續接這個對話。非 UUID 一律忽略並以全新對話開始 —— 絕不拼接未經驗證的值。 */
  resumeConversationId?: string
  /** shell：最後已知的工作目錄。夾制於 folder 邊界內；越界或不可用時退回根目錄。 */
  cwd?: string
}

export interface SpawnResult {
  sessionId: string
  /** claude 目標實際使用的對話識別碼。 */
  conversationId?: string
}

interface Session {
  pty: IPty
  folderPath: string
  target: SpawnTarget
  conversation?: ClaudeConversation
  startedAt: number
  /** 自癒已經用掉了 —— 至多一次（否則 `claude` 沒安裝時會無限重試）。 */
  healed: boolean
}

/**
 * pty 當下的工作目錄。
 *
 * **讀 `/proc/<pid>/cwd` 這個 symlink，不 spawn 任何外部程式**（與 `git-branch` 讀 `.git/HEAD`
 * 同一條紀律）。這是 Linux-only：macOS／Windows 沒有 `/proc`，於是回 `undefined` —— 那些平台上
 * shell 一律重生於 folder 根目錄，**優雅降級，不會壞**（不去 spawn `lsof`：慢，且違反上面那條）。
 *
 * pid 是 login shell 的 pid，它的 cwd 就是使用者 `cd` 到的地方（前景有子行程時也不受影響）。
 */
function readPtyCwd(pid: number): string | undefined {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return undefined
  }
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
  readonly #sessions = new Map<string, Session>()

  /**
   * 我們主動殺掉的 pty 及其原因。
   *
   * **原因必須掛在 pty 上、由真正的 `onExit` 讀出來**，不能在 `kill()`／`dispose()` 當下就直接
   * 回報結束 —— 那樣「exit 事件」就不再是「這個行程真的死了」的證據，而「不留孤兒行程」的驗收
   * 正是靠它。`kill()` 是非同步的：呼叫它的當下 pty 還活著。
   */
  readonly #reasons = new WeakMap<IPty, ExitReason>()

  constructor(
    private readonly store: FolderLookup,
    private readonly sink: TerminalSink,
  ) {}

  /** 還活著的 pty 數量。驗收「關閉／dispose 後確實清理」用得上。 */
  get sessionCount(): number {
    return this.#sessions.size
  }

  /**
   * 在指定 folder 開一個 session。**只接受 folderId，不接受來自 renderer 的任何路徑**——於是
   * renderer 在語彙上無從把初始 cwd 指向 workspace 之外（design D5）。
   *
   * `options.cwd` 不破壞這條：它由**主行程自己**（持久化層）供應，而且在這裡被夾制回 folder
   * 邊界內。renderer 呼叫得到的 IPC 從來沒有 cwd 這個參數（session-persistence 的
   * 「持久化不得把路徑詞彙交給 renderer」）。
   */
  create(folderId: string, target: SpawnTarget, options: SpawnOptions = {}): SpawnResult {
    const folder = this.store.list().find((candidate) => candidate.id === folderId)
    if (!folder) throw new TerminalError('UNKNOWN_FOLDER', `unknown folder: ${folderId}`)
    if (folder.status !== 'ok') {
      throw new TerminalError('FOLDER_UNAVAILABLE', `folder is unavailable: ${folder.path}`)
    }

    const sessionId = options.sessionId ?? randomUUID()

    // 續接的 id 不合法時**不是錯誤，是「沒有東西可以續接」** —— 以全新對話開始，而不是把一個
    // 未經驗證的字串拼進命令，也不是讓這個 session 就此死掉（design D8、spec 的「不合法的對話
    // 識別碼不進入命令」）。
    const resumable = target === 'claude' && isUuid(options.resumeConversationId)
    if (target === 'claude' && options.resumeConversationId && !resumable) {
      console.error('[terminal] 持久化的對話識別碼不合法，改以全新對話啟動')
    }

    const conversation: ClaudeConversation | undefined =
      target !== 'claude'
        ? undefined
        : resumable
          ? { id: options.resumeConversationId as string, mode: 'resume' }
          : { id: randomUUID(), mode: 'new' }

    this.#spawn(sessionId, folder.path, target, conversation, {
      cwd: this.#initialCwd(folder.path, options.cwd),
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      healed: false,
    })

    return { sessionId, conversationId: conversation?.id }
  }

  /**
   * 重建的工作目錄 —— **夾制於 folder 邊界內**。
   *
   * 越界（使用者關 app 前 `cd` 出去了）或已不存在時退回根目錄。`folderPath` 與 `/proc` 讀回的
   * cwd 都已經是解析過 symlink 的真實路徑，故可直接比對。
   */
  #initialCwd(folderPath: string, cwd?: string): string {
    if (!cwd) return folderPath
    if (!isWithin(folderPath, cwd)) return folderPath
    try {
      if (!fs.statSync(cwd).isDirectory()) return folderPath
    } catch {
      return folderPath
    }
    return cwd
  }

  #spawn(
    sessionId: string,
    folderPath: string,
    target: SpawnTarget,
    conversation: ClaudeConversation | undefined,
    options: { cwd: string; cols: number; rows: number; healed: boolean },
  ): void {
    const { cwd, cols, rows, healed } = options
    let pty: IPty
    try {
      pty = spawn(resolveShell(), spawnArgs(target, conversation), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        // TERM 明確設定以對齊前端 xterm；其餘環境自 process.env 繼承，但抹掉「巢狀 Claude Code」
        // 的標記（見 `ptyEnv` —— 少了那一步，裡面的 claude 不寫 transcript，續接永遠失敗）。
        // encoding 不設，node-pty 預設 utf8，onData 交付 string。
        env: ptyEnv(),
      })
    } catch (error) {
      // 罕見：底層 pty 配置不出來時 node-pty 才會同步拋錯。
      //
      // **shell 路徑無效不走這裡。** 實測：node-pty 對 execvp 失敗不同步拋錯 —— 它成功
      // 回傳一個 pty，該 pty 隨即以非零碼 exit，`execvp(3) failed.` 由 onData 送出。
      // 於是「shell 路徑錯」與「claude 找不到」殊途同歸，都經 onExit 呈現。
      throw new TerminalError('SPAWN_FAILED', `failed to allocate pty: ${String(error)}`)
    }

    this.#sessions.set(sessionId, {
      pty,
      folderPath,
      target,
      conversation,
      startedAt: Date.now(),
      healed,
    })

    pty.onData((chunk) => this.sink.data(sessionId, chunk))
    pty.onExit(({ exitCode }) => {
      const session = this.#sessions.get(sessionId)
      // 這一輪的 pty 已經不是當下這個 session 的 pty（自癒已重新 spawn 過）—— 忽略遲到的 exit。
      if (session && session.pty !== pty) return

      const reason = this.#reasons.get(pty) ?? 'self'
      // 自癒只針對「pty 自己死了」—— 使用者關掉的、或我們收工時殺掉的，都不該被復活。
      if (reason === 'self' && session && this.#heal(sessionId, session, exitCode)) return

      this.#sessions.delete(sessionId)
      this.sink.exit(sessionId, exitCode, reason)
    })
  }

  /**
   * 續接失敗的自癒：以一個**全新的**對話識別碼重開一個 claude，session 的身分不變。
   *
   * **為什麼是「換一個新 id」而不是「沿用舊 id 重開」**：實測 `claude --session-id <已存在的 id>`
   * 會直接報 `Error: Session ID … is already in use.` —— 於是 `claude --resume X || claude
   * --session-id X` 這種寫法是個陷阱。換新 id 則永遠不可能撞號（design D2）。
   *
   * **為什麼這是主線而不是例外**：實測「開了 claude session、還沒跟它講話就關掉 app」時，claude
   * 根本不會寫 transcript —— 那是很常見的行為（開個分頁準備等一下用），而它必然使 `--resume` 失敗。
   *
   * 回傳 true＝已自癒（不要把這次 exit 送給 renderer，那個 session 還活著）。
   */
  #heal(sessionId: string, session: Session, exitCode: number): boolean {
    if (session.target !== 'claude') return false
    if (session.conversation?.mode !== 'resume') return false
    if (session.healed) return false
    if (exitCode === 0) return false
    if (Date.now() - session.startedAt >= RESUME_FAILURE_WINDOW_MS) return false

    const conversation: ClaudeConversation = { id: randomUUID(), mode: 'new' }
    try {
      this.#spawn(sessionId, session.folderPath, session.target, conversation, {
        cwd: this.#initialCwd(session.folderPath, undefined),
        // **繼承將死那顆 pty 的尺寸。**
        //
        // 自癒對 renderer **完全不可見**（`status` 一直是 `running`，它收不到任何事件）——
        // 於是「pty 誕生時把終端當下的尺寸告訴它」那個 effect 不會重跑，而 `fit()` 又因為
        // 「尺寸沒變」一律回 `null`。少了這一行，自癒出來的 pty **一輩子停在 80×24**：claude
        // 以 80 欄排版、畫面縮成一小塊，要手動拖動視窗才恢復。
        //
        // **而自癒是主線情境**（沒跟 claude 講過話的 session，續接必定失敗）—— 這條路上的 pty
        // 尺寸壞掉，比 wake 那條更常被看到。`IPty` 的 `cols`／`rows` 記著它最後一次被 resize
        // 的尺寸，正是我們要的。
        cols: session.pty.cols,
        rows: session.pty.rows,
        healed: true,
      })
    } catch {
      // 連新的 pty 都配置不出來 —— 讓原本的失敗照常呈現。
      this.#sessions.delete(sessionId)
      this.sink.exit(sessionId, exitCode, 'self')
      return true
    }

    this.sink.conversation(sessionId, conversation.id)
    return true
  }

  /** pty 當下的工作目錄（shell 目標才有意義）。取不到時 `undefined`。 */
  cwdOf(sessionId: string): string | undefined {
    const session = this.#sessions.get(sessionId)
    if (!session || session.target !== 'shell') return undefined
    const cwd = readPtyCwd(session.pty.pid)
    // 邊界外的 cwd 不予記錄 —— 存了它，下次重建時也只會被夾制回根目錄，徒然把一個 workspace
    // 之外的路徑寫進設定檔。
    return cwd && isWithin(session.folderPath, cwd) ? cwd : undefined
  }

  /** renderer → pty。未知或已結束的 session 靜默忽略（renderer 可能有時序落差）。 */
  write(sessionId: string, data: string): void {
    const session = this.#sessions.get(sessionId)
    if (!session) return
    try {
      session.pty.write(data)
    } catch {
      // pty 剛好在此刻結束——輸入丟棄即可。
    }
  }

  /** 同步 pty 尺寸。node-pty 對 0 尺寸會拋錯，故先夾制到至少 1x1。 */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.#sessions.get(sessionId)
    if (!session) return
    const safeCols = Math.max(1, Math.floor(cols))
    const safeRows = Math.max(1, Math.floor(rows))
    try {
      session.pty.resize(safeCols, safeRows)
    } catch {
      // 尺寸事件與 pty 結束競態時的殘留呼叫，忽略。
    }
  }

  /** 明確關閉一個 session。已結束者（不在 Map）為 no-op。 */
  kill(sessionId: string): void {
    const session = this.#sessions.get(sessionId)
    if (!session) return
    this.#sessions.delete(sessionId)
    this.#reasons.set(session.pty, 'killed')
    try {
      session.pty.kill()
    } catch {
      // 已死的 pty，kill 可能拋錯，無妨。
    }
  }

  /**
   * 殺光所有 pty。擁有者銷毀或重新載入時呼叫（design D2）——不留孤兒行程。
   *
   * 它們的 exit 會以 `disposed` 回報 —— **那不是 session 結束**，持久化必須原封不動。
   */
  dispose(): void {
    for (const session of this.#sessions.values()) {
      this.#reasons.set(session.pty, 'disposed')
      try {
        session.pty.kill()
      } catch {
        // 個別 pty 已死不影響其餘清理。
      }
    }
    this.#sessions.clear()
  }
}
