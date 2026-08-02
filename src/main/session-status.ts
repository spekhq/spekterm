import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import {
  type AgentStatus,
  type GitWorkingState,
  readAgentStatus,
  readGitWorkingState,
} from './agent-status'

/**
 * 狀態列所需、且**只有主行程取得到**的那些事實：pty 當下的工作目錄、該目錄的 git 狀態、
 * 以及 agent 自己回報的用量。
 *
 * ## 只盯一個 session
 *
 * 這是輪詢，而輪詢的成本必須被綁住。狀態列呈現的恆是 **focused session**，因此 renderer 告訴
 * 主行程「現在看的是誰」，主行程就只對那一個求值 —— 開了 20 個 session 也只有一份輪詢。
 * 這也正是 design 允許在這裡 spawn `git` 的前提（`repo-branch` 的「不 spawn 外部程式」約束的
 * 對象是 rail 的每一列，量級完全不同）。
 *
 * ## 為什麼是輪詢而不是監看
 *
 * 三個來源之中沒有一個適合 watcher：pty 的 cwd 是 `/proc` 的一個 symlink（沒有變更事件）、
 * git 的工作區狀態要跑一次 `status`、agent 的 payload 則是 agent 每次重繪就覆寫一次的小檔。
 * 一個 2 秒的 tick 同時服務三者，比三套機制簡單得多。
 */

/** 一次 tick 的間隔。夠即時（使用者 `cd` 之後兩秒內反映），又不至於讓 `git status` 變成負擔。 */
const TICK_MS = 2000


/**
 * 這個工作目錄是否就是使用者的家目錄。
 *
 * **家目錄一律跳過 git 工作區偵測**（design D10）：`readGitWorkingState` 是同步的外部程式呼叫
 * （`spawnSync`），而本服務每數秒對 focused session 呼叫它一次。家目錄本身是 git repo 是常見
 * 設定（dotfiles 工作流），於整個家目錄跑 `git status` 會遍歷它底下的一切，而 `spawnSync`
 * 期間**主行程的訊息迴圈是停住的** —— IPC 不回應、pty 資料轉發延遲，症狀是「整個 app 每隔
 * 幾秒卡一下」。
 *
 * 此前這條路徑要使用者自己 `cd` 出去才走得到；全域 session（`global-session`）之後它是預設。
 * 而「整個家目錄的 dirty 狀態」對使用者本來就沒有意義 —— 一旦 `cd` 進真正的工作區，狀態照常。
 */
function isHomeDirectory(cwd: string): boolean {
  return path.resolve(cwd) === path.resolve(os.homedir())
}

export interface SessionStatusSnapshot {
  sessionId: string
  cwd?: string
  branch?: string
  dirty?: boolean
  worktree?: string
  agent?: AgentStatus
}

/** 取得某個 session 的 pty 當下工作目錄。由擁有 pty 的一方提供。 */
export type CwdLookup = (sessionId: string) => string | undefined

export class SessionStatusService {
  #timer: NodeJS.Timeout | null = null
  #sessionId: string | null = null
  /** 上一次推送的內容（JSON 字串）—— 沒變就不推，避免每 2 秒喚醒一次 renderer 重繪。 */
  #lastSent: string | null = null

  constructor(
    private readonly cwdOf: CwdLookup,
    private readonly target: WebContents,
    private readonly channel: string,
  ) {}

  /** renderer 告訴我們現在盯著哪個 session。`null` ＝ 停止輪詢。 */
  watch(sessionId: string | null): void {
    if (sessionId === this.#sessionId) return
    this.#sessionId = sessionId
    this.#lastSent = null

    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }
    if (sessionId === null) return

    // 立刻算一次，不要讓使用者等第一個 tick。
    this.#tick()
    this.#timer = setInterval(() => this.#tick(), TICK_MS)
  }

  dispose(): void {
    this.watch(null)
  }

  #tick(): void {
    const sessionId = this.#sessionId
    if (sessionId === null || this.target.isDestroyed()) return

    const cwd = this.cwdOf(sessionId)
    const git: GitWorkingState = cwd && !isHomeDirectory(cwd) ? readGitWorkingState(cwd) : {}

    const snapshot: SessionStatusSnapshot = {
      sessionId,
      cwd,
      branch: git.branch,
      dirty: git.dirty,
      worktree: git.worktree,
      agent: readAgentStatus(sessionId),
    }

    const encoded = JSON.stringify(snapshot)
    if (encoded === this.#lastSent) return
    this.#lastSent = encoded
    this.target.send(this.channel, snapshot)
  }
}
