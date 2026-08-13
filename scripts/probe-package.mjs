/**
 * desktop-packaging：驗證**打包產物本身**。
 *
 * 其餘九支探針驗的是 `electron .` 載入 `out/` 的那份執行 —— 那**不是被出貨的東西**。
 * 出貨的是一個 asar：主行程、preload 與 renderer 全部住在一個唯讀的虛擬檔案系統裡，
 * 而其中一個相依（node-pty 的 `.node`）**在那裡面根本無法載入**。這支探針是唯一會發現
 * 那件事的東西。
 *
 * ## 四條斷言，以及為什麼是這四條
 *
 * | 斷言 | 打包可能怎麼弄壞它 |
 * |---|---|
 * | AppImage 存在且可執行 | 目標設定被改掉、`directories.output` 改了 |
 * | 產物脫離 repo 仍可執行 | `files` 漏了東西，於是產物靠著 repo 工作副本才跑得起來 |
 * | `document.title` 為產品名 | ESM 進入點在 asar 內解析失敗、`loadFile` 的相對路徑跑掉 |
 * | 建立 session 後真的有一個 pty | **`asarUnpack` 漏掉 node-pty ⇒ `dlopen` 失敗** |
 * | production CSP 生效 | `onHeadersReceived` 對 asar 內的 `file://` 不觸發 |
 *
 * ## pty 的判準是「行程 + 副作用」，不是「畫面上的輸出」
 *
 * 直覺會想斷言「終端畫面出現了指令的輸出」。**不採用**，理由不是省事：
 *
 * 1. **讀畫面的手法綁死 renderer 種類。** `.xterm-rows` 只存在於 DOM renderer，GPU renderer
 *    把畫面畫進 `<canvas>` 之後它就消失了 —— 而它讀不到時**回空字串**，於是斷言會以一種
 *    看起來像產品壞掉的方式紅掉。`probe:terminal` 為此改走「產品自己的複製路徑」（拖曳選取
 *    → 右鍵複製 → 讀剪貼簿），那是一整套帶著座標校準的機制。
 * 2. **而那一整套機制驗的東西與打包無關。** pty → 主行程 → IPC → renderer → xterm 這條路徑
 *    **全是 JavaScript**，全部住在 asar 內，而「asar 內的 JS 載入正常」已經由
 *    `document.title` 那條斷言證明了。打包唯一能弄壞的是 **native 模組的載入**。
 *
 * 因此判準是：**pty 行程真的存在**（`dlopen` 成功、`forkpty` 成功），且**它底下的 shell 真的
 * 執行了我們送進去的指令**（雙向可用）。後者以「指令在磁碟上留下的副作用」判定 ——
 * 一個不受 renderer 種類影響、也不會在讀不到時靜默回空的判準。
 *
 * ## 為什麼不併進 `npm run test:e2e`
 *
 * 它得先跑一次完整打包（數分鐘）。`test:e2e` 已經十幾分鐘 —— 再加上去會把它推到沒有人願意
 * 跑的長度，而一個沒有人跑的驗收等於不存在。這支屬於**換版前跑一次**的層級。
 *
 * 用法：npm run probe:package
 *       PROBE_PACKAGE_APPIMAGE=<path> node scripts/run-probe.mjs package   # 迭代時重用既有產物
 * 結束碼 0 表示全部 scenario 通過。
 */
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { check, connect, pollFor, pollUntil, waitForPageTarget } from './lib/cdp.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { copy } from './lib/copy.mjs'
import { MOUNTED_WITHOUT_VISIBILITY as MOUNTED, describeMounted } from './lib/mounted.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const DEBUG_PORT = PROBE_PORTS.package.main
const STARTUP_TIMEOUT_MS = 60_000

/** pty 的 shell。固定寫死，才數得出它的行程（見 `ptyPids`）。 */
const SHELL_PATH = '/bin/sh'

/**
 * 把一個獨一無二的字串塞進 app 的環境，pty 會整份繼承 —— 於是讀 `/proc` 底下每個行程的
 * `environ` 就認得出「這一輪」開出來的 pty，不會把別處跑著的 shell 算進來。
 */
const MARKER_VAR = 'SPEKTERM_PROBE_MARKER'
const marker = `spekterm-package-${process.pid}-${process.hrtime.bigint()}`

// ── 產物 ────────────────────────────────────────────────────────────────────

function findAppImage() {
  const override = process.env.PROBE_PACKAGE_APPIMAGE
  if (override) return override

  const releaseDir = join(repoRoot, 'release')
  if (!existsSync(releaseDir)) return null

  const found = readdirSync(releaseDir)
    .filter((name) => name.endsWith('.AppImage'))
    .sort()
  return found.length > 0 ? join(releaseDir, found.at(-1)) : null
}

/**
 * AppImage 執行時會把自己掛載到 `/tmp/.mount_XXXXXX`。強殺行程可能留下掛載點，
 * 而殘留的掛載點會讓後續的打包或執行以看似無關的方式失敗。
 */
function mountPoints() {
  try {
    return new Set(readdirSync('/tmp').filter((name) => name.startsWith('.mount_')))
  } catch {
    return new Set()
  }
}

/**
 * 帶著 marker 的 pty shell 行程。
 *
 * 認定方式與 `probe:terminal` 同源：pty 自主行程繼承 env（marker 在裡面），而 `cmdline` 的
 * 第一段是被 spawn 的可執行檔。**讀 `/proc` 而不是 `ps`** —— 後者會截斷長 argv。
 */
function ptyPids() {
  const pids = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      if (!readFileSync(`/proc/${entry}/environ`, 'utf8').includes(marker)) continue
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
      // `cmdline` 以 NUL 分隔。**這裡必須是 escape 序列，不能是字面的 NUL 位元組** ——
      // 後者會讓 `git diff` 與 `grep` 對整個檔案瞎掉，而 grep 是回空 + exit 1，連
      // 「binary file」都不說（見 CLAUDE.md；本檔在初版就踩了一次）。
      if (cmdline.split('\0')[0] === SHELL_PATH) pids.push(Number(entry))
    } catch {
      // 行程在我們讀它的途中結束了 —— 那就不算數。
    }
  }
  return pids
}

async function waitForPty(expected, timeoutMs = 20_000) {
  return pollFor({
    read: () => ptyPids(),
    settled: (pids) => pids.length === expected,
    timeoutMs,
    interval: 200,
    label: `waitForPty（期待 ${expected} 個 pty）`,
  })
}

// ── 頁面上的量測 ─────────────────────────────────────────────────────────────

const RECT_OF = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/** rail 上那個不隸屬任何 folder 的固定項目的「建立 session」入口。 */
const GLOBAL_NEW_SESSION_RECT = RECT_OF(
  `aside[aria-label="${copy('rail.label')}"] [aria-label="${copy('rail.newSessionIn', { name: copy('rail.globalName') })}"]`,
)

const TERMINAL_RECT = RECT_OF(`section[aria-label="${copy('stage.terminal')}"]`)

const MENU_ITEM_RECT = (text) => `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return null
  const item = [...menu.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(text)}))
  if (!item) return null
  const r = item.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/**
 * CSP violation 收集器 —— 違規事件的 `originalPolicy` 就是**實際施加到這個 renderer 的**
 * 完整政策字串。
 *
 * **注入時機有兩個相反的夾制，而「越早越好」是錯的**（實測踩過，紅了一輪）：
 *
 * - 必須在觸發違規的請求**之前** —— 它只捕捉其後派送的違規。
 * - 但也必須在**頁面導航完成之後**。Electron 的 renderer 起初是 `about:blank`，隨後才導航到
 *   asar 內的 `index.html`；在那之前注入，listener 會**隨著舊 context 一起消失**。
 *
 * 失效方式是最難解讀的那種：政策明明生效（inline script 確實被擋），但收集器讀到空字串，
 * 於是斷言以「CSP 不存在」的形狀紅掉 —— 指向一個根本不存在的安全退化。
 */
const CSP_ARM = `(() => {
  window.__csp = ''
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp = e.originalPolicy || window.__csp
  })
  return true
})()`

/** `connect-src 'self'` 一定擋下它，於是我們拿得到實際政策。 */
const TRIGGER_CSP = `fetch('https://example.com/csp-probe').catch(() => {})`

async function realClick(client, rect) {
  const x = Math.round(rect.x + rect.width / 2)
  const y = Math.round(rect.y + rect.height / 2)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  for (const type of ['mousePressed', 'mouseReleased']) {
    await client.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    })
  }
}

/**
 * 送一行指令給終端。
 *
 * **Enter 必須是一次真正的按鍵事件** —— 實測（`probe:terminal`）把 `\r` 併進 `insertText`
 * 的文字裡，字元確實送達 pty、終端上也看得到回顯，但 shell 從未執行那一行：xterm 的換行是在
 * keydown 上判讀的，不是從 textarea 的內容剖析出來的。
 */
async function typeLine(client, text) {
  await client.send('Input.insertText', { text })
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/** 輪詢一個**磁碟上的**條件（`pollUntil` 求值的是頁面裡的 expression，這裡要的不是那個）。 */
async function pollDisk(predicate, timeoutMs, label = 'pollDisk（磁碟上的條件）') {
  return pollFor({ read: () => predicate(), settled: (value) => value === true, timeoutMs, label })
}

// ── 驗收 ────────────────────────────────────────────────────────────────────

const results = []
const workDir = mkdtempSync('/tmp/spekterm-package-probe-')
const profileDir = join(workDir, 'profile')
const mountsBefore = mountPoints()

let app = null
let stderr = ''

console.log('desktop-packaging 驗收：\n')

try {
  const source = findAppImage()
  if (!source) {
    throw new Error(
      '找不到 AppImage —— 先跑 `npm run dist:linux`，或以 PROBE_PACKAGE_APPIMAGE 指定路徑',
    )
  }

  // 「產出可執行的 AppImage」：檔案存在，且對擁有者可執行。
  const mode = statSync(source).mode
  check(results, '打包指令產出可執行的 AppImage', (mode & 0o111) !== 0,
    `${source}（mode ${(mode & 0o777).toString(8)}）`)

  /**
   * **複製到 repo 之外再執行** —— 這正是「與 repo 脫鉤」那條 requirement 的驗收方式。
   * 就地執行 `release/…` 驗不到它：產物仍待在工作副本裡，任何對 repo 檔案的殘留相依
   * 都會**照常滿足**，於是 `files` 漏了東西也看不出來。
   */
  const appImage = join(workDir, 'Spekterm.AppImage')
  copyFileSync(source, appImage)
  chmodSync(appImage, 0o755)

  // pty 自主行程繼承 env：SHELL 決定 spawn 什麼，marker 讓我們清點得出它的行程。
  const env = { ...process.env, SHELL: SHELL_PATH, [MARKER_VAR]: marker }
  // production CSP 的前提是「沒有 dev server」。`electron-vite dev` 會把這個變數洩漏到 shell，
  // 而繼承到它的話，打包產物會拿到 **dev 政策** —— 那條斷言就會以最難解讀的方式紅掉。
  delete env.ELECTRON_RENDERER_URL

  const child = spawn(
    appImage,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profileDir}`,
      ...electronExtraArgs(),
    ],
    { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'], env, detached: true },
  )
  app = child
  child.stderr?.on('data', (chunk) => (stderr += chunk))
  child.stdout?.on('data', (chunk) => (stderr += chunk))

  const target = await waitForPageTarget(DEBUG_PORT, STARTUP_TIMEOUT_MS)
  const client = await connect(target)

  /**
   * 視窗載入成功同時證明了 **ESM 進入點在 asar 內解析成功**：`package.json` 宣告
   * `type: "module"`，主行程產物是 ESM、preload 是 `.mjs` —— 解析失敗的話 app 根本開不起來。
   */
  const title = await pollUntil(client, 'document.title', (value) => Boolean(value))
  check(results, '打包產物開啟視窗並載入 renderer', title === 'spekterm', `title="${title}"`)
  check(results, '產物脫離 repo 仍可執行', !appImage.startsWith(repoRoot), appImage)

  await pollUntil(client, MOUNTED, (value) => value?.ok === true, 20_000)

  // ── production CSP ────────────────────────────────────────────────────────
  // **導航完成之後**才武裝收集器（見 `CSP_ARM` 的說明）—— 此時 MOUNTED 已成立。
  await client.evaluate(CSP_ARM)
  await client.evaluate(TRIGGER_CSP)
  const policy = await pollUntil(client, 'window.__csp ?? ""', (value) => Boolean(value), 8000)
  const scriptSrc = String(policy)
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src'))

  check(results, '打包產物的 renderer 收到 production CSP',
    scriptSrc === "script-src 'self'" && !String(policy).includes('ws:'),
    `script-src="${scriptSrc ?? '(缺)'}"`)

  // ── pty ───────────────────────────────────────────────────────────────────
  /**
   * **走全域項目，不加任何 folder** —— 它不需要 workspace 裡有東西，於是這一段完全不必碰
   * 檔案對話框（那是原生 UI，CDP 打不到）。
   */
  const plus = await pollUntil(client, GLOBAL_NEW_SESSION_RECT, (value) => value !== null, 15_000)
  if (!plus) throw new Error('rail 上找不到全域項目的建立 session 入口')
  await realClick(client, plus)

  const shellItem = await pollUntil(client, MENU_ITEM_RECT(copy('sessions.spawnShell')), (v) => v !== null, 6000)
  if (!shellItem) throw new Error('spawn 選單沒有出現')
  await realClick(client, shellItem)

  const pids = await waitForPty(1)
  check(results, '打包產物中建立的 session 產生了一個真實 pty', pids.length === 1,
    `pty 行程數 = ${pids.length}${pids.length === 0 ? '（native 模組載入失敗、或 pty 配置失敗時就是這個徵狀）' : ''}`)

  // **先把焦點交給終端** —— 剛才點的是選單，`insertText` 會送到那裡去。
  const terminal = await pollUntil(client, TERMINAL_RECT, (value) => value !== null, 6000)
  if (terminal) await realClick(client, terminal)

  /**
   * 雙向可用的判準：指令留在磁碟上的副作用。
   *
   * 它同時排除了「回顯」這個假陽性 —— 字元送達 pty 但 shell 沒有執行時，畫面上一樣看得到
   * 那行字，而檔案不會出現。
   */
  const witness = join(workDir, 'pty-witness.txt')
  const witnessWritten = () =>
    existsSync(witness) && readFileSync(witness, 'utf8').trim() === marker

  await typeLine(client, `printf %s ${marker} > ${witness}`)
  const witnessOk = await pollDisk(witnessWritten, 15_000)
  check(results, '該 session 的 shell 執行了送進去的指令', witnessOk,
    witnessOk ? witness : '副作用未出現（pty 存在，但送進去的指令沒有被執行）')

  client.close()
} catch (error) {
  console.error(`\nprobe 失敗：${error.message}`)
  if (stderr.trim()) console.error(`AppImage stderr:\n${stderr.trim().slice(0, 1200)}`)
  results.push(false)
} finally {
  // 連根拔除 —— 每個子行程的 argv 都帶著獨一無二的 --user-data-dir。
  try {
    if (app?.pid) process.kill(-app.pid, 'SIGKILL')
  } catch {
    // 行程已自行結束
  }
  try {
    execFileSync('pkill', ['-9', '-f', profileDir], { stdio: 'ignore' })
  } catch {
    // pkill 找不到目標時回非零 —— 那正是我們要的狀態
  }

  await sleep(500)

  /**
   * 卸載這一輪新增的 AppImage 掛載點。
   *
   * **兩個實測出來的講究**（初版兩個都漏了，於是留下六個殘留目錄）：
   *
   * - **`-u` 不夠，要 `-uz`（lazy）。** AppImage 正常結束時會自己卸載，但我們是
   *   `SIGKILL` 它 —— 那一瞬間 fd 還沒關，一般卸載會以 device busy 失敗。lazy 卸載
   *   立刻把它從目錄樹分離，等引用歸零再真正收掉。
   * - **卸載之後目錄不會消失。** 掛載點是 AppImage 自己建的空目錄；沒人刪它，`/tmp`
   *   會慢慢長出一堆空殼。
   */
  for (const name of mountPoints()) {
    if (mountsBefore.has(name)) continue
    const mountPath = join('/tmp', name)
    try {
      execFileSync('fusermount', ['-uz', mountPath], { stdio: 'ignore' })
    } catch {
      // 已被 AppImage 自己卸載
    }
    try {
      rmSync(mountPath, { recursive: false, force: true })
    } catch {
      // 還有引用沒歸零 —— 留一個空目錄，無害
    }
  }

  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // 掛載點可能還在收尾 —— 留著也只是一個暫存目錄
  }
}

const passed = results.filter(Boolean).length
console.log(`\n${results.every(Boolean) ? '全部通過' : '有檢查未通過'}（${passed}/${results.length}）`)
process.exit(results.every(Boolean) && results.length > 0 ? 0 : 1)
