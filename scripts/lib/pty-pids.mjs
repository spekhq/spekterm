import { readFileSync, readdirSync } from 'node:fs'

/**
 * pty 行程的清點 —— **兩支探針共用**（`probe-terminal` 與 `probe-intake`）。
 *
 * 抽出來的理由不是「避免重複」，是**避免兩份各自演化**：`ptySessionPids` 與 `ptyPids` 的差別
 * 是一條寫在註解裡的實測結論，而那條結論在兩支探針裡各抄一份的話，其中一份遲早會被簡化掉。
 */

/** node-pty spawn 的 shell —— 探針一律以 `SHELL=/bin/sh` 啟動被測的 app。 */
export const SHELL_PATH = '/bin/sh'

/**
 * 帶著 marker 的 pty 行程。
 *
 * 以 `environ` 比對 marker（pty 子行程繼承整個 env），並以 argv[0] 等於我們指定的 shell
 * 排除 electron 自己（它的 environ 同樣帶 marker，但 argv[0] 是 electron）。
 */
export function ptyPids(marker) {
  const pids = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const environ = readFileSync(`/proc/${entry}/environ`, 'utf8')
      if (!environ.includes(marker)) continue
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
      if (cmdline.split('\0')[0] === SHELL_PATH) pids.push(Number(entry))
    } catch {
      // 行程在我們讀它的途中結束了 —— 那就不算數。
    }
  }
  return pids
}

/**
 * **session 的數量，不是行程的數量。**
 *
 * 一個 claude session 是**兩個**帶 marker 的 `/bin/sh` 行程（實測，cmdline 說了實話）：
 * `/bin/sh -l -c claude …`（node-pty 直接 spawn 的那個，它沒有 exec）以及它底下 claude 自己
 * 的 shell。一個 login shell session 則只有一個。**拿行程數去斷言「session 沒有增加」，
 * 會把一個好的實作判成壞的。**
 *
 * node-pty spawn 的恆是 `$SHELL -l …` —— 以 `-l` 認出領頭行程，數量就等於 session 數。
 */
export function ptySessionPids(marker) {
  return ptyPids(marker).filter((pid) => {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
      return argv[1] === '-l'
    } catch {
      return false
    }
  })
}
