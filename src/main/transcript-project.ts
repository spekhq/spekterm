import { worktreeKey } from '@spekjs/core'

/**
 * 把 transcript 的來源目錄名對應回一個「可以給使用者看」的專案身分。
 *
 * ## 為什麼不能直接用目錄名
 *
 * 來源目錄名就是 cwd 把每個非英數字元換成 `-` 的結果（`/home/me/git/spekterm` →
 * `-home-me-git-spekterm`）。它**是一個換過字元的絕對路徑** —— 直接送給 renderer 等於送出路徑，
 * 而 renderer 從頭到尾不該有路徑的詞彙。因此對外的識別是它的**不可逆雜湊**（沿用 core 的
 * `worktreeKey`，sha1 前 8 碼，與 `isWorktreeKey` 同格式），顯示名稱另外算。
 *
 * ## 為什麼顯示名稱不能用 `basename(cwd)`
 *
 * **`cwd` 在一支 session 之內會變。** 實測本 repo 自己的一份 transcript：同一個 session 裡出現過
 * 四個不同的 `cwd`，包含 `/tmp/…/scratchpad`。直覺作法 `basename(最後一個 cwd)` 會把這個專案
 * 標成 **「scratchpad」**，而畫面上看起來完全正常。
 *
 * 正解利用目錄名的生成規則反查：在該 session 出現過的 `cwd` 之中，取**編碼後等於目錄名**的那一個
 * —— 那就是 session 起始的專案根。編碼非單射（`/a/foo-bar` 與 `/a/foo/bar` 編碼後相同），
 * 兩者都出現時取**最早出現**的那一個：目錄名是由起始 cwd 生成的，而起始 cwd 必然最早出現。
 *
 * 反查不到時回傳 `null` 而非猜一個 —— 比照 `SpecInfo.path` 那條：少一個名字，好過給一個錯的。
 */

/** 來源目錄名的生成規則：cwd 的每個非 ASCII 英數字元換成 `-`。與 Claude Code 一致。 */
export function encodeProjectDir(cwd: string): string {
  let out = ''
  for (const ch of cwd) out += /[0-9A-Za-z]/.test(ch) ? ch : '-'
  return out
}

export interface ProjectInput {
  /** `projects/` 底下的目錄名。 */
  dirName: string
  /** 這個專案的 transcript 裡出現過的 `cwd`，依出現順序。 */
  cwds: readonly string[]
}

export interface ProjectIdentity {
  /** 送往 renderer 的識別 —— 不可逆，不含路徑。 */
  id: string
  /** 顯示名稱。反查不到時為 `null`（呈現端須自行處理「無法命名」）。 */
  label: string | null
}

/** 反查專案根：編碼後等於目錄名、且最早出現的那個 `cwd`。 */
export function findProjectRoot(dirName: string, cwds: readonly string[]): string | null {
  for (const cwd of cwds) {
    if (encodeProjectDir(cwd) === dirName) return cwd
  }
  return null
}

/** 取路徑最後 `depth` 段，作為顯示名稱的候選。 */
function tail(root: string, depth: number): string {
  const parts = root.split(/[/\\]/).filter(Boolean)
  return parts.slice(Math.max(0, parts.length - depth)).join('/')
}

/**
 * 一次解出整組專案的身分。
 *
 * **撞名的消歧必須看整組，不能一個一個算** —— 兩個不同根之下的 `billing-service` 各自算 basename
 * 都是對的，但畫面上會出現兩列一模一樣的名字，而使用者無從分辨哪個是哪個。
 * 撞名時逐段往上加，直到互異或路徑用盡。
 */
export function identifyProjects(inputs: readonly ProjectInput[]): Map<string, ProjectIdentity> {
  const roots = new Map<string, string | null>()
  for (const input of inputs) {
    roots.set(input.dirName, findProjectRoot(input.dirName, input.cwds))
  }

  const labels = new Map<string, string | null>()
  for (const [dirName, root] of roots) {
    labels.set(dirName, root === null ? null : tail(root, 1))
  }

  // 撞名的逐段往上加。最多加到最長那條路徑的段數為止。
  const maxDepth = Math.max(1, ...[...roots.values()].map((r) => (r ? r.split(/[/\\]/).filter(Boolean).length : 1)))
  for (let depth = 2; depth <= maxDepth; depth += 1) {
    const counts = new Map<string, number>()
    for (const label of labels.values()) {
      if (label === null) continue
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const colliding = [...counts.entries()].filter(([, n]) => n > 1).map(([label]) => label)
    if (colliding.length === 0) break
    for (const [dirName, label] of labels) {
      if (label === null || !colliding.includes(label)) continue
      const root = roots.get(dirName)
      if (root) labels.set(dirName, tail(root, depth))
    }
  }

  const out = new Map<string, ProjectIdentity>()
  for (const [dirName, label] of labels) {
    out.set(dirName, { id: worktreeKey(dirName), label })
  }
  return out
}
