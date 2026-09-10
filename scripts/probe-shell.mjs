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
import { check, connectToApp, pollUntil } from './lib/cdp.mjs'
import { copy } from './lib/copy.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { quitAndWait } from './lib/quit.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'

const DEBUG_PORT = PROBE_PORTS.shell.main
const STARTUP_TIMEOUT_MS = 30_000

/** renderer 內求值：全部取自真實的 DOM 與 preload 介面，沒有專為驗收而生的鉤子。 */
const PROBE_EXPRESSION = `(async () => {
  const root = document.getElementById('root')
  const nav = document.querySelector('nav[aria-label="${copy('activityBar.label')}"]')
  if (!root || root.children.length === 0 || !nav) return { mounted: false }

  const lang = document.documentElement.lang

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
    lang,
    title: document.title,
    navDisplay: navStyle.display,
    navBackground: navStyle.backgroundColor,
    regions: {
      activityBar: Boolean(nav),
      rail: Boolean(document.querySelector('aside[aria-label="${copy('rail.label')}"]')),
      mainStage: Boolean(document.querySelector('main[aria-label="${copy('stage.label')}"]')),
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
          // 遞迴列舉（quick-open）。邊界要求見 filesystem-access 的 listFiles 三條 requirement。
          'listFiles',
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
          'getWorktreeRoots',
          'getWorktrees',
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
    //
    // reorder 於 workspace-reordering 引入（workspace-folders 規格）：folder 的順序是使用者
    // 決定的 workspace 狀態，權威在主行程。它只收識別碼與目標位置 —— 沒有路徑詞彙，也不能
    // 藉此加入或移除 folder（加入 folder 的唯一路徑仍是原生對話框）。
    //
    // setPinned 於 rail-pinned-repos 引入（rail-pinning 規格）：與 reorder 同一族 —— 只收
    // 識別碼與一個布林，沒有路徑詞彙，也加不進、移不掉任何 folder。
    surplusFolderKeys: Object.keys(api?.folders ?? {}).filter(
      (key) => !['list', 'add', 'remove', 'reorder', 'setPinned', 'onChanged'].includes(key),
    ),
    // terminal 的能力。這個 namespace 一度也完全沒有守衛（同 folders 當年的漏洞）——
    // 於是 session-restore 往它加了四個 method 而不會被任何東西擋下。補上。
    //
    // wake／restore／persist／snapshot 於 session-restore 引入（session-persistence 規格）：
    // 它們的邊界要求是「持久化不得把路徑詞彙交給 renderer」—— 介面上因此沒有任何路徑參數，
    // 也沒有對話識別碼（那是主行程的知識）。wake 只收一個 sessionId。
    //
    // watchStatus／onStatus 於 panel-drive-and-shell-affordances 引入（claude-status-bridge
    // 規格）：狀態列所需、且只有主行程取得到的事實（pty 的 cwd、git 工作區、agent 回報的用量）。
    // watchStatus 只收一個 sessionId（null ＝停止輪詢），沒有路徑詞彙。
    // （這段註解在**模板字串之內** —— 不要在這裡用反引號，它會把整個模板提前結束。）
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
          'watchStatus',
          'onStatus',
        ].includes(key),
    ),
    // **這道守衛看不到簽名改變，而那個缺口補不起來（實測）。**
    //
    // 它比的是 key 的集合差 —— 給 create 加一個參數不會改變 key 集合，它一聲都不會響。
    // session-in-worktree 正是這樣加了工作目錄識別碼（那是 renderer 唯一能影響 session 初始
    // cwd 的途徑）。
    //
    // 試過以 create.length 釘住參數個數：**contextBridge 複製函式時把 Function.length
    // 抹成 0**，renderer 這側量不到真正的 arity（實測 arity=0，不論 preload 那側宣告幾個參數）。
    // 於是那條斷言不是守衛，是一盞恆綠的燈 —— 已移除。
    //
    // 缺口由 code review 與 spec 承擔（terminal-sessions：「建立介面不接受任何路徑參數」，
    // 且有一條 scenario 明列它接受哪些參數）。比照 OSC 8 linkHandler 與真實鍵盤的先例。
    // settings 的能力（terminal-rendering-and-preferences，terminal-preferences 規格）。同一條
    // 白名單原則 —— 從第一天就補上守衛，避免重蹈 folders.*／terminal.* 當年「整個 namespace 沒有
    // 守衛」的覆轍。get／setTerminalFont：值由主行程的 store 清理／夾制，介面上沒有任何路徑詞彙。
    // setAgentView 於 global-conversation-view-preference 引入（agent-conversation-view 規格）：
    // 值是兩個字面值之一，白名單判定在主行程的 store，介面上同樣沒有路徑詞彙。
    // setAgentStatus 於 panel-drive-and-shell-affordances 引入（terminal-preferences 規格）：
    // 與 GPU 加速同型的布林偏好，值同樣由主行程的 store 承接，介面上沒有路徑詞彙。
    surplusSettingsKeys: Object.keys(api?.settings ?? {}).filter(
      (key) =>
        !['get', 'setTerminalFont', 'setGpuAcceleration', 'setAgentStatus', 'setAgentView', 'listMonospaceFonts'].includes(
          key,
        ),
    ),
    // **頂層 namespace 的守衛。** 上面每一條 surplus*Keys 都只看某個既有 namespace 的內部
    // —— 於是「加一整個新的 namespace」在此前是**完全沒有守衛**的（folders 與 terminal 當年
    // 就是這樣長出來的，兩次都是事後才補上各自的清單）。少了這一條，每加一個 namespace 就要有
    // 人記得同時加一條斷言，而「記得」不是一種機制。
    //
    // （本區塊在一個模板字串之內 —— 註解裡不可出現反引號，它會把字串提前結束。）
    //
    // panel 於 panel-coordinate-per-folder 引入（side-panel-source 規格）：側欄座標的讀取與
    // 落盤。介面上沒有任何路徑詞彙 —— 工作目錄以不可逆識別碼表示，且驗證在主行程的寫入入口。
    //
    // insights 於 agent-conversation-insights 引入（conversation-archive / conversation-insights
    // 規格）：對話計量的彙總與掃描狀態。**刻意開自己的 namespace 而不是掛在 fs 之下** ——
    // filesystem-access 有一條 scenario 逐一列舉了 fs 上允許存在的成員，而「掃描器讀檔案」
    // 很容易讓人直覺往那裡放。介面上沒有任何路徑詞彙：專案以不可逆雜湊識別，
    // 錯誤是碼不是句子，訊息原文只在兩個各有上限的位置出現。
    surplusApiKeys: Object.keys(api ?? {}).filter(
      (key) =>
        ![
          'fs',
          'openspec',
          'folders',
          'terminal',
          'settings',
          'clipboard',
          'app',
          'shell',
          'panel',
          'insights',
          'conversation',
        ].includes(key),
    ),
    // conversation 於 agent-transcript-view 引入（agent-transcript-stream / agent-input-bridge
    // 規格）：對話 view 的內容訂閱、等待狀態、以及送出。**無路徑詞彙** —— 送出的是 sessionId，收回的事件由主行程以白名單組出，
    // 不含任何絕對路徑（該規格明文，且有帶對照組的單元測試）。
    // **送出的閘在主行程**：介面上有這個能力不構成許可 —— 未知或等待選擇時主行程一律拒絕，
    // 與 fs 邊界同哲學（preload 與 renderer 同屬一個行程樹，在那裡檢查等同沒有檢查）。
    // （本區塊在一個模板字串之內 —— 註解裡不可出現反引號，它會把字串提前結束。）
    // **刻意不掛在 terminal 之下**：那個 namespace 的每一個成員都對應一顆 pty，而這裡一個位元組
    // 都不寫進 pty；混在一起會讓 terminal-sessions 那條逐一列舉的 scenario 失去意義。
    surplusConversationKeys: Object.keys(api?.conversation ?? {}).filter(
      (key) => !['watch', 'onUpdate', 'onWait', 'send'].includes(key),
    ),
    surplusPanelKeys: Object.keys(api?.panel ?? {}).filter((key) => !['get', 'persist'].includes(key)),
    // **insights 底下也要逐成員列舉。** 只在頂層 namespace 清單裡登記的話，
    // 底下再加幾個方法這支探針一聲都不會響 —— 而讀後感往這裡加了四個會送出使用者訊息的入口。
    surplusInsightsKeys: Object.keys(api?.insights ?? {}).filter(
      (key) => !['get', 'refresh', 'reportPreview', 'reportList', 'reportRead', 'reportGenerate'].includes(key),
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
  [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`, ...electronExtraArgs(), '.'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, shell: process.platform === 'win32' },
)

let stderr = ''
electron.stderr.on('data', (chunk) => (stderr += chunk))

const results = []
let exitCode = 1

try {
  const client = await connectToApp(DEBUG_PORT, { targetTimeoutMs: STARTUP_TIMEOUT_MS })

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

  // 文件宣告的語言必須與 UI 一致（`ui-localization`）。`lang` 不只是形式 —— 它決定字型的
  // fallback 與螢幕閱讀器的發音。
  //
  // **量測必須併進 `PROBE_EXPRESSION`** —— `client` 在它之後就 `close()` 了。對已關閉的
  // WebSocket 呼叫 `evaluate`，訊息沒有人接、`send` 的 Promise **永遠不會 resolve**：
  // 不拋錯、不逾時，探針就這樣無限等待下去（實測：卡死十分鐘，看起來像 electron 啟動很慢）。
  check(results, '文件宣告的語言與 UI 一致', r?.lang === 'en', `lang="${String(r?.lang)}"`)
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
  check(results, 'settings 介面只暴露已定義邊界要求的能力',
    r?.surplusSettingsKeys?.length === 0,
    r?.surplusSettingsKeys?.length ? `多出：${r.surplusSettingsKeys.join(', ')}` : '無多餘能力')
  check(results, 'panel 介面只暴露已定義邊界要求的能力',
    r?.surplusPanelKeys?.length === 0,
    r?.surplusPanelKeys?.length ? `多出：${r.surplusPanelKeys.join(', ')}` : '無多餘能力')
  check(results, 'insights 介面只暴露已定義邊界要求的能力',
    r?.surplusInsightsKeys?.length === 0,
    r?.surplusInsightsKeys?.length ? `多出：${r.surplusInsightsKeys.join(', ')}` : '無多餘能力')
  check(results, 'conversation 介面只暴露已定義邊界要求的能力',
    r?.surplusConversationKeys?.length === 0,
    r?.surplusConversationKeys?.length ? `多出：${r.surplusConversationKeys.join(', ')}` : '無多餘能力')
  // 這一條守的是「有沒有人偷偷加了一整個 namespace」—— 其餘 surplus* 全都只看既有 namespace
  // 的內部，加一個新的它們一聲都不會響。
  check(results, 'preload 未暴露任何未經定義的頂層 namespace',
    r?.surplusApiKeys?.length === 0,
    r?.surplusApiKeys?.length ? `多出：${r.surplusApiKeys.join(', ')}` : '無多餘 namespace')

  exitCode = results.every(Boolean) ? 0 : 1
} catch (error) {
  console.error(`probe 失敗：${error.message}`)
  if (stderr.trim()) console.error(`electron stderr:\n${stderr.trim().slice(0, 800)}`)
} finally {
  await quitAndWait(electron)
  rmSync(profileDir, { recursive: true, force: true })
}

console.log(`\n${exitCode === 0 ? '全部通過' : '有檢查未通過'}（${results.filter(Boolean).length}/${results.length}）`)
process.exit(exitCode)
