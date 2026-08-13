/**
 * 探針的**前置條件** —— 在啟動被測應用程式之前就能判定、且判定為否時再往下走毫無意義的那些事。
 *
 * ## 為什麼要有這一層
 *
 * 兩個**處置完全相反**的前置條件，此前產生一模一樣的失敗訊息：
 *
 * - `out/` 不存在（忘了 build）
 * - debugging port 被殘留行程抓著（要去清行程）
 *
 * 兩者都表現為每支探針各等滿 30 秒、回報「等待 CDP target 逾時」與 `0/0 通過`。實測一輪這樣的
 * 執行花了約 20 分鐘、一條斷言都沒驗到 —— 而追查時**先誤判成 port 佔用、查完才發現是產物不存在**。
 *
 * 「立即失敗」與「可區分」缺一不可：只做前者，人仍然要自己判斷是哪一種；只做後者，代價仍然是
 * 那 20 分鐘。
 *
 * ## 判定與歸因是分開的
 *
 * 判定 port 是否被佔用只用 Node 內建的 `net`；**找出持有者**才用 `ss`。#18 那次的持有者是
 * `dconf watch`（Chromium 為監看系統 proxy 而 spawn 的輔助行程，從持有 debugging port socket 的
 * Electron fork 出來時繼承了那個 fd，Electron 死後被 reparent 繼續活著）—— 它的命令列與 Electron
 * 毫無關係，**歸因是這件事的全部價值**。但歸因需要外部程式與權限，兩者都可能不在；讓一個加分項
 * 決定判定的成敗，就是把一個穩固的檢查換成一個會在別的機器上失靈的檢查。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { pollFor } from './instrument.mjs'

/**
 * 前置條件不成立。
 *
 * 自成一個型別，是為了讓呼叫端能把它與**程式的內部錯誤**分開：前者印一行可執行的指示就夠了
 * （比照缺 `xvfb` 的處理），後者該把 stack trace 完整丟出來。
 */
export class PreflightError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PreflightError'
  }
}

/**
 * 不吃 `npm run build` 產物的探針。
 *
 * **這份名單只有這一份。** `run-probe.mjs` 的 `buildIfNeeded()` 也用它 —— 兩邊各留一份的話，
 * 「跳過建置」與「豁免產物檢查」遲早會對不上，而那個不一致的症狀是「某支探針在產物不存在時
 * 依然空轉 30 秒」。
 */
export const NO_BUILD = new Set([
  'native', // 驗的是 node-pty 能不能被主行程載入，不碰 out/
  'package', // 由 `npm run dist:linux` 產生真正的 AppImage，不是 `npm run build`
])

const ARTIFACTS = [
  join('out', 'main', 'index.js'),
  join('out', 'renderer', 'index.html'),
]

/**
 * 建置產物在不在。
 *
 * @param {string} name 探針名
 * @param {{ root: string }} options
 * @throws {PreflightError}
 */
export function ensureBuildArtifacts(name, { root }) {
  if (NO_BUILD.has(name)) return

  const missing = ARTIFACTS.filter((relative) => !existsSync(join(root, relative)))
  if (missing.length === 0) return

  throw new PreflightError(
    `[probe:${name}] 建置產物不存在：${missing.join('、')}\n` +
      `  先跑 \`npm run build\`（\`npm run test:e2e\` 已經含它；` +
      `單獨跑 \`node scripts/run-probes.mjs\` 則沒有）。\n` +
      `  沒有這道檢查的話，接下來會是 30 秒的「等待 CDP target 逾時」與 0/0 通過 ——` +
      `而那句話與「port 被佔用」長得一模一樣。`,
  )
}

/**
 * 這個 port 上有沒有東西在 listen。
 *
 * **四種情形的失效方向**（判定的可靠性靠這張表成立，不靠「`net.connect` 聽起來很準」）：
 *
 * | 情形 | 結果 | 判定 | 對不對 |
 * |---|---|---|---|
 * | #18 的實況（輔助行程繼承 LISTEN fd） | 連得上 | 被佔用 | **正確**，這是要抓的那個 |
 * | 沒有人 listen（含 TIME_WAIT 殘留） | `ECONNREFUSED` | 可用 | 正確 |
 * | 只有 IPv6 的 listener | 連不上 v4 | 可用 | 無害 —— Electron 綁的就是 `127.0.0.1` |
 * | listener 在但 accept queue 滿 | **逾時** | 被佔用 | 保守：本機 loopback 上的可用 port 是**立刻**拒絕連線的，逾時本身就是異常訊號 |
 *
 * **socket 一定要 `destroy()`。** 少了它，一個為了取代 30 秒神秘逾時而做的檢查，自己會在
 * `run-probe.mjs` 留下一個不放的 handle。
 */
export function isPortBusy(port, { host = '127.0.0.1', connectTimeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (busy) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(busy)
    }
    socket.setTimeout(connectTimeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

/**
 * 誰抓著這個 port —— **取不到就回 `null`，不是錯誤**。
 *
 * `LC_ALL=C`：這台機器上的工具會講中文（`git` 已經咬過三次），而輸出是要被人讀的，
 * 統一成一種語言比較好比對。
 */
export function lookupHolder(port) {
  try {
    const out = execFileSync('ss', ['-tlnp'], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const line = out.split('\n').find((row) => row.includes(`:${port} `))
    return line ? line.trim() : null
  } catch {
    // `ss` 不存在、不在 PATH 上、或沒有權限讀行程資訊 —— 歸因失敗不影響判定。
    return null
  }
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} 秒`

/**
 * 這些 port 現在可用嗎。
 *
 * 被佔用時**先退避重試**：完整驗收裡前一支剛結束、下一支立刻檢查，前者的 Electron 可能還在
 * 收尾 —— 直接失敗會製造一種新的假紅。窗口太短會假紅，太長就退化成它要取代的那 30 秒。
 *
 * @param {number[]} ports
 * @param {{ name?: string, backoffMs?: number, intervalMs?: number,
 *           connectTimeoutMs?: number, holderOf?: (port: number) => string | null }} options
 *   `holderOf` 與 `backoffMs` 是**注入接縫**：少了它們，驗收要嘛燒掉數秒真實時間，要嘛驗不到
 *   出貨的預設值。
 * @throws {PreflightError}
 */
export async function ensurePortsFree(
  ports,
  { name = 'probe', backoffMs = 3000, intervalMs = 300, connectTimeoutMs = 1000, holderOf = lookupHolder } = {},
) {
  for (const port of ports) {
    const started = Date.now()
    const busy = await pollFor({
      read: () => isPortBusy(port, { connectTimeoutMs }),
      settled: (value) => value === false,
      timeoutMs: backoffMs,
      interval: intervalMs,
      label: `port ${port} 被釋放`,
    })
    if (!busy) continue

    const waited = Date.now() - started
    const holder = holderOf(port)
    throw new PreflightError(
      `[probe:${name}] debugging port ${port} 被佔用（已等待 ${seconds(waited)}仍未釋放）\n` +
        `  持有者：${holder ?? '查不出來（`ss` 不可用或無權讀取行程資訊）'}\n` +
        `  清掉它再跑。**這不是產物問題** —— 那一種的訊息會叫你去重新建置。`,
    )
  }
}
