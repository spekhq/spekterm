import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * 遞迴列舉一個目錄之下「可供選擇」的檔案。
 *
 * 這不是「列出全部檔案」—— 清單的用途是讓使用者從中挑一個，因此**其他 git 工作目錄**與
 * **版控忽略的內容**都必須排除。前者是重點：使用者的標準工作流把每個 change 的 worktree 開在
 * repo **自身之內**（`.claude/worktrees/<slug>/`），天真的遞迴會讓同一個檔案出現 N+1 次，而那
 * 正好摧毀「我知道檔名、要跳過去」這個唯一的情境。
 *
 * 實測（core-lib 的 folder 根）：天真遞迴 4517 筆、其中 1981 筆（44%）在 worktree 底下；
 * `git ls-files` 為 2446 筆、worktree 底下 0 筆。**git 自動排除巢狀工作目錄**（`.gitignore` 沒有
 * 提到它們，是 git 知道那是另一個工作目錄）。
 *
 * 回傳的路徑相對於 `dir`，以 POSIX 分隔符表達。呼叫端負責邊界判定與座標系轉換。
 */

/** 保守列舉的忽略清單。只在目標不在版控之下時才會用到。 */
const CONSERVATIVE_SKIP = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.venv',
  '__pycache__',
])

/** 保守遞迴的深度上限。純粹是失控保險（symlink 已不跟隨，正常樹不會這麼深）。 */
const MAX_DEPTH = 32

export class EnumerationError extends Error {
  constructor(
    readonly reason: 'timeout' | 'too-large' | 'failed',
    message: string,
  ) {
    super(message)
    this.name = 'EnumerationError'
  }
}

/** `git ls-files` 的輸出上限。一個 20 萬檔的 repo 約 10 MB，取其寬裕的兩倍。 */
const MAX_GIT_OUTPUT_BYTES = 24 * 1024 * 1024
const GIT_TIMEOUT_MS = 10_000

interface GitOutcome {
  kind: 'listed' | 'not-a-repo'
  files: string[]
}

/**
 * 以 git 列舉。
 *
 * **`-z` 是必要的，不是講究**：預設 `core.quotePath=true` 會把非 ASCII 檔名 C-quote 並包上
 * 雙引號（實測 `"docs2/\346\270\254\350\251\246…"`），失效方式是清單裡那一筆看起來像亂碼、
 * 選了之後讀檔回「找不到」。`-z` 同時解決檔名含換行的情形（`core.quotePath=false` 只解決前者）。
 *
 * **必須非同步。** 主行程一凍結，所有 pty 的 IPC 一起停住 —— 它同時是終端資料流的中介。
 * 要照抄的先例是 `ipc/settings.ts` 的 `fc-list`，**不是** `agent-status.ts`（那裡是 `spawnSync`）。
 */
function gitListFiles(dir: string): Promise<GitOutcome> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: dir,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        encoding: 'buffer',
        // **`LC_ALL=C` 是必要的**：git 的錯誤訊息會被在地化（這台機器上「不是一個 git 版本庫」
        // 是繁體中文），而我們要靠 stderr 區分「不在版控之下」與真正的失敗。這與既有的
        // 「比對 git 輸出一律加 --no-color」是同一族的坑，只是旋鈕從顏色換成語言。
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number }

          // 逾時與輸出過大 **SHALL NOT** 退回保守列舉：那時目標確實是 git repo，退回會讓
          // 巢狀工作目錄底下的檔案全部湧入，排除規則當場失效 —— 而使用者只看到清單變長。
          if (failure.killed) {
            reject(new EnumerationError('timeout', `git ls-files timed out in ${dir}`))
            return
          }
          if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            reject(new EnumerationError('too-large', `git ls-files output too large in ${dir}`))
            return
          }

          const message = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '')

          // 不在版控之下 —— 這是**唯一**可以退回保守列舉的情形，因為那樣的目錄沒有巢狀
          // 工作目錄的問題。git 對此回 exit 128 並在 stderr 說明。
          // git 不存在（ENOENT）等同「無法以版控列舉」，同樣退回。
          if (failure.code === 'ENOENT' || /not a git repository/i.test(message)) {
            resolve({ kind: 'not-a-repo', files: [] })
            return
          }

          reject(new EnumerationError('failed', `git ls-files failed in ${dir}: ${message}`))
          return
        }

        const raw = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout ?? '')
        // 分隔符寫成 escape 序列，**不可寫成字面的 NUL 位元組** —— 那會讓 git diff 與 grep
        // 對整個檔案瞎掉（grep 回空 + exit 1，連「binary file」都不說）。
        const files = raw.split('\0').filter((entry) => entry !== '')
        resolve({ kind: 'listed', files })
      },
    )
  })
}

/**
 * 保守列舉：手寫遞迴 ＋ 忽略清單。
 *
 * **只在 `isDirectory()` 為真時下鑽，絕不可換成 `readdir(dir, { recursive: true })`。**
 * 後者會走進 symlink 目錄，而邊界的包含判定是**字面**比較 —— `escape-link/secret.txt` 這種
 * 路徑必定放行，於是 folder 之外的檔名會從這道側門進入 renderer（與 chokidar `followSymlinks`
 * 預設為 true 是完全同源的坑）。`Dirent` 走 lstat 語意，symlink 的 `isDirectory()` 為 false。
 *
 * 它同時避免 folder **之內**的 symlink 目錄使同一個檔案以兩條路徑重複出現。
 */
async function conservativeList(dir: string): Promise<string[]> {
  const found: string[] = []

  async function walk(absolute: string, relative: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return

    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (CONSERVATIVE_SKIP.has(entry.name)) continue
      const childRel = relative === '' ? entry.name : `${relative}/${entry.name}`

      if (entry.isDirectory()) {
        await walk(path.join(absolute, entry.name), childRel, depth + 1)
      } else if (entry.isFile()) {
        found.push(childRel)
      }
      // symlink 與其他種類一律略過 —— 見上方的邊界論證。
    }
  }

  await walk(dir, '', 0)
  return found
}

/**
 * 列舉 `dir` 之下可供選擇的檔案，回傳相對於 `dir` 的 POSIX 路徑。
 *
 * 逾時或輸出過大會拋 `EnumerationError`；**不會**以空清單或保守列舉掩蓋它們。
 */
export async function enumerateFiles(dir: string): Promise<string[]> {
  const outcome = await gitListFiles(dir)

  // git 成功但輸出為空 ⇒ 目標整個位於版控忽略的範圍之內（實測：在被 .gitignore 涵蓋的目錄裡
  // 執行，rc=0 且無輸出）。使用者既然正在那裡工作，把它呈現為空是錯的 —— 這一點在 exit code
  // 上與「成功」無法區分，只能以「成功但為空」判定。
  if (outcome.kind === 'not-a-repo' || outcome.files.length === 0) {
    return conservativeList(dir)
  }

  return outcome.files
}
