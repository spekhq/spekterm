#!/usr/bin/env node
/**
 * 換版：遞增版本（預設 patch）並提交。`dist:linux` 的第一步。
 *
 * ## 為什麼是打包指令自己做
 *
 * issue #13 的選項 2（手動 bump）被評為「要記得做不是機制」。由打包指令承擔就沒有這個問題 ——
 * 版號成為產物的第一辨識碼，且**不倚賴任何人記得**。
 *
 * ## 三個實測結論，每一個都改變了作法
 *
 * 1. **`npm version patch` 的預設行為不能用。** 它自己 commit ＋ tag，而且**在工作副本不乾淨時
 *    直接失敗**（`Git working directory not clean`）。帶著未提交的編輯去打包在 dogfood 期間是
 *    常態 —— 沿用預設等於讓打包指令在最常見的情況下拒絕執行。`--no-git-tag-version` 一併豁免
 *    那個檢查（實測）。
 *
 * 2. **`package-lock.json` 也會被改寫，而它在版控中。** 漏掉它的後果不是不完整，是
 *    **把 `dirty` 這個欄位徹底作廢**：未提交的那一份會讓隨後每一次建置都判定工作副本不乾淨，
 *    於是每一份產物都被標為 dirty，而該標示從此不傳遞任何資訊。
 *
 * 3. **detached HEAD 下 `git commit` 會 exit 0**（實測），commit 落在一個 dangling 的位置上。
 *    只看結束碼的實作會**靜默通過** —— 而那正是本要求的理由所描述的情況（「下一次
 *    `git checkout` 就會讓它消失」）。因此要用 `git symbolic-ref` 主動偵測。
 *
 * ## 順序是 bump → commit → build
 *
 * 於是建置身分裡的 commit 就是那個換版提交本身，它所含的版本與產物宣稱的版本是同一個。
 * 代價是建置隨後失敗時版本白跳一格 —— 遞增是廉價的，「產物與它自稱的身分同源」不是。
 *
 * ## repo 根可由 argv 覆寫，而那是承重的
 *
 * 上面那三條實測**每一條都要有對照組才算被守住**（例如：漏掉 lockfile 時「遞增後不留下未提交的
 * 版本宣告」必須變紅），而對照組需要測試**自己造出**一個 git 工作副本。寫死自己的上層目錄的話，
 * 這支腳本的載體就只剩「在本 repo 跑一次」—— 那不是對照組。**與 `lib/build-info.mjs` 同一條理由。**
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION_FILES, releaseSubject } from './lib/release-files.mjs'

/** 預設為本 repo；測試以第一個引數指向暫存的 git fixture（見檔頭）。 */
const repoRoot = process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * 遞增的層級（`build-identity`「遞增的層級可由執行者指定，預設為 patch」）。
 *
 * **經由環境變數，不經由 argv**：`dist:linux` 是一串 `&&`，`npm run dist:linux -- minor` 會把引數
 * 接在**最後一個**步驟後面，而這支是第一個。`argv[2]` 另有用途（repo 根的覆寫，見檔頭）。
 */
const LEVELS = ['patch', 'minor', 'major']
const level = process.env.RELEASE_LEVEL || 'patch'


function git(args, { capture = true } = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    stdio: capture ? ['ignore', 'pipe', 'ignore'] : 'inherit',
  })
}

function fail(message) {
  console.error(`[release] ${message}`)
  process.exit(1)
}

// ── 1. 先拒絕，再動手 ────────────────────────────────────────────────────────

// 拼錯的層級若靜默退回 patch，執行者拿到的是一個他沒有要的版本 —— 而且已經被提交了。
if (!LEVELS.includes(level)) {
  fail(`RELEASE_LEVEL=${level} 不是可用的層級 —— 可用的值：${LEVELS.join('、')}（未設定時為 patch）`)
}

// 版本宣告的檔案若已被修改，**提交範圍解決不了它**：遞增與那些變更落在同一個檔案裡，
// 一次提交必然把兩者一起帶走。這是唯一必須在動手之前擋下來的情況。

let dirtyVersionFiles
try {
  dirtyVersionFiles = git(['status', '--porcelain', '--', ...VERSION_FILES]).trim()
} catch {
  fail('這裡不是一個 git 工作副本 —— 版本的遞增必須能被提交，否則兩份內容不同的產物會宣稱同一個版本')
}
if (dirtyVersionFiles) {
  fail(
    `${VERSION_FILES.join(' 或 ')} 已有未提交的變更：\n${dirtyVersionFiles}\n` +
      '  處置：先提交或還原它們，再打包。\n' +
      '  （換版提交只能指名這些檔案，而遞增與你的編輯落在同一個檔案裡 —— 一次提交會把兩者一起帶走。）',
  )
}

// **detached HEAD 要主動偵測** —— `git commit` 在那裡會成功，而那個 commit 下一次 checkout 就消失。
try {
  git(['symbolic-ref', '-q', 'HEAD'])
} catch {
  fail('HEAD 處於 detached 狀態 —— 此時的提交會落在一個 checkout 之後就消失的位置上。先切到一個分支')
}

// ── 2. 遞增 ─────────────────────────────────────────────────────────────────

execFileSync('npm', ['version', level, '--no-git-tag-version'], {
  cwd: repoRoot,
  stdio: ['ignore', 'ignore', 'inherit'],
})

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version

// ── 3. 提交（指名檔案，絕不 `-a`）────────────────────────────────────────────
// `-a` 會把工作副本中其他未提交的變更一併掃進來，而那是資料損害：提交成功、打包成功，
// 使用者要到很久以後才會發現自己的編輯被混進了一個看似無關的換版提交裡。

try {
  // **`-m` 必須在 `--` 之前** —— 之後的一切都被當成 pathspec（實測：commit 會失敗）。
  git(['commit', '-m', releaseSubject(version), '--', ...VERSION_FILES], { capture: true })
} catch {
  fail(`版本已遞增至 ${version}，但提交失敗 —— 未被提交的遞增會在下一次 checkout 時消失，請手動提交`)
}

console.log(`[release] ${version} —— 已提交（未建立 tag）`)
