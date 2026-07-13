/**
 * 驗證 workspace-app-shell 的 spec scenario。
 *
 * 以 CDP 連進執行中的 app，斷言全部落在 renderer 的**真實狀態**上：直接呼叫 preload
 * 暴露的 API、量測真實版面元素的 computed style。Phase 0 曾在產品 UI 上掛 `data-*`
 * 屬性供這支腳本讀取 —— 那是「不在產品程式碼裡塞測試分支」這條原則的軟性違反：
 * 分支沒有，但為了驗收而存在的 UI 屬性有。診斷頁退場後一併修正。
 *
 * 用法：npm run probe:shell
 * 結束碼 0 表示全部 scenario 通過。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, connect, pollUntil, waitForPageTarget } from './lib/cdp.mjs'

const DEBUG_PORT = 9222
const STARTUP_TIMEOUT_MS = 30_000

/** renderer 內求值：全部取自真實的 DOM 與 preload 介面，沒有專為驗收而生的鉤子。 */
const PROBE_EXPRESSION = `(async () => {
  const root = document.getElementById('root')
  const nav = document.querySelector('nav[aria-label="活動列"]')
  if (!root || root.children.length === 0 || !nav) return { mounted: false }

  const navStyle = getComputedStyle(nav)
  const api = globalThis.workspace

  let folders = null
  let apiError = null
  try {
    folders = await api.folders.list()
  } catch (error) {
    apiError = String(error)
  }

  return {
    mounted: true,
    title: document.title,
    navDisplay: navStyle.display,
    navBackground: navStyle.backgroundColor,
    regions: {
      activityBar: Boolean(nav),
      rail: Boolean(document.querySelector('aside[aria-label="工作區"]')),
      mainStage: Boolean(document.querySelector('main[aria-label="主舞台"]')),
    },
    requireExposed: typeof require !== 'undefined',
    processExposed: typeof process !== 'undefined',
    foldersIsArray: Array.isArray(folders),
    apiError,
    listDirIsFunction: typeof api?.fs?.listDir === 'function',
    // 白名單原則：介面上只能有「已為其定義邊界要求」的能力。
    // 這不是一份會隨版本增長的清單 —— 每加一個名字，都得先有一條 requirement 定義它的邊界。
    //
    // 寫入類的五個能力於 file-editing-and-crud（Phase 3）引入，其邊界要求見 file-editing
    // 與 file-operations 規格。
    surplusFsKeys: Object.keys(api?.fs ?? {}).filter(
      (key) =>
        ![
          'listDir',
          'readFile',
          'watch',
          'unwatch',
          'onWatchEvent',
          'writeFile',
          'createFile',
          'createDirectory',
          'deleteEntry',
          'rename',
        ].includes(key),
    ),
    // OpenSpec 的唯讀存取（openspec-data-access）。同一條白名單原則 —— 這裡沒有任何寫入能力，
    // 側欄是檢視，改檔走 agent 或 Files 身分。
    surplusOpenSpecKeys: Object.keys(api?.openspec ?? {}).filter(
      (key) =>
        ![
          'getOverview',
          'getSpecs',
          'getSpec',
          'getSpecAtChange',
          'getChanges',
          'getChange',
          'getGraphData',
          'onChanged',
        ].includes(key),
    ),
    // workspace folder 的清單與其推送更新。同一條白名單原則。
    //
    // 這個 namespace 一度**完全沒有守衛**（本檢查只涵蓋 fs.* 與 openspec.*）—— 於是往
    // folders 加 method 不會被任何東西擋下。那是守衛的漏洞，不是許可：白名單原則的重點是
    // 「介面上只能有已為其定義邊界要求的能力」，漏掉一整個 namespace 等於它沒有白名單。
    //
    // onChanged 於 rail-legibility-and-repo-row 引入（repo-branch 規格）：分支在 app 之外
    // 被切換時，rail 必須自己更新 —— 那需要一個推送通道。它只送 folder 清單，不含任何路徑。
    surplusFolderKeys: Object.keys(api?.folders ?? {}).filter(
      (key) => !['list', 'add', 'remove', 'onChanged'].includes(key),
    ),
    // terminal 的能力。這個 namespace 一度也完全沒有守衛（同 folders 當年的漏洞）——
    // 於是 session-restore 往它加了四個 method 而不會被任何東西擋下。補上。
    //
    // wake／restore／persist／snapshot 於 session-restore 引入（session-persistence 規格）：
    // 它們的邊界要求是「持久化不得把路徑詞彙交給 renderer」—— 介面上因此沒有任何路徑參數，
    // 也沒有對話識別碼（那是主行程的知識）。wake 只收一個 sessionId。
    surplusTerminalKeys: Object.keys(api?.terminal ?? {}).filter(
      (key) =>
        ![
          'create',
          'wake',
          'write',
          'resize',
          'kill',
          'restore',
          'persist',
          'snapshot',
          'onData',
          'onExit',
        ].includes(key),
    ),
    // symlink 絕不可出現在白名單上。
    //
    // 寫入邊界的 TOCTOU 論證（file-editing-and-crud 的 design D3）整個建立在「renderer 既造不出、
    // 也操縱不到 race 所需的 symlink」之上 —— Node 沒有 openat()，中間目錄段的 race 防不住。
    // 一旦這個名字出現，那份論證即刻失效。
    hasSymlink: typeof api?.fs?.symlink !== 'undefined' || typeof api?.fs?.link !== 'undefined',
    hasDelete: typeof api?.fs?.delete !== 'undefined' || typeof api?.fs?.rm !== 'undefined',
    hasPing: typeof api?.ping !== 'undefined',
    exposesIpcRenderer: typeof api?.ipcRenderer !== 'undefined',
  }
})()`

const profileDir = mkdtempSync(join(tmpdir(), 'spekterm-probe-shell-'))

const electron = spawn(
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
  [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`, '.'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, shell: process.platform === 'win32' },
)

let stderr = ''
electron.stderr.on('data', (chunk) => (stderr += chunk))

const results = []
let exitCode = 1

try {
  const target = await waitForPageTarget(DEBUG_PORT, STARTUP_TIMEOUT_MS)
  const client = await connect(target)

  const r = await pollUntil(client, PROBE_EXPRESSION, (value) => value?.mounted === true)
  client.close()

  // spec 要求「檢查建立視窗時傳入的 webPreferences」—— 靜態驗證那兩個值是被明確寫出的，
  // 而非仰賴 Electron 當版的預設值。與下方的執行期效果檢查互補。
  const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const declaresTrustModel =
    /contextIsolation:\s*true/.test(mainSource) && /nodeIntegration:\s*false/.test(mainSource)

  console.log('workspace-app-shell 驗收：\n')

  check(results, 'webPreferences 明確宣告信任模型', declaresTrustModel,
    'contextIsolation: true, nodeIntegration: false')
  check(results, '主行程開啟視窗且 renderer 載入', Boolean(r?.title), `title="${r?.title ?? ''}"`)
  check(results, 'React 根元件掛載（#root 有子節點）', r?.mounted === true)
  check(results, '三個版面區域同時存在', Boolean(r?.regions?.activityBar && r?.regions?.rail && r?.regions?.mainStage),
    JSON.stringify(r?.regions ?? {}))
  // 不比對特定色值：Tailwind 的輸出色彩空間會變動。判準是「utility class 確實產生了
  // computed style」—— 且量的是真實版面元素（活動列），不是為驗收而生的診斷節點。
  check(results, 'Tailwind 樣式生效',
    r?.navDisplay === 'flex' && Boolean(r?.navBackground) && r.navBackground !== 'rgba(0, 0, 0, 0)',
    `活動列 display=${r?.navDisplay}, background=${r?.navBackground}`)
  check(results, 'preload 白名單 API 可用', r?.foldersIsArray === true && r?.listDirIsFunction === true,
    r?.apiError ?? 'folders.list() 回傳陣列、fs.listDir 為函式')
  check(results, 'renderer 看不到 require', r?.requireExposed === false)
  check(results, 'renderer 看不到 process', r?.processExposed === false)
  check(results, '未暴露 ipcRenderer', r?.exposesIpcRenderer === false)
  check(results, 'Phase 0 的示範 API ping 已移除', r?.hasPing === false)
  check(results, 'fs 介面只暴露已定義邊界要求的能力',
    r?.surplusFsKeys?.length === 0 && !r?.hasDelete,
    r?.surplusFsKeys?.length ? `多出：${r.surplusFsKeys.join(', ')}` : '無未定義邊界的能力')
  check(results, 'fs 介面不暴露 symlink（寫入邊界的 TOCTOU 論證以此為前提）',
    r?.hasSymlink === false)
  check(results, 'openspec 介面只暴露已定義邊界要求的能力',
    r?.surplusOpenSpecKeys?.length === 0,
    r?.surplusOpenSpecKeys?.length ? `多出：${r.surplusOpenSpecKeys.join(', ')}` : '無多餘能力')
  check(results, 'folders 介面只暴露已定義邊界要求的能力',
    r?.surplusFolderKeys?.length === 0,
    r?.surplusFolderKeys?.length ? `多出：${r.surplusFolderKeys.join(', ')}` : '無多餘能力')
  check(results, 'terminal 介面只暴露已定義邊界要求的能力',
    r?.surplusTerminalKeys?.length === 0,
    r?.surplusTerminalKeys?.length ? `多出：${r.surplusTerminalKeys.join(', ')}` : '無多餘能力')

  exitCode = results.every(Boolean) ? 0 : 1
} catch (error) {
  console.error(`probe 失敗：${error.message}`)
  if (stderr.trim()) console.error(`electron stderr:\n${stderr.trim().slice(0, 800)}`)
} finally {
  electron.kill('SIGTERM')
  rmSync(profileDir, { recursive: true, force: true })
}

console.log(`\n${exitCode === 0 ? '全部通過' : '有檢查未通過'}（${results.filter(Boolean).length}/${results.length}）`)
process.exit(exitCode)
