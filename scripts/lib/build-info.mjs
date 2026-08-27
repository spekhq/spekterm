/**
 * 建置身分 —— 「我手上跑的這份，是不是剛才那次打包的產物？」的答案來源。
 *
 * ## 為什麼要參數化 repo 根
 *
 * **這不是彈性，是承重的。** `build-identity` 有一對 requirement：〈帶著未提交的變更建置時被
 * 標示〉與〈工作副本乾淨時不標示〉。**這一對只有在測試能自己造出一個乾淨與一個不乾淨的 git
 * 工作副本時才驗得到** —— 寫死 `process.cwd()` 的話，那兩條的載體就只剩「在本 repo 當下的狀態
 * 跑一次」，而那不是對照組。
 *
 * ## `LC_ALL=C`
 *
 * git 的錯誤訊息會被在地化（這台機器的 git 講繁體中文），而任何比對輸出的地方都會因此靜默失準。
 * 與 repo 既有的那條教訓同族。`--porcelain` 本身即不上色，故不必再加 `--no-color`。
 */

import { execFileSync } from 'node:child_process'

/** @typedef {{ mode: 'build', version: string, builtAt: string, commit: string, dirty: boolean }} BuildIdentity */
/** @typedef {{ mode: 'development', version: string }} DevIdentity */

/** git 的呼叫一律經這裡：固定 `LC_ALL=C`，失敗回 `null` 而不拋。 */
function git(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * 打包產物的建置身分。
 *
 * `dirty` 以 `git status --porcelain` 的**空輸出**判定 —— 注意它涵蓋 untracked 檔案，那是刻意的：
 * 產物的原始碼狀態若含一個未被追蹤的檔案，它同樣不對應任何 commit。
 *
 * @param {string} repoRoot
 * @param {string} version
 * @param {string} builtAt ISO 8601；由呼叫端提供，使產生端本身保持可決定
 * @returns {BuildIdentity}
 */
export function buildIdentity(repoRoot, version, builtAt) {
  const status = git(repoRoot, ['status', '--porcelain'])
  return {
    mode: 'build',
    version,
    builtAt,
    commit: git(repoRoot, ['rev-parse', '--short', 'HEAD']) ?? 'unknown',
    // 取不到狀態時保守地標為 dirty：**「不知道」比較接近「不乾淨」而不是「乾淨」**，
    // 而一個錯誤地宣稱乾淨的身分，正是這條能力要消滅的那種看起來很正常的錯誤答案。
    dirty: status === null ? true : status !== '',
  }
}

/**
 * 開發模式的身分。
 *
 * **刻意不含 `builtAt`** —— 開發模式沒有「打包時刻」可言，把行程啟動時刻放進去就是冒充。
 * 兩種身分以 `mode` 區分，**不必讀值就分得出來**。
 *
 * @param {string} version
 * @returns {DevIdentity}
 */
export function devIdentity(version) {
  return { mode: 'development', version }
}

/**
 * semver 的大小比較 —— **選檔與清理共用這一個**。
 *
 * 存在的理由是字串排序在此是錯的：`'0.1.10' < '0.1.9'` 為真（字典序），於是依檔名排序的清理會
 * 把**剛建好的那一份**當成最舊的刪掉。以逐次遞增計，第十次打包就會發生。
 *
 * @returns {number} 負數 / 0 / 正數
 */
export function compareVersions(a, b) {
  const pb = parseVersion(b)
  // **不寫成 `for (let i = 0; i < 3; i++) { … return … }`** —— `scripts/retry-source.test.mjs`
  // 把「純計數的界 ＋ 體內提早退出」判定為手寫重試，而這個檔案在它的定義域內
  // （`scripts/lib/*.mjs`）。那個判準對它要防的東西是對的，這裡改寫比放寬它便宜。
  return parseVersion(a).map((n, i) => n - pb[i]).find((d) => d !== 0) ?? 0
}

/** `1.2.3` → `[1, 2, 3]`；非數字的段落視為 0（預發佈標記不參與比較）。 */
function parseVersion(v) {
  const core = String(v).split('-')[0].split('+')[0]
  const parts = core.split('.').map((n) => Number.parseInt(n, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}
