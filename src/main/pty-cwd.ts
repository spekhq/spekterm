import fs from 'node:fs'

/**
 * Whether this platform lets the application read a pty's current working directory.
 *
 * **One predicate for the behavior and for what the application says about it.** A restored shell comes
 * back in its last directory only where this is true; the close dialog says so only where this is true
 * (`workspace-app-shell`: the dialog is true on the platform it runs on). Two separate platform tests would
 * drift apart without a sound.
 */
export function ptyCwdReadable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux'
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
export function readPtyCwd(pid: number, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!ptyCwdReadable(platform)) return undefined
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return undefined
  }
}
