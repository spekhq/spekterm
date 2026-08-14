/**
 * 驗證 app-identity 的 spec scenario。
 *
 * **為什麼這支 probe 既不用暫存 profile、也不是 Electron 主行程腳本**（兩條看似更省事的路都是死路）：
 *
 * 1. 不能傳 `--user-data-dir` —— 要驗的正是 `app.getPath('userData')` **實際解析出來的路徑**，
 *    而那個旗標會把待驗的對象本身覆寫掉。其他 probe 用暫存 profile 隔離自己的手法，在這裡會
 *    直接抹掉答案。
 * 2. 不能寫成 `electron scripts/probe-identity.mjs`（像 probe-native 那樣）—— 那種跑法**不會讀
 *    repo 的 package.json**，`app.getName()` 會回退到 Electron 的預設值 `"Electron"`、userData 落在
 *    `~/.config/Electron`。量到的是 Electron 的預設，與我們的宣告無關（實測踩過，全綠的靜態斷言
 *    旁邊掛著兩個與產品無關的 ✗）。
 *
 * 因此：啟動**真正的** `electron .`（不傳 `--user-data-dir`），再從外部觀察它。userData 是外部
 * 可觀察的 —— Electron 會把解析出來的路徑塞進**每個子行程的 argv**（`--user-data-dir=<path>`），
 * 不需要產品程式碼配合吐任何診斷資訊。
 *
 * 收屍：正因為沒有獨一無二的 `--user-data-dir`，CLAUDE.md 記載的 `pkill -f <profile>` 手法在這裡
 * 不適用（沒有那個識別字）。改以 `detached: true` spawn 成 process group leader，再 `kill(-pid)`
 * 殺整組 —— 否則 electron wrapper 底下的真行程會變孤兒，佔著 debugging port。
 *
 * 注意：本 probe 使用**真實的** userData 目錄（`~/.config/Spekterm`）。它只讀不寫，但若你的 app
 * 正開著同一個目錄，Chromium 的 singleton lock 可能造成干擾 —— 跑之前先關掉 app。
 *
 * 用法：npm run probe:identity
 * 結束碼 0 表示全部 scenario 通過。
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { check, connect, pollUntil, waitForPageTarget } from './lib/cdp.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { quitAndWait } from './lib/quit.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// 這支啟動兩次，**兩個 port 各自明寫**（此前是 `DEBUG_PORT` 與 `DEBUG_PORT + 1`，而衍生出來的
// 那一個從來不在任何一份表上 —— 它撞著 `probe-terminal` 的 build port，沒有東西看得見）。
const DEFAULT_PORT = PROBE_PORTS.identity.default
const XDG_HOME_PORT = PROBE_PORTS.identity.xdgHome
const STARTUP_TIMEOUT_MS = 30_000

const EXPECTED_NAME = 'spekterm'
const EXPECTED_PRODUCT_NAME = 'Spekterm'
const EXPECTED_APP_ID = 'com.spekterm.app'
const EXPECTED_TITLE = 'spekterm'

/**
 * 從行程群組的 argv 讀出 Electron 解析出來的 userData 路徑。
 *
 * Electron 把它傳給每個子行程（gpu-process / renderer / utility），因此不必問主行程 ——
 * 主行程自己的 argv 反而沒有（我們沒傳這個旗標）。
 */
function readUserDataFromProcessGroup(pgid) {
  const out = execFileSync('ps', ['-eo', 'pgid=,args='], { encoding: 'utf8' })
  for (const line of out.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [pgidField, ...rest] = trimmed.split(/\s+/)
    if (Number(pgidField) !== pgid) continue
    const match = rest.join(' ').match(/--user-data-dir=(\S+)/)
    if (match) return match[1]
  }
  return null
}

/**
 * 啟動一次真正的 `electron .`，回報它的 `document.title` 與**解析出來的** userData 路徑。
 *
 * 抽成函式是為了能啟動第二次 —— 見下方 `XDG_CONFIG_HOME` 那一段。
 */
async function launchAndObserve({ port, extraEnv = {} }) {
  const electron = spawn(
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
    [`--remote-debugging-port=${port}`, ...electronExtraArgs(), '.'],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
    },
  )

  let stderr = ''
  electron.stderr.on('data', (chunk) => (stderr += chunk))

  try {
    const target = await waitForPageTarget(port, STARTUP_TIMEOUT_MS)
    const client = await connect(target)
    // CDP target 一就緒就讀會拿到空字串 —— 那時文件還沒解析到 <title>。等它非空。
    const title = await pollUntil(client, 'document.title', (value) => Boolean(value))
    client.close()

    // 子行程要等 renderer 起來才齊；CDP target 已就緒即代表 renderer 存在。
    await sleep(500)
    return { title, userData: readUserDataFromProcessGroup(electron.pid) }
  } catch (error) {
    // electron 起不來時，它自己的 stderr 是唯一說得出原因的東西 —— 別讓它跟著函式一起消失。
    if (stderr.trim()) console.error(`electron stderr:\n${stderr.trim().slice(0, 800)}`)
    throw error
  } finally {
    // 殺整個 process group：對 wrapper 送訊號殺不到它 spawn 的真行程
    //（會變孤兒、佔著 debugging port）。
    try {
      if (process.platform === 'win32') await quitAndWait(electron)
      else process.kill(-electron.pid, 'SIGKILL')
    } catch {
      // 行程已自行結束
    }
  }
}

const results = []

// 產品身分的靜態宣告 —— 這幾個值是 Phase 6 打包的輸入，且發佈後即凍結。
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

console.log('app-identity 驗收：\n')

check(results, 'package 名稱為 unscoped 的產品名',
  pkg.name === EXPECTED_NAME && !pkg.name.startsWith('@'), `name="${pkg.name}"`)
check(results, 'package.json 宣告 productName',
  pkg.productName === EXPECTED_PRODUCT_NAME, `productName="${pkg.productName ?? '(缺)'}"`)
check(results, 'package.json 宣告 build.appId',
  pkg.build?.appId === EXPECTED_APP_ID, `appId="${pkg.build?.appId ?? '(缺)'}"`)

// appId 進 macOS 的 CFBundleIdentifier，慣例是三段以上的反向域名。
const appIdSegments = (pkg.build?.appId ?? '').split('.').filter(Boolean)
check(results, 'appId 為合法的反向域名形狀（至少三段）', appIdSegments.length >= 3,
  `${appIdSegments.length} 段`)

let exitCode = 1
let xdgHome = null

try {
  const observed = await launchAndObserve({ port: DEFAULT_PORT })

  // 視窗標題跟隨品牌書寫（全小寫），與 productName 的 `Spekterm` 不同源 —— 兩者不需一致。
  check(results, 'renderer 的 document.title 為產品名',
    observed.title === EXPECTED_TITLE, `title="${observed.title}"`)

  if (!observed.userData) {
    check(results, 'userData 落在產品名的目錄下', false,
      '讀不到任何子行程的 --user-data-dir（行程樹提早結束？）')
  } else {
    // Electron 的 app.getName() 優先讀 productName、缺才退回 name —— productName 因此不只是
    // 顯示名稱，它同時決定使用者設定的落點。
    check(results, 'userData 落在產品名的目錄下',
      basename(observed.userData) === EXPECTED_PRODUCT_NAME, observed.userData)
    check(results, 'userData 路徑不含舊名（@spek / workspace）',
      !observed.userData.includes('@spek') && !observed.userData.includes('workspace'),
      observed.userData)
  }

  /**
   * ## `XDG_CONFIG_HOME` 確實改變 userData 的解析結果
   *
   * **這一段驗的是 Electron 的行為，不是我們自己的程式碼** —— 而那正是它存在的理由。
   *
   * `desktop-packaging` 讓開發模式與打包產物的設定分家，作法是把 `XDG_CONFIG_HOME` 烤進
   * `npm run dev`（**不改主行程一行**，見該 change 的 design D8）。整條隔離因此**完全建立在
   * 「Electron 遵守這個環境變數」之上**。
   *
   * Electron 升版若改掉它，隔離會**靜默消失**：`dev` script 照常執行、畫面一切正常，設定卻
   * 又寫回 `~/.config/Spekterm`，開始與使用者正在用的那份互相覆蓋。沒有任何東西會紅 ——
   * 除了這一條。
   */
  xdgHome = mkdtempSync('/tmp/spekterm-identity-xdg-')
  const moved = await launchAndObserve({
    port: XDG_HOME_PORT,
    extraEnv: { XDG_CONFIG_HOME: xdgHome },
  })

  if (!moved.userData) {
    check(results, 'XDG_CONFIG_HOME 改變 userData 的解析結果', false,
      '讀不到任何子行程的 --user-data-dir（行程樹提早結束？）')
  } else {
    check(results, 'XDG_CONFIG_HOME 改變 userData 的解析結果',
      moved.userData.startsWith(`${xdgHome}/`) && moved.userData !== observed.userData,
      `${moved.userData}（原本 ${observed.userData}）`)
    // 產品名那一層仍然跟隨 productName —— 換的是父目錄，不是 app 的身分。
    check(results, '移動後的 userData 仍以產品名為最後一段',
      basename(moved.userData) === EXPECTED_PRODUCT_NAME, moved.userData)
  }

  exitCode = results.every(Boolean) ? 0 : 1
} catch (error) {
  console.error(`probe 失敗：${error.message}`)
} finally {
  if (xdgHome) {
    try {
      rmSync(xdgHome, { recursive: true, force: true })
    } catch {
      // 暫存目錄留著也無妨
    }
  }
}

console.log(`\n${exitCode === 0 ? '全部通過' : '有檢查未通過'}（${results.filter(Boolean).length}/${results.length}）`)
process.exit(exitCode)
