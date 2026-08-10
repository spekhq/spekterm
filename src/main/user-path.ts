import { spawn } from 'node:child_process'
import { basename } from 'node:path'

/**
 * 讓主行程解析得到使用者互動 shell 所提供的可執行檔路徑。
 *
 * **為什麼需要它**：自桌面環境啟動的產物只繼承系統預設 PATH。`terminal.ts` 的 login shell 機制
 * 只作用於 pty —— 主行程自己 spawn 的東西（core 用來取得 schema 權威順序的 `openspec`）不受它
 * 影響，於是在打包產物裡一律 ENOENT。
 *
 * **這裡取得的 PATH 會被主行程 spawn 的一切繼承，包含 pty**（`ptyEnv` 整份繼承 `process.env`）。
 * 那是刻意的行為變更，不是副作用 —— 因此套用只發生在一個確定的時點（見 `index.ts`），
 * 不在任何功能的使用點。
 */

/** 包夾 PATH 的標記。取「最後一組」之間的內容 —— 互動 rc 印東西到 stdout 是常態。 */
const MARK = '@@'

/**
 * 能以 `-i -l -c` 安全查詢 PATH 的 shell。
 *
 * **白名單而非黑名單，因為失敗是靜默的**：`fish` 的 `$PATH` 是一個 list 而非以 `:` 連接的字串，
 * 對它跑同一個 `printf` 會印出 `@@/a@@@@/b@@…` —— 解析得到的是**第一個目錄**，沒有任何錯誤，
 * 只是 PATH 少掉大半。未知的 shell 一律放棄，代價只是「沒修好」，而猜錯的代價是「悄悄弄壞」。
 */
const QUERYABLE_SHELLS = new Set(['sh', 'bash', 'zsh', 'ksh'])

/**
 * 逾時。實測互動 login shell 約 1.3 秒（powerlevel10k + gitstatus + nvm + compinit），但那是
 * **熱的** —— 開機後第一次（compinit 快取冷、gitstatus daemon 未起）合理更慢。逾時的代價是
 * 靜默落到退路，所以寧可寬一點。
 */
const TIMEOUT_MS = 5000

/**
 * 自 shell 的輸出取出 PATH。取**最後一組**標記之間的內容：rc 檔印出來的噪音也可能含標記，
 * 而我們的 `printf` 恆為最後執行的東西。
 */
export function parsePathOutput(stdout: string): string | null {
  const end = stdout.lastIndexOf(MARK)
  if (end <= 0) return null
  const start = stdout.lastIndexOf(MARK, end - 1)
  if (start < 0) return null

  const value = stdout.slice(start + MARK.length, end)
  return value.length > 0 ? value : null
}

/**
 * 合併：使用者 PATH 中**現有 PATH 所無**的項目，前置於現有 PATH 之前。
 *
 * **必須前置，不能附加**（實測）：`openspec` 的 shebang 是 `#!/usr/bin/env node`，附加在後時
 * 它被解析到、但 `node` 仍解析到系統版本而失敗 —— 而 CLI 非零結束在 core 的 provider 眼中
 * **與「未安裝」無法區分**。
 *
 * 現有項目一個都不移除（產物自身注入的路徑要留著）。它們會被排到使用者路徑之後 —— 這是刻意的，
 * 而「不移除」不等於「不受影響」。
 */
export function mergeUserPath(current: string, user: string): string {
  const sep = ':'
  const currentParts = current.split(sep).filter((p) => p.length > 0)
  const seen = new Set(currentParts)

  const added: string[] = []
  for (const part of user.split(sep)) {
    if (part.length === 0 || seen.has(part)) continue
    seen.add(part)
    added.push(part)
  }

  return added.length > 0 ? [...added, ...currentParts].join(sep) : current
}

/** 這個 shell 能不能以 `-i -l -c` 安全查詢（見 `QUERYABLE_SHELLS`）。 */
export function isQueryableShell(shellPath: string): boolean {
  return QUERYABLE_SHELLS.has(basename(shellPath))
}

/** 已啟動的那一次解析（含套用）。`null` ＝ 還沒啟動過。 */
let pending: Promise<void> | null = null

/**
 * 啟動解析並在完成時**套用一次** `process.env.PATH`。
 *
 * **這是唯一的套用點。** `process.env` 會被主行程 spawn 的一切繼承（含 pty），若改在某個功能的
 * 使用點才套用，「其他行程有沒有拿到修好的 PATH」就取決於使用者有沒有先用過那個功能 ——
 * 順序相依，而且失效方向靜默。
 *
 * 重複呼叫只會解析一次。呼叫端**不該 await 它**（實測互動 shell 約 1.3 秒，不該擋住視窗建立）。
 */
export function applyUserPathOnce(): Promise<void> {
  pending ??= startUserPathResolution().then((userPath) => {
    if (userPath === null) return
    process.env.PATH = mergeUserPath(process.env.PATH ?? '', userPath)
  })
  return pending
}

/**
 * 等待那一次解析結束（**只做時序對齊，不套用**）。從未啟動過時立即完成 —— 單元測試與任何不經
 * `applyUserPathOnce()` 的路徑因此不會卡住。
 */
export function whenUserPathReady(): Promise<void> {
  return pending ?? Promise.resolve()
}

/**
 * 取得使用者互動 shell 的 PATH。回 `null` ＝ 放棄（維持原 PATH）。
 *
 * **必須是互動的（`-i`）**：非互動的 login shell 不 source `.zshrc` / `.bashrc`，而 nvm 之屬正是
 * 在那裡初始化的。實測 `zsh -l -c 'command -v openspec'` 無輸出，`zsh -i -l -c` 才找得到。
 *
 * 呼叫端**不需要**處理錯誤：任何失敗（平台不支援、shell 不在白名單、spawn 失敗、非零結束、
 * 逾時、解析不出標記）都 resolve 為 `null`。
 */
export function startUserPathResolution(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)

  const shell = process.env.SHELL || '/bin/bash'
  if (!isQueryableShell(shell)) {
    console.warn(`[user-path] skipped: ${basename(shell)} is not a shell we can query safely`)
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    let out = ''
    let settled = false

    // 計時器在 spawn 成功之後才建立，但 `finish` 必須在那之前就能引用它（spawn 失敗那條路也會
    // 呼叫 finish）。以持有者物件表達這個先後關係 —— `clearTimeout(undefined)` 是合法的 no-op。
    const timeout: { id?: NodeJS.Timeout } = {}
    const finish = (value: string | null, why?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout.id)
      if (value === null && why) console.warn(`[user-path] ${why}`)
      resolve(value)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell, ['-i', '-l', '-c', `printf '${MARK}%s${MARK}' "$PATH"`], {
        // stderr **丟棄，而不是接一條沒人 drain 的 pipe** —— 實測互動 zsh 在非 tty 下噴十行以上
        // 的 gitstatus 錯誤，pipe 滿了會讓子行程卡到逾時。
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
    } catch (error) {
      finish(null, `spawn failed: ${String(error)}`)
      return
    }

    // 逾時**必須把子行程收掉** —— 否則每次啟動都可能留下一個等待中的互動 shell。
    timeout.id = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null, `timed out after ${TIMEOUT_MS}ms`)
    }, TIMEOUT_MS)

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      out += chunk
    })
    child.on('error', (error) => finish(null, `spawn error: ${error.message}`))
    child.on('close', (code) => {
      if (code !== 0) return finish(null, `shell exited with ${code}`)
      const parsed = parsePathOutput(out)
      finish(parsed, parsed === null ? 'could not parse PATH from shell output' : undefined)
    })
  })
}
