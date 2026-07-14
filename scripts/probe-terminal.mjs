/**
 * `terminal-agent-sessions` 的驗收。
 *
 * 一律透過 CDP 連進真正執行中的 app —— 不在產品程式碼裡塞測試分支，也不為驗收在 UI 上掛
 * `data-*`（分頁以 role/aria 定位）。dev 與 build 兩種模式都跑：前者走 `http://` 的 renderer，
 * 後者走 `file://`。
 *
 * **行程清理是本探針的重點。** pty 的 argv 是 `/bin/sh -l`，**不帶** `--user-data-dir`，
 * 因此收尾的 `pkill -9 -f <profile>` 殺不到它 —— 若 app 沒有自己清乾淨，孤兒 pty 就會留在
 * 行程表上被我們抓到。這正是想要的：孤兒無所遁形。pty 的清點靠注入的 marker（讀
 * `/proc/<pid>/environ`），而非猜 cmdline。
 */
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, dragMouse, pollUntil, waitForPageTarget } from './lib/cdp.mjs'
import { copy, prefixOf } from './lib/copy.mjs'

const BUILD_PORT = 9226
const DEV_PORT = 9227

/** 探針固定用 /bin/sh：可預測、無 bash/zsh profile 的雜訊，且處處存在。 */
const SHELL_PATH = '/bin/sh'

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

function makeFixture() {
  const base = mkTemp('spekterm-terminal-fixture-')
  const repo = join(base, 'repo-a')
  mkdirSync(join(repo, 'openspec'), { recursive: true })
  writeFileSync(join(repo, 'README.md'), '# repo-a\n')
  return { repo }
}

/**
 * stub `claude` 啟動時**在磁碟上留下的憑據** —— 用來斷言我們驅動的確實是自己這支，
 * 不是本機真的 claude。
 *
 * **刻意不看終端畫面。** 「終端上有沒有出現某行字」對掛載時機、backlog 的 flush、以及捲動都
 * 很敏感（dev 的 StrictMode 還會把元件重掛一次）—— 把「spawn 的是哪一支 claude」這個穩固的
 * 事實綁在那種訊號上，只會換來一支時綠時紅的探針。檔案存不存在，是磁碟上的事實。
 */
const STUB_CLAUDE_RECEIPT = 'stub-claude-ran'

/**
 * 一支 stub `claude`，供「claude 目標的 session 會採用 pty 宣告的標題」這組驗收使用。
 *
 * **為什麼需要它。** 本 change 之後，OSC 標題只對 `claude` spawn 目標生效 —— 於是這組驗收
 * 的載體必須是 claude 目標的 session。但我們無法叫真的 `claude` 去宣告一個**指定**的標題，
 * 也不能要求每台機器都裝了它（一支在沒有 claude 的機器上宣稱驗過 OSC 標題的探針，是在說謊），
 * 更不該讓一支探針真的去啟動一個 Claude Code session。
 *
 * **它為什麼是真實的產品路徑。** 產品的 claude 模式是 `$SHELL -l -c claude`：從 **PATH** 解析
 * `claude`，而 pty 的 env 整份繼承 Electron 行程的 `process.env`。探針本來就自己 spawn Electron，
 * 因此走的是產品**原本那條**路徑 —— 動的是環境，不是被出貨的那份程式碼。
 *
 * **`HOME` 也必須換掉，否則 stub 會被真的 claude 蓋過去（實測踩過）。** `-l` 是 login shell，
 * 它會 source `~/.profile`，而 Ubuntu 的預設 `~/.profile` 裡有 `PATH="$HOME/.local/bin:$PATH"`
 * —— 那一行會把**真** claude 的目錄搶到我們前面，於是探針真的把一個 Claude Code session 跑了
 * 起來（分頁標籤變成它宣告的任務描述）。把 `HOME` 指向暫存目錄後：那裡沒有 `~/.profile` 可以
 * source；而且 stub 就放在該 HOME 的 `.local/bin` 裡 —— **即使 profile 真的 prepend
 * `$HOME/.local/bin`，它指的也是我們這個目錄**。兩道保險。
 *
 * stub 本身就是一個互動 shell（`exec "$SHELL" -i`）：於是 claude 目標的 session 行為與 shell
 * session 完全相同，既有的 `typeLine(printf '\\033]0;…')` 一個字都不用改就能驅動它宣告標題。
 * `SHELL` 是 `/bin/sh`（見 `SHELL_PATH`），它**不會**自己送 OSC 標題 —— 標籤因此是確定的。
 */
/**
 * `resumeFails`：模擬 `claude --resume <不存在的對話>` —— 實測它印一行 `No conversation found…`
 * 然後 **exit 1**。這不是邊角：**開了 claude session、還沒跟它講話就關掉 app，claude 根本不寫
 * transcript**，於是重建時的續接必然失敗。自癒是主線路徑，必須驗得到。
 *
 * stub 同時把每次被呼叫的 argv 記進 `calls()` —— 續接（`--resume <id>`）與新建（`--session-id <id>`）
 * 用的是哪個旗標、哪個 id，只有這樣才驗得出來。
 */
function makeStubClaude({ resumeFails = false } = {}) {
  const home = mkTemp('spekterm-terminal-stubhome-')
  const bin = join(home, '.local', 'bin')
  mkdirSync(bin, { recursive: true })

  const receipt = join(home, STUB_CLAUDE_RECEIPT)
  const callLog = join(home, 'claude-calls.log')
  const claude = join(bin, 'claude')

  const lines = [
    '#!/bin/sh',
    `: > "${receipt}"`,
    `echo "$@" >> "${callLog}"`,
    resumeFails
      ? 'if [ "$1" = "--resume" ]; then echo "No conversation found with session ID: $2"; exit 1; fi'
      : '',
    'exec "$SHELL" -i',
  ].filter(Boolean)

  writeFileSync(claude, `${lines.join('\n')}\n`)
  chmodSync(claude, 0o755)

  return {
    home,
    bin,
    receipt,
    calls: () => {
      try {
        return readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
  }
}

function seedProfile(folders) {
  const profile = mkTemp('spekterm-terminal-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: folders.map(([id, path]) => ({ id, path, addedAt: '2026-07-11T00:00:00.000Z' })),
    }),
  )
  return profile
}

// ── pty 行程的清點 ──────────────────────────────────────────────────────────

/**
 * 帶著 marker 的 pty 行程。
 *
 * 以 `environ` 比對 marker（pty 自主行程繼承整個 env），並以 argv[0] 等於我們指定的 shell
 * 排除 electron 自己（它的 environ 同樣帶 marker，但 argv[0] 是 electron）。
 */
function ptyPids(marker) {
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
 * `\/bin\/sh -l -c claude …`（node-pty 直接 spawn 的那個，它沒有 exec）以及它底下 claude 自己
 * 的 shell。一個 login shell session 則只有一個。**拿行程數去斷言「只喚醒了一個 session」，
 * 會把一個好的實作判成壞的。**
 *
 * node-pty spawn 的恆是 `$SHELL -l …` —— 以 `-l` 認出領頭行程，數量就等於 session 數。
 */
function ptySessionPids(marker) {
  return ptyPids(marker).filter((pid) => {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
      return argv[1] === '-l'
    } catch {
      return false
    }
  })
}

/** 診斷用：帶 marker 的 pty 行程完整命令列。斷言失敗時，光看數字看不出是誰。 */
function ptyCmdlines(marker) {
  return ptyPids(marker).map((pid) => {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ')
    } catch {
      return `pid ${pid}（已結束）`
    }
  })
}

async function waitForPtyCount(marker, expected, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let pids = ptyPids(marker)
  while (Date.now() < deadline && pids.length !== expected) {
    await sleep(150)
    pids = ptyPids(marker)
  }
  return pids
}

// ── app 啟動 ────────────────────────────────────────────────────────────────

const MOUNTED = `Boolean(
  document.querySelector('aside[aria-label="${copy('rail.label')}"]') &&
  document.getElementById('root')?.children.length &&
  document.visibilityState === 'visible'
)`

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text) => text.replace(ANSI_PATTERN, '')

/** 見 probe-files.mjs 的同名函式：自己 spawn electron，才控制得了 argv 與收尾。 */
async function startRendererDevServer() {
  const child = spawn('npx', ['electron-vite', 'dev', '--rendererOnly'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    detached: true,
  })

  const url = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('renderer dev server 未就緒')), 90_000)
    const onData = (chunk) => {
      output += stripAnsi(String(chunk))
      const match = output.match(/Local:\s+(http:\/\/[^\s/]+\/?)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1].replace(/\/$/, ''))
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
  })

  return { child, url }
}

async function launch({ port, profileDir, rendererUrl, marker, stub }) {
  const child = spawn(
    'electron',
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '.'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // pty 自主行程繼承 env：SHELL 決定 spawn 什麼，marker 讓我們清點得出它的行程。
        SHELL: SHELL_PATH,
        SPEK_PROBE_MARKER: marker,
        // claude 模式是 `$SHELL -l -c claude` —— 從 PATH 解析。前置放著 stub `claude` 的目錄，
        // 並把 HOME 一起換掉（否則 `~/.profile` 會把真 claude 搶回前面 —— 見 `makeStubClaude`）。
        HOME: stub.home,
        PATH: `${stub.bin}:${process.env.PATH}`,
        ...(rendererUrl ? { ELECTRON_RENDERER_URL: rendererUrl } : {}),
      },
    },
  )

  let stderr = ''
  child.stderr?.on('data', (chunk) => (stderr += chunk))
  child.stdout?.on('data', (chunk) => (stderr += chunk))

  const target = await waitForPageTarget(port, 30_000)
  const client = await connect(target)
  const mounted = await pollUntil(client, MOUNTED, (value) => value === true)

  return {
    client,
    mounted,
    stderr: () => stderr,
    /** 正常關閉（SIGTERM）：要驗的正是 app 自己會不會把 pty 清乾淨。 */
    async quitGracefully() {
      client.close()
      child.kill('SIGTERM')
    },
    /** 收尾：連根拔除 electron 樹。pty 若還在，是 app 的漏網之魚，不是這裡的責任。 */
    async destroy() {
      try {
        client.close()
      } catch {
        // 已關閉
      }
      child.kill('SIGKILL')
      try {
        execFileSync('pkill', ['-9', '-f', profileDir], { stdio: 'ignore' })
      } catch {
        // 找不到符合的行程 —— 正是我們要的結果。
      }
      await sleep(200)
    },
  }
}

// ── renderer 內的量測（一律 role／aria，不掛 data-*）─────────────────────────

const SELECT_FOLDER = (name) => `(() => {
  const rows = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] li > div[role="button"]')]
  const row = rows.find((r) => r.innerText.includes(${JSON.stringify(name)}))
  if (!row) return false
  row.click()
  return true
})()`

const TABS = `[...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')].map((tab) => ({
  label: tab.innerText.replace(/\\s+/g, ' ').trim(),
  selected: tab.getAttribute('aria-selected') === 'true',
  exited: tab.innerText.includes('${copy('sessions.exitedBadge')}'),
}))`

/** rail 的 session 子列（第 n 個，自 0 起）。 */
const RAIL_SESSION_RECT = (index) => `(() => {
  const rows = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] ul[aria-label^="${prefixOf('rail.folderSessions')}"] li > div[role="button"]')]
  const row = rows[${index}]
  if (!row) return null
  const r = row.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/** rail 上展開／收合 session 子列的 caret。 */
/**
 * 展開／收合 session 子列的箭頭鈕。
 *
 * **它的 aria-label 隨狀態而異，而英文把變數放在句尾**（Expand sessions in <name>）—— 沒有
 * 共同的固定後綴可用，只能兩個前綴都試。中文版的兩個標籤都以「的 session」結尾，一個後綴
 * 選擇器就通吃 —— 那是語言的巧合，不是可以沿用的結構。
 */
const RAIL_CARET_RECT = `(() => {
  const btn = document.querySelector(
    'aside[aria-label="${copy('rail.label')}"] button[aria-label^="${prefixOf('rail.expandSessions')}"], ' +
    'aside[aria-label="${copy('rail.label')}"] button[aria-label^="${prefixOf('rail.collapseSessions')}"]'
  )
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const RAIL_SESSION_COUNT = `document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] ul[aria-label^="${prefixOf('rail.folderSessions')}"] li').length`

/** rail 上 folder 列的「＋」建立入口（hover 才顯示，但 opacity 不影響 rect 與點擊）。 */
const RAIL_NEW_SESSION_RECT = `(() => {
  const btn = document.querySelector('aside[aria-label="${copy('rail.label')}"] [aria-label^="${prefixOf('rail.newSessionIn')}"]')
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/** rail 上第 n 個 session 子列的關閉鈕。 */
const RAIL_CLOSE_SESSION_RECT = (index) => `(() => {
  const rows = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] ul[aria-label^="${prefixOf('rail.folderSessions')}"] li')]
  const btn = rows[${index}]?.querySelector('[aria-label^="${prefixOf('sessions.closeSession')}"]')
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/**
 * 主舞台的「+ session」與最後一個分頁之間的水平間距。
 *
 * 先前它被 flex 推到分頁列的另一端（間距數百 px），開第二個分頁後滑鼠得橫越整條列。
 */
/** 選單項是否為停用狀態（無選取內容時的「複製」）。 */
const MENU_ITEM_DISABLED = (label) => `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return null
  const item = [...menu.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(label)}))
  return item ? item.disabled : null
})()`

const CLIPBOARD_WRITE = (text) =>
  `window.workspace.clipboard.writeText(${JSON.stringify(text)})`
const CLIPBOARD_READ = `window.workspace.clipboard.readText()`

/** 第 n 個分頁的 rect（用於真右鍵與拖曳）。 */
const TAB_RECT = (index) => `(() => {
  const tabs = [...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
  const tab = tabs[${index}]
  if (!tab) return null
  const r = tab.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/**
 * 第 n 個分頁**實際生效**的游標。
 *
 * 分頁是「可點擊也可拖曳」的項目 —— 靜止時必須是 `pointer`（點一下會切換 focused session，
 * 那是它主要的可供性），只有拖曳進行中才是 `grabbing`。
 */
const TAB_CURSOR = (index) => `(() => {
  const tabs = [...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
  const tab = tabs[${index}]
  return tab ? getComputedStyle(tab).cursor : null
})()`

/** 分頁的標籤依序。 */
/**
 * 每個分頁的 tooltip（`<完整標題> — <狀態>`）與狀態燈的實際顏色。
 *
 * **休眠不是結束。** `session-badge` 原本只認得 running／exited —— 於是每個重建出來的休眠
 * session 都亮**紅燈**、tooltip 說它「已結束（代碼 0）」。那是使用者重開 app 之後看到的第一個
 * 畫面，等於在告訴他「你的 session 都死了」（違反「休眠狀態 SHALL 被明確地呈現」）。
 */
const TAB_STATUS = `[...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')].map((tab) => {
  const dot = tab.querySelector('span[aria-hidden="true"]')
  return {
    title: tab.getAttribute('title') ?? '',
    dot: dot ? getComputedStyle(dot).backgroundColor : null,
  }
})`

/** danger 的實際色值（用來斷言休眠**不是**這個顏色）。 */
const DANGER_COLOR = `(() => {
  const probe = document.createElement('span')
  probe.className = 'bg-danger'
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).backgroundColor
  probe.remove()
  return color
})()`

const TAB_LABELS = `[...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
  .map((tab) => tab.innerText.replace(/\\s+/g, ' ').trim())`

/** rail 子列的標籤依序（去掉尾巴的 ✕）。 */
const RAIL_LABELS = `[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] ul[aria-label^="${prefixOf('rail.folderSessions')}"] li')]
  .map((li) => li.innerText.replace(/✕/g, '').replace(/\\s+/g, ' ').trim())`

/** 重新命名對話框的輸入框。 */
const RENAME_INPUT_RECT = `(() => {
  const el = document.querySelector('[aria-label="${copy('sessions.nameLabel')}"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/**
 * **有任何對話框開著嗎？**
 *
 * 命名權的斷言（「pty 改名不打斷使用者」）是**否定**的，因此它必須問一個**開放**的問題：畫面上
 * 有沒有**任何**對話框。若改問「那個確認對話框在不在」，它就綁死在一個特定元件的 `aria-label`
 * 上 —— 而該元件已於 session-title-authority 刪除，那種寫法會恆為 false，成為一盞測不到自己
 * 宣稱在測的東西的綠燈。
 */
const ANY_DIALOG_OPEN = `Boolean(document.querySelector('[role="dialog"]'))`

const NEW_BUTTON_GAP = `(() => {
  const tabs = [...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
  const last = tabs[tabs.length - 1]
  const plus = document.querySelector('[aria-label="${copy('sessions.new')}"]')
  if (!last || !plus) return null
  return Math.round(plus.getBoundingClientRect().left - last.getBoundingClientRect().right)
})()`

const RECT_OF = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/** 選單項以文字定位，回傳其 rect —— 由探針送真滑鼠事件過去，不用 .click()。 */
const MENU_ITEM_RECT = (label) => `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return null
  const item = [...menu.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(label)}))
  if (!item) return null
  const r = item.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const MENU_IN_VIEWPORT = `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return null
  const r = menu.getBoundingClientRect()
  return {
    inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    vw: window.innerWidth,
    vh: window.innerHeight,
  }
})()`

/** 只讀「當前顯示中」的那個終端 —— 其餘 session 的終端仍掛載，只是 display:none。 */
const TERMINAL_TEXT = `(() => {
  const host = [...document.querySelectorAll('section[aria-label="${copy('stage.terminal')}"] > div')]
    .find((d) => !d.classList.contains('hidden'))
  const rows = host?.querySelector('.xterm-rows')
  return rows ? rows.innerText : ''
})()`

/**
 * terminal 實際生效的字級，以及字級尺度所要求的值。
 *
 * `typography-scale` 要求 terminal 的字級**由尺度推導**，不得是一個與尺度無關的常數。這條
 * 驗收有鑑別力，是因為 **`--text-terminal`（16px）與程式碼裡的 fallback（14px）不同** ——
 * 而那個 fallback 正是這個 bug 曾經藏身的地方：`getPropertyValue('--text-terminal')` 回傳的是
 * 字面的 `"calc(17px - 1px)"`（CSS 自訂屬性的 computed value **不求值 calc()**），`parseFloat`
 * 得到 `NaN`，於是悄悄退回 fallback。當年 fallback 剛好等於正確值，畫面上完全看不出來。
 *
 * 期望值同樣交給**瀏覽器**求值：`font-size` 是有型別的屬性，其 computed value 必為絕對 px。
 */
const TERMINAL_FONT = `(() => {
  const host = [...document.querySelectorAll('section[aria-label="${copy('stage.terminal')}"] > div')]
    .find((d) => !d.classList.contains('hidden'))
  const rows = host?.querySelector('.xterm-rows')
  if (!rows) return null

  const el = document.createElement('div')
  el.style.fontSize = 'var(--text-terminal)'
  document.body.appendChild(el)
  const fromScale = getComputedStyle(el).fontSize
  el.remove()

  return { actual: getComputedStyle(rows).fontSize, fromScale }
})()`

/** 五級字級 token 求值後的實際 px —— 用來驗「尺度中不存在分不出來的級差」。 */
const TYPE_SCALE = `(() => {
  const resolve = (token) => {
    const el = document.createElement('div')
    el.style.fontSize = 'var(' + token + ')'
    document.body.appendChild(el)
    const px = getComputedStyle(el).fontSize
    el.remove()
    return px
  }
  return {
    '2xs': resolve('--text-2xs'),
    xs: resolve('--text-xs'),
    sm: resolve('--text-sm'),
    base: resolve('--text-base'),
    lg: resolve('--text-lg'),
    terminal: resolve('--text-terminal'),
  }
})()`

const TERMINAL_RECT = RECT_OF(`section[aria-label="${copy('stage.terminal')}"]`)
const NEW_SESSION_RECT = RECT_OF(`[aria-label="${copy('sessions.new')}"]`)
const SEPARATOR_RECT = RECT_OF(`main[aria-label="${copy('stage.label')}"] [role="separator"]`)

const CLOSE_FIRST_TAB = `(() => {
  const btn = document.querySelector('[aria-label^="${prefixOf('sessions.closeSession')}"]')
  if (!btn) return false
  btn.click()
  return true
})()`

const RAIL_SESSION_ROWS = `[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] ul[aria-label^="${prefixOf('rail.folderSessions')}"] li')]
  .map((li) => li.innerText.replace(/\\s+/g, ' ').trim())`

// ── 輸入 ────────────────────────────────────────────────────────────────────

const center = (rect) => ({
  x: Math.round(rect.x + rect.width / 2),
  y: Math.round(rect.y + rect.height / 2),
})

/**
 * 送**真的**滑鼠按鍵（trusted event），而非 `element.dispatchEvent(new MouseEvent(...))`。
 *
 * 合成的 contextmenu 不走完整的 pointer/mouse/contextmenu 序列，也不觸發 React 19 對
 * trusted discrete 事件的同步 effect flush —— 用它測選單會漏掉「開啟選單的事件冒泡到
 * window 把自己關掉」這類只在真實輸入下發生的 bug。
 */
async function realMouse(client, x, y, button = 'left') {
  const buttons = button === 'right' ? 2 : button === 'left' ? 1 : 0
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons, clickCount: 1 })
}

async function realClick(client, rect) {
  const at = center(rect)
  await realMouse(client, at.x, at.y, 'left')
}

/**
 * 對某個 session 分頁開啟右鍵選單，並**確認它真的開了**；沒開就重新量測座標再點一次。
 *
 * 「量完就點」是在賭版面不動 —— 而分頁列會動。分頁的標籤會因為 pty 宣告的 OSC 標題、或使用者
 * 自己的改名而改變寬度（一次改名就能讓標籤從一串超長標題縮成 `temp-name`），於是**上一次量到的
 * 座標在幾毫秒內就過期**，點擊落在別的元素上，選單自然開不起來。
 *
 * 症狀是探針在某個看似無關的地方 `TypeError: Cannot read properties of null` —— 因為
 * `MENU_ITEM_RECT(...)` 找不到選單。**不要重用一個量過的 rect 去點第二次。**
 */
async function openTabMenu(client, index, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rect = await client.evaluate(TAB_RECT(index))
    if (rect) {
      const at = center(rect)
      await realMouse(client, at.x, at.y, 'right')
      const menu = await pollUntil(client, MENU_IN_VIEWPORT, (value) => value !== null, 1500)
      if (menu) return menu
    }
    await sleep(200)
  }
  throw new Error(`分頁 ${index} 的右鍵選單開不起來（座標持續過期或選單溢出 viewport）`)
}

/**
 * 送一行指令給終端（xterm 的隱形 textarea → onData → pty）。
 *
 * **Enter 必須是一次真正的按鍵事件。** 實測：把 `\r` 併進 `Input.insertText` 的文字裡，
 * 字元確實送達 pty（終端上看得到回顯），但 shell 從未執行那一行 —— xterm 的換行是在
 * keydown 上判讀的，不是從 textarea 的內容裡剖析出來的。
 */
async function typeLine(client, text) {
  await client.send('Input.insertText', { text })
  await pressEnter(client)
}

/** Enter 必須是一次真的按鍵事件（見 `typeLine` 的註解）。對話框的送出也走這裡。 */
async function pressEnter(client) {
  const key = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/** 等終端輸出出現某個片段。 */
async function waitForOutput(client, needle, timeoutMs = 8000) {
  const text = await pollUntil(client, TERMINAL_TEXT, (value) => String(value).includes(needle), timeoutMs)
  return String(text)
}

/** 自 rail 的 folder 列建立 session（該入口 hover 才顯示，但 rect 與點擊不受 opacity 影響）。 */
async function openSessionViaRail(client, itemLabel) {
  const btn = await pollUntil(client, RAIL_NEW_SESSION_RECT, (value) => value !== null, 8000)
  if (!btn) throw new Error('找不到 rail 上的建立 session 入口')
  await realClick(client, btn)

  const menu = await pollUntil(client, MENU_IN_VIEWPORT, (value) => value !== null, 3000)
  const itemRect = await client.evaluate(MENU_ITEM_RECT(itemLabel))
  if (!itemRect) throw new Error(`rail 的選單中找不到「${itemLabel}」`)

  await realClick(client, itemRect)
  return menu
}

async function openSessionViaMenu(client, itemLabel) {
  // 用 poll 而非一次求值：重新載入之後 rail 與分頁列要等 renderer 重新掛載才出現
  //（實測 dev 模式在 reload 後直接找按鈕會撲空）。
  const btn = await pollUntil(client, NEW_SESSION_RECT, (value) => value !== null, 10_000)
  if (!btn) throw new Error('找不到「+ session」按鈕')
  await realClick(client, btn)

  // 選單必須活過開啟它的那次 click（它會冒泡到 window，而選單自己掛著 dismiss listener）。
  const menu = await pollUntil(client, MENU_IN_VIEWPORT, (value) => value !== null, 3000)
  const itemRect = await client.evaluate(MENU_ITEM_RECT(itemLabel))
  if (!itemRect) throw new Error(`選單中找不到「${itemLabel}」`)

  await realClick(client, itemRect)
  return menu
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function runMode(label, { port, rendererUrl }) {
  console.log(`\n── ${label} ──`)

  const marker = `spek-term-marker-${process.pid}-${Date.now()}`
  const { repo } = makeFixture()
  const profile = seedProfile([['f1', repo]])
  const stub = makeStubClaude()
  const app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })

  try {
    check(results, `${label}：app 掛載`, app.mounted === true)

    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    // 尚無 session 時的空狀態與建立入口
    const emptyTabs = await app.client.evaluate(TABS)
    check(results, `${label}：初始沒有任何 session 分頁`, emptyTabs.length === 0)

    // ── 開一個 login shell session（真事件：按鈕 → 選單 → 選單項）
    const menu = await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    check(
      results,
      `${label}：spawn 選單完整落在 viewport 內`,
      menu?.inside === true,
      menu ? `menu=${JSON.stringify(menu.rect)} viewport=${menu.vw}x${menu.vh}` : '選單未開啟',
    )

    const tabs1 = await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)
    check(
      results,
      `${label}：建立 shell session 後出現一個分頁且為 focused`,
      tabs1.length === 1 && tabs1[0].selected === true,
      JSON.stringify(tabs1),
    )

    const pids1 = await waitForPtyCount(marker, 1)
    check(results, `${label}：pty 行程存在`, pids1.length === 1, `pids=${pids1.join(',')}`)

    // 初始輸出（shell 的第一個 prompt）不得因「create 早於 attach」而遺失
    const rail = await app.client.evaluate(RAIL_SESSION_ROWS)
    check(
      results,
      `${label}：rail 於 folder 之下呈現 session 子列`,
      Array.isArray(rail) && rail.length === 1 && rail[0].includes('shell'),
      JSON.stringify(rail),
    )

    // ── typography-scale：terminal 的字級由尺度推導，不是一個獨立的常數
    const font = await app.client.evaluate(TERMINAL_FONT)
    check(
      results,
      `${label}：terminal 的字級來自字級尺度（--text-terminal），不是寫死的常數`,
      font?.actual === font?.fromScale && font?.actual !== '14px',
      `實際=${font?.actual} 尺度要求=${font?.fromScale}（14px 是程式碼裡的 fallback —— ` +
        `讀成它就表示 --text-terminal 沒被解析出來）`,
    )

    const scale = await app.client.evaluate(TYPE_SCALE)
    const levels = [scale?.['2xs'], scale?.xs, scale?.sm, scale?.base, scale?.lg]
    check(
      results,
      `${label}：字級尺度的五級互不相同（不存在分不出來的級差）`,
      new Set(levels).size === 5 && levels.every((v) => /^\d+(\.\d+)?px$/.test(String(v))),
      JSON.stringify(scale),
    )

    // ── typography-scale：轉動旋鈕，terminal 跟著走（且會重新量測）
    //
    // 字級決定 cell 尺寸，cell 尺寸決定行列數 —— 字級變了而不重新量測，pty 手上的 cols/rows
    // 就與畫面錯位。字級的重讀掛在 `fit()` 上（它本來就在每次 resize 時被呼叫），所以這裡改完
    // 旋鈕要真的觸發一次 resize（拖動 side panel 的分界），再斷言 xterm 的字級跟上了。
    await app.client.evaluate(`document.documentElement.style.setProperty('--text-base', '24px')`)
    const knobSep = center(await app.client.evaluate(SEPARATOR_RECT))
    await dragMouse(app.client, knobSep, { x: knobSep.x - 40, y: knobSep.y })
    await sleep(400)
    const fontAfterKnob = await app.client.evaluate(TERMINAL_FONT)
    check(
      results,
      `${label}：轉動字級旋鈕後，terminal 的字級隨之改變（fit 重新讀取並量測）`,
      fontAfterKnob?.actual === '23px' && fontAfterKnob?.actual === fontAfterKnob?.fromScale,
      `--text-base=24px → terminal 應為 23px；實際=${fontAfterKnob?.actual} 尺度=${fontAfterKnob?.fromScale}`,
    )

    // 還原旋鈕與版面 —— 後續斷言依賴原本的字級與分界位置。
    await app.client.evaluate(`document.documentElement.style.removeProperty('--text-base')`)
    await dragMouse(app.client, { x: knobSep.x - 40, y: knobSep.y }, knobSep)
    await sleep(400)

    // ── 雙向串流：回顯 ≠ 執行
    const terminalRect = await app.client.evaluate(TERMINAL_RECT)
    await realClick(app.client, terminalRect) // 讓 xterm 取得焦點
    await sleep(200)

    // 回顯是字面的 `echo OUT_$((6*7))`（不含 42）；只有真的被執行，輸出才會有 OUT_42。
    await typeLine(app.client, 'echo OUT_$((6*7))')
    const afterEcho = await waitForOutput(app.client, 'OUT_42')
    check(
      results,
      `${label}：輸入送達 pty 且執行結果回傳（OUT_42）`,
      afterEcho.includes('OUT_42'),
      afterEcho.replace(/\s+/g, ' ').slice(-80),
    )

    // ── cwd＝folder 根目錄
    // `$(pwd)` 在回顯裡不會展開，因此畫面上出現 `CWD=<路徑>` 就一定是 shell 真的執行了。
    const cwdNeedle = `CWD=${repo}`
    await typeLine(app.client, 'echo CWD=$(pwd)')
    const afterPwd = await pollUntil(
      app.client,
      TERMINAL_TEXT,
      (value) => String(value).includes(cwdNeedle),
      12_000,
    )
    check(
      results,
      `${label}：session 的 cwd 為 folder 根目錄`,
      String(afterPwd).includes(cwdNeedle),
      `期待 ${cwdNeedle}；實得 …${String(afterPwd).replace(/\s+/g, ' ').slice(-90)}`,
    )

    // ── 複製與貼上（終端不能複製貼上，等於不能用）
    //
    // 右鍵一律送**真事件**：合成的 contextmenu 測不出「開啟選單的事件冒泡到 window 把自己
    // 關掉」這個只在真實輸入下發生的 bug（CLAUDE.md 已記載）。
    const termAt = center(terminalRect)

    // 貼上：先把一段命令放進系統剪貼簿。回顯是字面的 `echo PASTED_$((3*4))`（不含 12），
    // 只有它真的被送進 pty 並執行，輸出才會有 `PASTED_12`。
    await app.client.evaluate(CLIPBOARD_WRITE('echo PASTED_$((3*4))'))

    await realMouse(app.client, termAt.x, termAt.y, 'right')
    const termMenu = await pollUntil(app.client, MENU_IN_VIEWPORT, (value) => value !== null, 4000)
    check(
      results,
      `${label}：終端的右鍵選單開得起來且完整落在 viewport 內`,
      termMenu?.inside === true,
      termMenu ? JSON.stringify(termMenu.rect) : '選單未開啟',
    )

    // 此刻沒有選取內容 —— 「複製」應為停用（停用而非隱藏）
    const copyDisabled = await app.client.evaluate(MENU_ITEM_DISABLED(copy('sessions.copy')))
    check(
      results,
      `${label}：無選取內容時右鍵選單的「複製」為停用`,
      copyDisabled === true,
      `disabled=${copyDisabled}`,
    )

    const pasteRect = await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.paste')))
    await realClick(app.client, pasteRect)

    // 貼上只是把文字送進 pty 的輸入，還要按下 Enter 才會執行。
    await sleep(300)
    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
    })
    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })

    const pasted = await waitForOutput(app.client, 'PASTED_12')
    check(
      results,
      `${label}：自右鍵選單貼上，內容送達 pty 並被執行`,
      pasted.includes('PASTED_12'),
      pasted.replace(/\s+/g, ' ').slice(-60),
    )

    // 複製：拖曳選取終端內容 → 右鍵 → 複製 → 自系統剪貼簿讀回
    await app.client.evaluate(CLIPBOARD_WRITE('__not-yet-copied__'))
    await dragMouse(
      app.client,
      { x: terminalRect.x + 10, y: terminalRect.y + 10 },
      { x: terminalRect.x + terminalRect.width - 20, y: terminalRect.y + terminalRect.height - 20 },
    )
    await sleep(200)

    await realMouse(app.client, termAt.x, termAt.y, 'right')
    await pollUntil(app.client, MENU_IN_VIEWPORT, (value) => value !== null, 4000)

    const copyEnabled = await app.client.evaluate(MENU_ITEM_DISABLED(copy('sessions.copy')))
    const copyRect = await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.copy')))
    await realClick(app.client, copyRect)
    await sleep(300)

    // 斷言用 `OUT_42` —— 它是稍早就確定在畫面上的內容，不依賴貼上那一步是否成功。
    const clipboardText = await app.client.evaluate(CLIPBOARD_READ)
    check(
      results,
      `${label}：選取終端內容後複製，其內容寫入系統剪貼簿`,
      copyEnabled === false && typeof clipboardText === 'string' && clipboardText.includes('OUT_42'),
      `複製項 disabled=${copyEnabled}；剪貼簿＝…${String(clipboardText).replace(/\s+/g, ' ').slice(-50)}`,
    )

    // 清掉選取，免得干擾後續的輸入
    await realMouse(app.client, termAt.x, termAt.y, 'left')
    await sleep(150)

    // ── clipboard：主行程對畸形輸入防禦，不因非字串而崩潰 ────────────────────
    // `writeText` 是 fire-and-forget 的 ipcMain.on、無回應通道；非字串會讓 clipboard.writeText
    // 拋 TypeError → 主行程未捕捉例外。送幾個非字串，再確認主行程仍正常服務後續 IPC、合法字串
    // 仍寫得進剪貼簿。
    //
    // **headless 侷限**：主行程有無 uncaught exception 不傳到 renderer，此處無法直接觀察；驗證的
    // 是可觀察的保證 —— 畸形輸入後主行程存活、clipboard 通道與其他 IPC 仍正常（其餘由 design D3 承擔）。
    await app.client.evaluate('window.workspace.clipboard.writeText({ evil: true })')
    await app.client.evaluate('window.workspace.clipboard.writeText([1, 2, 3])')
    await app.client.evaluate('window.workspace.clipboard.writeText(undefined)')
    await app.client.evaluate(CLIPBOARD_WRITE('legit-after-malformed'))
    const afterMalformed = await app.client.evaluate(CLIPBOARD_READ)
    const foldersAlive = await app.client.evaluate('window.workspace.folders.list()')
    check(
      results,
      `${label}：非字串的剪貼簿寫入被丟棄，主行程仍正常運作`,
      afterMalformed === 'legit-after-malformed' && Array.isArray(foldersAlive),
      `讀回=${JSON.stringify(afterMalformed)} folders=${Array.isArray(foldersAlive) ? foldersAlive.length : 'N/A'}`,
    )

    // ── 終端連結：OSC 8 超連結經受控接縫（linkHandler → openExternal）**不在此 probe** ──────
    //
    // 這裡曾有一條「以真滑鼠 hover+click 一個 OSC 8 連結，斷言不彈 xterm 內建 confirm／window.open」
    // 的驗收。**對照組證明它是假綠**：把產品的 linkHandler 整個移除、重跑，斷言**仍然全綠** ——
    // 也就是那個 hover+click 根本沒觸發 xterm 的 OSC 8 連結激活（DOM renderer 下連結的 hit-test 與
    // Linkifier2 的 hover 追蹤，注入式滑鼠事件驅動不了），confirm 於是恆為 false，與 linkHandler
    // 設沒設無關。留著它只會給一條「測不到自己宣稱在測的東西」的綠燈。
    //
    // 且即使觸發得了，正向「走了 openExternal」仍不可觀察：openExternal 是 fire-and-forget、且
    // 交由主行程開系統瀏覽器。OSC 8 的行為因此由 code review（linkHandler.activate → openLink →
    // openExternal）+ design D4 保證，比照「探針證明不了真實鍵盤」那道由人補的缺口。

    // ── login shell 的 session **不採用** pty 宣告的標題
    //
    // shell 送的是它預設的 prompt 標題（`使用者@主機:/路徑`），對使用者零識別意義，而且它比
    // session 晚一秒多才到 —— 抵達時分頁的寬度會在眼前暴增，把緊鄰其後的「+ session」入口
    // 往右推走。標籤因此一律停在本地的 `shell N`（session-navigation-and-labels 的 design D4）。
    //
    // **斷言必須成對**：光看「標籤沒變」證明不了什麼（它本來就可能什麼都沒發生）。先確認那串
    // OSC 序列**真的抵達了 pty**（`cat -v` 會把它以可見形式印出來），再斷言標籤沒被它改動。
    await typeLine(app.client, "printf '\\033]0;shell-osc-title\\007' | cat -v")

    const echoed = await pollUntil(
      app.client,
      TERMINAL_TEXT,
      (value) => String(value).includes('^[]0;shell-osc-title^G'),
      8000,
    )
    check(
      results,
      `${label}：OSC 序列確實抵達 pty（否則此測試空轉）`,
      String(echoed).includes('^[]0;shell-osc-title^G'),
    )

    await typeLine(app.client, "printf '\\033]0;shell-osc-title\\007'")
    await sleep(1200) // 給它足夠的時間「改壞」—— 沒有這段等待，「沒變」只是還沒輪到它變

    const shellTabs = await app.client.evaluate(TABS)
    check(
      results,
      `${label}：login shell 的 session 不採用 pty 宣告的標題，標籤維持本地標籤`,
      shellTabs.every((tab) => !tab.label.includes('shell-osc-title')) &&
        shellTabs[0]?.label.includes('shell 1'),
      JSON.stringify(shellTabs.map((t) => t.label)),
    )

    const shellRail = await app.client.evaluate(RAIL_SESSION_ROWS)
    check(
      results,
      `${label}：rail 子列同樣維持本地標籤`,
      shellRail.every((row) => !row.includes('shell-osc-title')),
      JSON.stringify(shellRail),
    )

    // ── resize：pty 必須收到新的欄數
    //
    // 兩次量測用**不同的 marker**，且等的是「marker 後面跟著數字」。命令列本身就含
    // `C1=`（tty 會回顯它），若只等 `C1=` 出現，會在回顯的那一刻就返回 —— 那時 shell
    // 根本還沒執行，數字尚未產生（實測：build 模式因此讀到 0）。與 OUT_42 同一個陷阱：
    // **回顯不等於執行**。
    const readCols = async (marker) => {
      await typeLine(app.client, `echo ${marker}=$(stty size | cut -d' ' -f2)`)
      const pattern = new RegExp(`${marker}=(\\d+)`)
      const text = await pollUntil(app.client, TERMINAL_TEXT, (value) => pattern.test(String(value)), 8000)
      return Number(String(text).match(pattern)?.[1] ?? 0)
    }

    const colsBefore = await readCols('C1')

    const sep = await app.client.evaluate(SEPARATOR_RECT)
    const sepAt = center(sep)
    // 把分界往左拖 → terminal 變窄 → fit → pty resize
    await dragMouse(app.client, sepAt, { x: Math.max(300, sepAt.x - 220), y: sepAt.y })
    await sleep(600) // debounce(60ms) + IPC + pty

    const colsAfter = await readCols('C2')

    check(
      results,
      `${label}：終端變窄後 pty 收到更小的欄數`,
      colsBefore > 0 && colsAfter > 0 && colsAfter < colsBefore,
      `${colsBefore} → ${colsAfter}`,
    )

    // ── 第二個 session（多開）
    await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    const tabs2 = await pollUntil(app.client, TABS, (value) => value.length === 2, 8000)
    check(results, `${label}：可多開 session`, tabs2.length === 2, JSON.stringify(tabs2.map((t) => t.label)))

    const pids2 = await waitForPtyCount(marker, 2)
    check(results, `${label}：兩個 pty 行程並存`, pids2.length === 2, `pids=${pids2.join(',')}`)

    // 兩個 login shell 的 session 都停在本地標籤，且**序號各自不同** —— 序號是 folder 內遞增的。
    //
    // 「pty 宣告的標題被採用」的對照組不在這裡（shell 一律不採用），而在後面 claude 目標的那一段：
    // 那邊有一個由 pty 宣告標題的 session，與這裡的本地標籤形成真正的對比。
    check(
      results,
      `${label}：未宣告標題的 session 退回本地標籤`,
      tabs2[0]?.label.includes('shell 1') && tabs2[1]?.label.includes('shell 2'),
      JSON.stringify(tabs2.map((t) => t.label)),
    )

    // ── 「+ session」必須緊鄰最後一個分頁（先前被 flex 推到分頁列的另一端）
    const gap = await app.client.evaluate(NEW_BUTTON_GAP)
    check(
      results,
      `${label}：「+ session」緊鄰最後一個分頁`,
      typeof gap === 'number' && gap >= 0 && gap < 40,
      `與最後一個分頁的間距 ${gap}px`,
    )

    // ── 切回第一個 session：先前的輸出仍在（scrollback 未因切換而遺失）
    const firstTabRect = await app.client.evaluate(`(() => {
      const tab = document.querySelector('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')
      if (!tab) return null
      const r = tab.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
    await realClick(app.client, firstTabRect)
    await sleep(400)

    const backText = await app.client.evaluate(TERMINAL_TEXT)
    check(
      results,
      `${label}：切回 session 後其先前的輸出仍在`,
      String(backText).includes('OUT_42'),
      String(backText).replace(/\s+/g, ' ').slice(-60),
    )

    // ── rail 的 session 子列：點選即聚焦（此刻 focused 是第一個）
    const railSecond = await app.client.evaluate(RAIL_SESSION_RECT(1))
    await realClick(app.client, railSecond)
    const tabsAfterRail = await pollUntil(
      app.client,
      TABS,
      (value) => value.length === 2 && value[1].selected === true,
      8000,
    )
    check(
      results,
      `${label}：點 rail 的 session 子列即聚焦該 session`,
      tabsAfterRail[1]?.selected === true,
      JSON.stringify(tabsAfterRail.map((t) => `${t.label}${t.selected ? '*' : ''}`)),
    )

    // ── rail 的 session 子列：可收合與展開
    const caret = await app.client.evaluate(RAIL_CARET_RECT)
    await realClick(app.client, caret)
    const collapsed = await pollUntil(app.client, RAIL_SESSION_COUNT, (value) => value === 0, 4000)
    await realClick(app.client, caret)
    const expanded = await pollUntil(app.client, RAIL_SESSION_COUNT, (value) => value === 2, 4000)
    check(
      results,
      `${label}：rail 的 session 子列可收合與展開`,
      collapsed === 0 && expanded === 2,
      `收合後=${collapsed} 展開後=${expanded}`,
    )

    // ── 重新命名：使用者接管 session 的命名權
    //
    // 先聚焦第一個 session（後面要對它送 OSC 標題）。
    await realClick(app.client, await app.client.evaluate(TAB_RECT(0)))
    await sleep(200)

    const tab0 = await app.client.evaluate(TAB_RECT(0))
    const tab0At = center(tab0)
    await realMouse(app.client, tab0At.x, tab0At.y, 'right')

    const tabMenu = await pollUntil(app.client, MENU_IN_VIEWPORT, (value) => value !== null, 4000)
    check(
      results,
      `${label}：分頁的右鍵選單開得起來且完整落在 viewport 內`,
      tabMenu?.inside === true,
      tabMenu ? JSON.stringify(tabMenu.rect) : '選單未開啟',
    )

    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await pollUntil(app.client, RENAME_INPUT_RECT, (value) => value !== null, 4000)

    // 對話框開啟時輸入框已 focus 且全選 —— 直接打字即取代。
    await app.client.send('Input.insertText', { text: 'my-session' })
    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
    })
    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })

    const renamedTabs = await pollUntil(
      app.client,
      TAB_LABELS,
      (value) => value[0]?.includes('my-session'),
      6000,
    )
    const renamedRail = await pollUntil(
      app.client,
      RAIL_LABELS,
      (value) => value[0]?.includes('my-session'),
      6000,
    )
    check(
      results,
      `${label}：重新命名後分頁與 rail 兩處的標籤都更新`,
      renamedTabs[0]?.includes('my-session') && renamedRail[0]?.includes('my-session'),
      `分頁=${JSON.stringify(renamedTabs)} rail=${JSON.stringify(renamedRail)}`,
    )

    // ── 已命名的 login shell session：pty 送出標題時**不該**跳任何對話框
    //
    // shell 根本不採用 pty 的標題（見上），因此「pty 想改名」這個情境對它不存在 —— 使用者不該
    // 被一個「pty 想把它改名為 kewang@host:/tmp/…，要採用嗎？」的對話框打斷，而那個名字他永遠
    // 看不到。**這是 design D4「擋在 setTitle() 而非顯示層」唯一測得出來的後果**：若只改顯示層，
    // 標籤會是對的，但那個對話框照跳不誤。
    await realClick(app.client, terminalRect)
    await sleep(200)
    await typeLine(app.client, "printf '\\033]0;pty-wants-this\\007'")
    await sleep(1500) // 給對話框足夠的時間跳出來 —— 沒有這段等待，「沒跳」只是還沒跳

    const noConflict = await app.client.evaluate(ANY_DIALOG_OPEN)
    const labelAfterOsc = await app.client.evaluate(TAB_LABELS)
    check(
      results,
      `${label}：已命名的 login shell session，pty 送出標題時不跳對話框`,
      noConflict === false && labelAfterOsc[0]?.includes('my-session'),
      `對話框=${noConflict} 標籤=${JSON.stringify(labelAfterOsc)}`,
    )

    // ── 拖曳排序：分頁與 rail 共用同一個順序
    const firstTab = await app.client.evaluate(TAB_RECT(0))
    const secondTab = await app.client.evaluate(TAB_RECT(1))

    // ── 游標：分頁**點一下是有作用的**（切換 focused session），拖曳是偶爾為之 ——
    // 靜止時必須是 `pointer`（食指），不是 `grab`（張開的手，宣告「這東西只能被拖」）。
    const idleCursor = await app.client.evaluate(TAB_CURSOR(0))
    check(
      results,
      `${label}：分頁靜止時的游標為 pointer（不是 grab）`,
      idleCursor === 'pointer',
      String(idleCursor),
    )

    // 拖曳**進行中**才是 `grabbing`。這一半不能省：元素自己的 cursor 會贏過 `useDragReorder`
    // 設在 body 上的 grabbing —— 少了它，滑鼠底下（正是被拖的那一個分頁）會顯示食指。
    await app.client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...center(firstTab),
      button: 'none',
      buttons: 0,
    })
    await app.client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...center(firstTab),
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await app.client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: center(firstTab).x + 10,
      y: center(firstTab).y,
      button: 'left',
      buttons: 1,
    })
    await sleep(200)
    const draggingCursor = await app.client.evaluate(TAB_CURSOR(0))
    await app.client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: center(firstTab).x + 10,
      y: center(firstTab).y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await sleep(300)
    check(
      results,
      `${label}：拖曳進行中的游標為 grabbing`,
      draggingCursor === 'grabbing',
      String(draggingCursor),
    )

    // 上面那次拖曳沒有跨過任何分頁的中線 —— 順序不變，接著才是真正的拖曳排序。
    //
    // **第三個分頁不是裝飾。** 只有兩個項目時，「落在指示線之處」與「多跳一格」給出的結果**完全
    // 相同** —— 分頁列的拖曳因此長年只用兩個分頁驗收，而那個 off-by-one（往下／往右拖時，東西
    // 落在指示線的下一格）就這樣躲過了每一輪全綠。三個才分得出來。
    await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    const three = await pollUntil(app.client, TAB_LABELS, (value) => value.length === 3, 10_000)
    check(results, `${label}：分頁列有三個 session（拖曳精度的驗收需要）`, three.length === 3, JSON.stringify(three))

    const beforeThree = await app.client.evaluate(TAB_LABELS)
    const firstTabAgain = await app.client.evaluate(TAB_RECT(0))
    const secondTabAgain = await app.client.evaluate(TAB_RECT(1))

    // 把第一個分頁拖到第二個的右半邊 → 指示線落在第二個之後 → 它應該停在**第二與第三之間**，
    // 而不是被丟到最後。
    await dragMouse(
      app.client,
      center(firstTabAgain),
      { x: Math.round(secondTabAgain.x + secondTabAgain.width - 4), y: center(secondTabAgain).y },
    )
    await sleep(400)

    const afterDrag = await app.client.evaluate(TAB_LABELS)
    const railAfterDrag = await app.client.evaluate(RAIL_LABELS)
    check(
      results,
      `${label}：拖曳分頁改變順序，落點與指示線一致，且 rail 同步呈現相同順序`,
      afterDrag[0] === beforeThree[1] &&
        afterDrag[1] === beforeThree[0] &&
        afterDrag[2] === beforeThree[2] &&
        JSON.stringify(railAfterDrag) === JSON.stringify(afterDrag),
      `拖曳前=${JSON.stringify(beforeThree)} 拖曳後=${JSON.stringify(afterDrag)}（多跳一格的話第一個分頁會跑到最後）rail=${JSON.stringify(railAfterDrag)}`,
    )

    // 關掉多開的那一個，讓後續段落回到它原本預期的兩個 session。
    await app.client.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
      const group = tabs[2]?.closest('div[role="presentation"]')
      const close = group?.querySelector('[aria-label^="${prefixOf('sessions.closeSession')}"]')
      if (!close) return false
      close.click()
      return true
    })()`)
    await pollUntil(app.client, TAB_LABELS, (value) => value.length === 2, 8000)

    // ── 自 rail 拖曳，順序同樣改變，分頁列同步
    const railBefore = await app.client.evaluate(RAIL_LABELS)
    const railRow0 = await app.client.evaluate(RAIL_SESSION_RECT(0))
    const railRow1 = await app.client.evaluate(RAIL_SESSION_RECT(1))

    // 把第一列往下拖過第二列的中線
    await dragMouse(app.client, center(railRow0), {
      x: center(railRow1).x,
      y: Math.round(railRow1.y + railRow1.height - 2),
    })
    await sleep(400)

    const railAfterDragFromRail = await app.client.evaluate(RAIL_LABELS)
    const tabsAfterRailDrag = await app.client.evaluate(TAB_LABELS)
    check(
      results,
      `${label}：自 rail 拖曳改變順序，且分頁列同步呈現相同順序`,
      railAfterDragFromRail[0] === railBefore[1] &&
        railAfterDragFromRail[1] === railBefore[0] &&
        JSON.stringify(tabsAfterRailDrag) === JSON.stringify(railAfterDragFromRail),
      `rail 前=${JSON.stringify(railBefore)} rail 後=${JSON.stringify(railAfterDragFromRail)} 分頁=${JSON.stringify(tabsAfterRailDrag)}`,
    )

    // ── 拖曳排序不得毀掉終端的畫面
    //
    // 若終端的**掛載順序**跟著拖曳排序走，React 會用 insertBefore 搬動 xterm 的 DOM 節點，
    // 而 xterm 被移動後畫面會空掉 —— 直到有新輸出或 resize 才重繪（實測：拖曳後點回某個
    // session 是一片空白，隨便打個字才冒出來）。切走再切回，斷言它的歷史內容還在。
    await realClick(app.client, await app.client.evaluate(TAB_RECT(1)))
    await sleep(400)
    await realClick(app.client, await app.client.evaluate(TAB_RECT(0)))
    await sleep(600)

    const textAfterReorder = await app.client.evaluate(TERMINAL_TEXT)
    check(
      results,
      `${label}：拖曳排序後切回 session，其終端內容仍在（未變空白）`,
      String(textAfterReorder).includes('OUT_42'),
      `…${String(textAfterReorder).replace(/\s+/g, ' ').slice(-70)}`,
    )

    // ── 未位移的按下放開仍是點擊（切換 focus，順序不變）
    const orderBeforeClick = await app.client.evaluate(TAB_LABELS)
    await realClick(app.client, await app.client.evaluate(TAB_RECT(1)))
    await sleep(300)
    const orderAfterClick = await app.client.evaluate(TAB_LABELS)
    const tabsAfterClick = await app.client.evaluate(TABS)
    check(
      results,
      `${label}：未位移的按下放開是點擊（切換 focus，順序不變）`,
      JSON.stringify(orderBeforeClick) === JSON.stringify(orderAfterClick) &&
        tabsAfterClick[1]?.selected === true,
      // 印出實際順序 —— 只斷言布林值的 check()，失敗時什麼線索都不會留下。
      `前=${JSON.stringify(orderBeforeClick)} 後=${JSON.stringify(orderAfterClick)} ` +
        `selected=${JSON.stringify(tabsAfterClick.map((t) => t.selected))}`,
    )

    // ── 關閉一個分頁 → 該 pty 被清掉
    await app.client.evaluate(CLOSE_FIRST_TAB)
    const tabs3 = await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)
    const pids3 = await waitForPtyCount(marker, 1)
    check(
      results,
      `${label}：關閉分頁同時終止其 pty`,
      tabs3.length === 1 && pids3.length === 1,
      `tabs=${tabs3.length} pids=${pids3.length}`,
    )

    // ── 自 rail 的 folder 列建立 session（不必先切到主舞台）
    await openSessionViaRail(app.client, copy('sessions.spawnShell'))
    const tabsAfterRailCreate = await pollUntil(app.client, TABS, (value) => value.length === 2, 8000)
    const pidsAfterRailCreate = await waitForPtyCount(marker, 2)
    check(
      results,
      `${label}：自 rail 的 folder 列建立 session`,
      tabsAfterRailCreate.length === 2 &&
        tabsAfterRailCreate[1]?.selected === true &&
        pidsAfterRailCreate.length === 2,
      `tabs=${tabsAfterRailCreate.length} focused=${tabsAfterRailCreate[1]?.selected} pids=${pidsAfterRailCreate.length}`,
    )

    // ── 自 rail 的 session 子列關閉 session
    const railClose = await app.client.evaluate(RAIL_CLOSE_SESSION_RECT(1))
    await realClick(app.client, railClose)
    const tabsAfterRailClose = await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)
    const pidsAfterRailClose = await waitForPtyCount(marker, 1)
    check(
      results,
      `${label}：自 rail 的 session 子列關閉 session 並終止其 pty`,
      tabsAfterRailClose.length === 1 && pidsAfterRailClose.length === 1,
      `tabs=${tabsAfterRailClose.length} pids=${pidsAfterRailClose.length}`,
    )

    // ── pty 自行結束：標示為已結束，但**不從清單消失**（使用者要讀得到最後的輸出）
    await realClick(app.client, await app.client.evaluate(TERMINAL_RECT))
    await sleep(200)
    await typeLine(app.client, 'exit')

    const exitedTabs = await pollUntil(
      app.client,
      TABS,
      (value) => value.length === 1 && value[0].exited === true,
      8000,
    )
    const pidsAfterExit = await waitForPtyCount(marker, 0)
    check(
      results,
      `${label}：pty 自行結束後 session 標示為已結束且仍留在清單`,
      exitedTabs.length === 1 && exitedTabs[0].exited === true && pidsAfterExit.length === 0,
      `${JSON.stringify(exitedTabs)} pids=${pidsAfterExit.length}`,
    )

    // 已結束的 session 仍可手動關閉（此時已無 pty 需要終止）
    await app.client.evaluate(CLOSE_FIRST_TAB)
    const tabsAfterCloseExited = await pollUntil(app.client, TABS, (value) => value.length === 0, 8000)
    check(
      results,
      `${label}：已結束的 session 可手動關閉`,
      tabsAfterCloseExited.length === 0,
      `tabs=${tabsAfterCloseExited.length}`,
    )

    // ── claude 目標的 session：pty 宣告的標題**會**被採用
    //
    // 這一整段的載體是 PATH 上的 stub `claude`（見 `makeStubClaude`）—— 產品從 PATH spawn
    // `claude`，那正是它的正常行為，探針動的是環境而非產品程式碼。stub 是個互動 shell，
    // 因此下面的 `printf '\033]0;…'` 就是「pty 內的程式宣告自己的身分」。
    await openSessionViaMenu(app.client, copy('sessions.spawnClaude'))
    const tabsClaude = await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)
    check(
      results,
      `${label}：claude 模式可建立 session`,
      tabsClaude.length === 1,
      JSON.stringify(tabsClaude.map((t) => t.label)),
    )
    check(results, `${label}：建立 claude session 後 app 仍運作`, (await app.client.evaluate(MOUNTED)) === true)

    // 尚未宣告標題 → 本地標籤（序號承自 folder 內的計數）
    check(
      results,
      `${label}：claude session 未宣告標題時為本地標籤`,
      tabsClaude[0]?.label.includes('claude'),
      JSON.stringify(tabsClaude.map((t) => t.label)),
    )

    const claudeTermRect = await pollUntil(app.client, TERMINAL_RECT, (value) => value !== null, 10_000)

    // **正對照組：我們驅動的必須是自己那支 stub claude。**
    //
    // 少了這條斷言，一個很難察覺的錯誤會靜悄悄地發生：`~/.profile` 把 `$HOME/.local/bin`
    // prepend 到 PATH，於是**真的 claude** 被 spawn 起來，探針真的開了一個 Claude Code session
    // （實測踩過 —— 分頁標籤變成它宣告的任務描述，四條斷言以看不懂的方式失敗）。
    let stubRan = false
    for (let i = 0; i < 60 && !stubRan; i++) {
      stubRan = existsSync(stub.receipt)
      if (!stubRan) await sleep(250)
    }
    check(
      results,
      `${label}：claude 目標 spawn 的是探針的 stub（不是本機真的 claude）`,
      stubRan === true,
      stubRan ? '' : `未見憑據：${stub.receipt}`,
    )

    await sleep(1500) // 等 stub 的 shell 畫出它的第一個 prompt
    await realClick(app.client, claudeTermRect)
    await sleep(200)
    await typeLine(app.client, "printf '\\033]0;claude-osc-title\\007'")

    const claudeTitled = await pollUntil(
      app.client,
      TABS,
      (value) => value.some((tab) => tab.label.includes('claude-osc-title')),
      10_000,
    )
    check(
      results,
      `${label}：claude session 的分頁標籤跟隨 pty 宣告的終端標題`,
      claudeTitled.some((tab) => tab.label.includes('claude-osc-title')),
      JSON.stringify(claudeTitled.map((t) => t.label)),
    )

    const claudeRail = await pollUntil(
      app.client,
      RAIL_SESSION_ROWS,
      (value) => value.some((row) => row.includes('claude-osc-title')),
      6000,
    )
    check(
      results,
      `${label}：rail 子列同步跟隨 pty 宣告的標題`,
      claudeRail.some((row) => row.includes('claude-osc-title')),
      JSON.stringify(claudeRail),
    )

    // ── 命名權：使用者命名 ＝ **永久**接管，pty 其後的標題靜默不予呈現
    //
    // 這一段是 session-title-authority 的主場，**取代了原本「pty 想改名要先問過」那組斷言** ——
    // 那個確認對話框已移除：`claude` 隨任務進展持續改標題，每次都問一遍就是無限打斷（第二次
    // dogfooding 抓到的），而它問的又是一個答案可預測的問題（使用者才剛親手命名）。
    const claudeTab0 = center(await app.client.evaluate(TAB_RECT(0)))
    await realMouse(app.client, claudeTab0.x, claudeTab0.y, 'right')
    await pollUntil(app.client, MENU_IN_VIEWPORT, (value) => value !== null, 4000)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await sleep(300) // 對話框開啟時輸入框已 focus 且全選 —— 直接打字即取代
    await app.client.send('Input.insertText', { text: 'my-claude' })
    await pressEnter(app.client)

    const claudeRenamed = await pollUntil(
      app.client,
      TAB_LABELS,
      (value) => value[0]?.includes('my-claude'),
      6000,
    )
    check(
      results,
      `${label}：claude session 可由使用者命名，且優先於 pty 的標題`,
      claudeRenamed[0]?.includes('my-claude'),
      JSON.stringify(claudeRenamed),
    )

    await realClick(app.client, claudeTermRect)
    await sleep(200)

    // **兩個標題，一次打完：先送「同一個」，再送一個「不同的」。**
    //
    // 第一個 `claude-osc-title` 正是 pty 先前宣告過、使用者命名前看到的那個 —— 使用者回報的情境
    // 就是「改名成 b 之後，claude 一直要改回 a」。**舊實作連這個都會再問一次**：「與待裁決的標題
    // 相同就不問」那條短路，在使用者按下「保留我的名字」的瞬間就失效了（待裁決欄位已被清空）。
    //
    // 第二個 `pty-later` 是一個貨真價實的新標題 —— 它同時是下面那個對照組的錨。
    await typeLine(
      app.client,
      "printf '\\033]0;claude-osc-title\\007'; sleep 1; printf '\\033]0;pty-later\\007'",
    )
    await sleep(3000) // 讓兩個標題都抵達，並給任何對話框足夠的時間跳出來

    const noDialogWhileOwned = await app.client.evaluate(ANY_DIALOG_OPEN)
    const labelWhileOwned = await app.client.evaluate(TAB_LABELS)
    check(
      results,
      `${label}：手動命名後 pty 反覆宣告標題，不跳任何對話框且標籤不變`,
      noDialogWhileOwned === false && labelWhileOwned[0]?.includes('my-claude'),
      `對話框=${noDialogWhileOwned} 標籤=${JSON.stringify(labelWhileOwned)}`,
    )

    // ── 清空名稱 ＝ 交還命名權，標籤**立即**回到 pty 最近宣告的標題
    //
    // **這一條同時是上面那條的對照組 —— 少了它，上面就是假綠。** 「沒有對話框」是一個否定斷言：
    // stub 若根本沒把那兩個 OSC 標題送出去（PATH 沒接好、shell 沒起來、命令沒執行），它一樣會
    // 通過。而標籤在清空的瞬間變成 `pty-later`，證明了兩件事：那些標題**真的抵達了** `setTitle()`
    //（於是「沒跳對話框」是真的沒跳，不是根本沒送）；以及接管期間 pty 的標題**持續被記錄**，
    // 交還是即時的，不必空等 pty 下一次宣告（design D3）。
    await openTabMenu(app.client, 0)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await sleep(300)
    await app.client.send('Input.insertText', { text: '' }) // 輸入框已全選 —— 送出空字串＝清空
    await pressEnter(app.client)

    const handedBack = await pollUntil(
      app.client,
      TAB_LABELS,
      (value) => value[0]?.includes('pty-later'),
      6000,
    )
    check(
      results,
      `${label}：清空名稱後標籤立即變為 pty 於接管期間最近宣告的標題`,
      handedBack[0]?.includes('pty-later'),
      JSON.stringify(handedBack),
    )

    // ── 過長的標題被截斷，但完整標題不遺失（tooltip 拿得到）
    //
    // 截斷是**呈現上**的取捨，不是資料的遺失 —— 斷言必須成對：標籤真的被截短了，**而且**
    // 完整標題仍可自該元素的提示取得。只驗前者，一個把標題直接砍掉的實作也會通過。
    const longTitle = 'a-very-long-pty-title-that-definitely-exceeds-the-label-budget'
    await realClick(app.client, claudeTermRect)
    await sleep(200)
    await typeLine(app.client, `printf '\\033]0;${longTitle}\\007'`)

    const truncated = await pollUntil(
      app.client,
      `(() => {
        const tab = document.querySelector('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')
        if (!tab) return null
        return { label: tab.innerText.replace(/\\s+/g, ' ').trim(), title: tab.getAttribute('title') ?? '' }
      })()`,
      (value) => value?.title?.includes('${longTitle}'.slice(0, 20)),
      8000,
    )
    check(
      results,
      `${label}：過長的標題被截斷，但完整標題仍可自提示取得`,
      truncated !== null &&
        !truncated.label.includes(longTitle) &&
        truncated.label.includes('…') &&
        truncated.title.includes(longTitle),
      `標籤=${truncated?.label} 提示=${String(truncated?.title).slice(0, 70)}`,
    )

    // ── 清空名稱 ＝ 交還命名權（claude 的往返已於上面的對照組驗過）
    //
    // login shell 的 session：回到**本地標籤**，即使它的 pty 曾宣告過標題（那些標題一律被丟棄）。
    await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    await pollUntil(app.client, TABS, (value) => value.length === 2, 8000)

    const shellTab = center(await app.client.evaluate(TAB_RECT(1)))
    await realMouse(app.client, shellTab.x, shellTab.y, 'right')
    await pollUntil(app.client, MENU_IN_VIEWPORT, (value) => value !== null, 4000)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await sleep(300)
    await app.client.send('Input.insertText', { text: 'named-shell' })
    await pressEnter(app.client)
    await pollUntil(app.client, TAB_LABELS, (value) => value[1]?.includes('named-shell'), 6000)

    await realMouse(app.client, shellTab.x, shellTab.y, 'right')
    await pollUntil(app.client, MENU_IN_VIEWPORT, (value) => value !== null, 4000)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await sleep(300)
    await app.client.send('Input.insertText', { text: '' })
    await pressEnter(app.client)

    const clearedShell = await pollUntil(
      app.client,
      TAB_LABELS,
      (value) => !value[1]?.includes('named-shell'),
      6000,
    )
    check(
      results,
      `${label}：login shell 的 session 清空名稱後回到本地標籤`,
      clearedShell[1]?.includes('shell'),
      JSON.stringify(clearedShell),
    )

    // ── reload：舊 pty 必須全數釋放（design D2），而 session 會被**重建**（session-persistence）
    //
    // 這是最容易漏的一條：reload 不銷毀 webContents，只掛 'destroyed' 的清理不會觸發，
    // 舊 pty 會變孤兒，且新頁面的 xterm 再也收不到它們的輸出。
    //
    // **判準是「先前那些 pid 不再存在」，不是「pty 的數量為 0」。** session-restore 之後，重建會
    // 立刻為被顯示的那個 session 起一個**新的** pty —— 數量只會在一個幾毫秒的窗口裡回到 0。
    // 這條斷言原本寫的正是「數量為 0」，它於是變成在賭一場競態；而它下面那條「分頁列回到空狀態」
    // 更是直接與新規格相反（我們刻意要把分頁重建回來），卻靠著同一場競態繼續是綠的 ——
    // **探針的斷言會隨規格過期**（同 probe:shell 與 probe:workspace 的教訓）。
    const tabsBeforeReload = await app.client.evaluate(TAB_LABELS)
    const pidsBeforeReload = ptyPids(marker)

    await app.client.send('Page.reload', {})
    await pollUntil(app.client, MOUNTED, (value) => value === true, 20_000)

    let orphans = pidsBeforeReload
    const orphanDeadline = Date.now() + 10_000
    while (Date.now() < orphanDeadline) {
      const alive = new Set(ptyPids(marker))
      orphans = pidsBeforeReload.filter((pid) => alive.has(pid))
      if (orphans.length === 0) break
      await sleep(100)
    }
    check(
      results,
      `${label}：重新載入釋放先前的所有 pty（不留孤兒）`,
      pidsBeforeReload.length > 0 && orphans.length === 0,
      `先前 pids=${pidsBeforeReload.join(',') || '無'} 殘留=${orphans.join(',') || '無'}`,
    )

    // 重新載入後 session 被重建 —— 分頁、名字、順序原樣回來。
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    const tabsAfterReload = await pollUntil(
      app.client,
      TAB_LABELS,
      (value) => value.length === tabsBeforeReload.length,
      10_000,
    )
    check(
      results,
      `${label}：重新載入後 session 被重建（分頁與名字原樣回來）`,
      JSON.stringify(tabsAfterReload) === JSON.stringify(tabsBeforeReload),
      `之前=${JSON.stringify(tabsBeforeReload)} 之後=${JSON.stringify(tabsAfterReload)}`,
    )

    // ── 關閉視窗：所有 pty 必須被清掉（真的關窗，再回查行程表）
    await sleep(300)
    await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    const tabsAfterCreate = await pollUntil(
      app.client,
      TABS,
      (value) => value.length === tabsBeforeReload.length + 1,
      8000,
    )
    check(
      results,
      `${label}：重新載入後仍可建立新 session`,
      tabsAfterCreate.length === tabsBeforeReload.length + 1,
      `分頁數=${tabsAfterCreate.length}（重建了 ${tabsBeforeReload.length} 個）`,
    )

    await app.quitGracefully()
    const pidsAfterQuit = await waitForPtyCount(marker, 0, 10_000)
    check(
      results,
      `${label}：關閉視窗終止其所有 pty（不留孤兒行程）`,
      pidsAfterQuit.length === 0,
      `殘留 pids=${pidsAfterQuit.join(',') || '無'}`,
    )
  } finally {
    await app.destroy()
    // app 該清的沒清，才會有殘留 —— 檢查完之後，探針自己收拾乾淨，不留垃圾給下一輪。
    for (const pid of ptyPids(marker)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已經沒了
      }
    }
  }
}

/** 快照是 debounce 2 秒後才落盤的 —— 要等過它，否則量到的是「還沒寫」而不是「寫錯了」。 */
const SNAPSHOT_SETTLE_MS = 3200

/** 等到帶 marker 的 pty 全部消失（app 自己清乾淨，或我們自己收拾）。 */
async function waitPtysGone(marker, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (ptyPids(marker).length === 0) return true
    await sleep(100)
  }
  return false
}

/**
 * session 跨「關閉並重新開啟應用程式」存活（session-persistence）。
 *
 * **與 `runMode` 分開走一遍完整生命週期**：建立 session → 關掉 app → 以**同一個 profile** 重新
 * 啟動 → 斷言重建。分開是因為那支已經有 108 條斷言、且對真滑鼠座標與時序極其敏感，而這裡要
 * 反覆重啟 app；把兩者攪在一起，任何一邊的 flake 都會汙染另一邊的結論。
 */
async function runRestore(label, { port, rendererUrl }) {
  console.log(`\n── ${label}（session 重建）──`)

  const marker = `spek-restore-${process.pid}-${Date.now()}`
  const { repo } = makeFixture()
  const sub = join(repo, 'packages', 'app')
  mkdirSync(sub, { recursive: true })
  const profile = seedProfile([['f1', repo]])
  const stub = makeStubClaude()

  let app = null
  try {
    // ── 第一次啟動：建立兩個 session，讓它們留下足以辨識的痕跡
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    await openSessionViaMenu(app.client, copy('sessions.spawnClaude'))
    await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)

    // claude 目標：以我們指定的對話識別碼啟動（--session-id）—— 於是它可以被持久化並在下次續接。
    await waitForPtyCount(marker, 1)
    const firstCalls = stub.calls()
    const conversation = firstCalls[0]?.split(' ')[1] ?? ''
    check(
      results,
      `${label}：新建的 claude session 以我們指定的對話識別碼啟動`,
      firstCalls.length === 1 && /^--session-id [0-9a-f-]{36}$/.test(firstCalls[0]),
      `argv=${JSON.stringify(firstCalls)}`,
    )

    // 使用者命名 —— 重建後必須原樣回來。
    await openTabMenu(app.client, 0)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await sleep(300)
    await app.client.send('Input.insertText', { text: 'agent-a' })
    await pressEnter(app.client)
    await pollUntil(app.client, TAB_LABELS, (value) => value[0]?.includes('agent-a'), 6000)

    // shell 目標：cd 到子目錄、留一行可辨識的輸出 —— 兩者都要跨重啟活下來。
    await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    await pollUntil(app.client, TABS, (value) => value.length === 2, 8000)
    await realClick(app.client, await app.client.evaluate(TERMINAL_RECT))
    await typeLine(app.client, `cd ${sub}`)
    await typeLine(app.client, 'echo MARK_$((6*7))')
    await waitForOutput(app.client, 'MARK_42')

    const labelsBefore = await app.client.evaluate(TAB_LABELS)

    // 快照是 debounce 落盤的 —— 不等它，驗到的會是「還沒寫」。
    await sleep(SNAPSHOT_SETTLE_MS)

    await app.quitGracefully()
    check(
      results,
      `${label}：關閉應用程式終止其所有 pty`,
      await waitPtysGone(marker),
      `殘留 pids=${ptyPids(marker).join(',') || '無'}`,
    )


    // ── 第二次啟動：同一個 profile
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)

    const labelsAfter = await pollUntil(
      app.client,
      TAB_LABELS,
      (value) => value.length === labelsBefore.length,
      10_000,
    )
    check(
      results,
      `${label}：重新開啟後 session 原樣重建（分頁、使用者取的名字、順序）`,
      JSON.stringify(labelsAfter) === JSON.stringify(labelsBefore),
      `之前=${JSON.stringify(labelsBefore)} 之後=${JSON.stringify(labelsAfter)}`,
    )

    // **休眠不是結束。** 這條驗的是使用者重開 app 之後看到的第一個畫面。
    const danger = await app.client.evaluate(DANGER_COLOR)
    const status = await app.client.evaluate(TAB_STATUS)
    const dormantTab = status[1] // 分頁 1（shell）此刻仍休眠 —— 只有被顯示的那個會被喚醒
    check(
      results,
      `${label}：休眠的 session 不被呈現為「已結束」`,
      !dormantTab?.title?.includes(copy('sessions.statusExited')) && dormantTab?.dot !== danger,
      `tooltip=${JSON.stringify(dormantTab?.title)} 狀態燈=${dormantTab?.dot}（danger=${danger}）`,
    )

    // **只有一個 session 有 pty** —— 其餘休眠。開 app 不該同時啟動 N 個 claude。
    await sleep(2000)
    const awake = ptySessionPids(marker)
    check(
      results,
      `${label}：重新開啟只喚醒被顯示的那一個 session（其餘休眠，沒有 pty）`,
      awake.length === 1,
      `已喚醒 ${awake.length} 個（重建了 ${labelsAfter.length} 個）cmdlines=${JSON.stringify(ptyCmdlines(marker))}`,
    )

    // 被喚醒的是 claude —— 它續接**同一個**對話（--resume，沿用原 id）。
    const resumeCalls = stub.calls()
    check(
      results,
      `${label}：重建的 claude session 續接同一個對話（--resume 同一個 id）`,
      resumeCalls.length === 2 && resumeCalls[1] === `--resume ${conversation}`,
      `argv=${JSON.stringify(resumeCalls)}`,
    )

    // claude **不重播快照** —— 它自己會重現對話，重播會讓使用者看到兩份歷史。
    const claudeText = await app.client.evaluate(TERMINAL_TEXT)
    check(
      results,
      `${label}：claude session 不重播快照（否則歷史會出現兩份）`,
      !claudeText.includes(copy('sessions.replaySeparator')),
      `終端內容=${JSON.stringify(claudeText.slice(0, 80))}`,
    )

    // ── **再關一次、再開一次，全程不碰那個休眠的 shell session。**
    //
    // 驗兩件事：(1) 未喚醒的休眠 session 於再次重啟後仍然存在；(2) 它**不會把重播的歷史再序列化
    // 回自己的快照** —— 那個 xterm 裡此刻已經有「歷史 + 分隔線」了，若關窗時照樣 serialize，
    // 下次重播就會再追加一條分隔線。使用者一路不碰它，每重開一次就多一條。
    await app.quitGracefully()
    await waitPtysGone(marker)

    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    const labelsAgain = await pollUntil(
      app.client,
      TAB_LABELS,
      (value) => value.length === labelsBefore.length,
      10_000,
    )
    check(
      results,
      `${label}：未喚醒的休眠 session 於再次重啟後仍然存在`,
      JSON.stringify(labelsAgain) === JSON.stringify(labelsBefore),
      `分頁=${JSON.stringify(labelsAgain)}`,
    )

    // ── 切到 shell session：它才被喚醒（首次被顯示時 spawn）
    await realClick(app.client, await app.client.evaluate(TAB_RECT(1)))
    const woken = await (async () => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const pids = ptySessionPids(marker)
        if (pids.length === 2) return pids
        await sleep(150)
      }
      return ptySessionPids(marker)
    })()
    check(
      results,
      `${label}：顯示一個休眠的 session 使其啟動 pty`,
      woken.length === 2,
      `已喚醒 ${woken.length} 個 session`,
    )

    // 上次的畫面被重播，且與 live 明確區分。
    const replayed = await pollUntil(
      app.client,
      TERMINAL_TEXT,
      (value) => value.includes('MARK_42'),
      10_000,
    )
    // **順序也要驗，不能只驗「這些字串都在」。**
    //
    // 只斷言 `includes('MARK_42')` 的版本，對一個把畫面弄壞的實作照樣是綠的：`?1049l` 曾把游標
    // 拉回左上角，於是分隔線蓋掉了歷史的第二行、live 的 prompt 又蓋掉第三行 —— `MARK_42` 仍然
    // 「存在」（雖然它變成了 `RK_42` 且跑到分隔線後面）。**歷史必須完整，且整段在分隔線之前。**
    const historyEnd = replayed.indexOf(copy('sessions.replaySeparator'))
    const history = historyEnd === -1 ? '' : replayed.slice(0, historyEnd)
    check(
      results,
      `${label}：重建的 shell session 完整顯示上次的畫面`,
      history.includes('MARK_42') && history.includes('echo MARK_'),
      `分隔線之前的內容=${JSON.stringify(history.slice(-120))}`,
    )
    check(
      results,
      `${label}：重播的歷史與 live 內容明確區分`,
      historyEnd !== -1,
      '缺少分隔 —— 使用者會以為那個 shell 還活著',
    )

    // 經過兩次「重建但不喚醒」之後，分隔線仍然**恰好一條**。
    const separators = replayed.split(copy('sessions.replaySeparator')).length - 1
    check(
      results,
      `${label}：休眠期間不把重播的歷史再序列化回快照（分隔線不累積）`,
      separators === 1,
      `分隔線數量=${separators}（每重開一次就多一條，表示休眠中的終端把自己的重播內容寫回了快照）`,
    )

    // shell 於**最後已知的工作目錄**重生（不是 folder 根目錄）。
    await realClick(app.client, await app.client.evaluate(TERMINAL_RECT))
    await typeLine(app.client, 'echo CWD=$(pwd)')
    const cwdText = await pollUntil(
      app.client,
      TERMINAL_TEXT,
      (value) => value.includes('CWD=/'),
      10_000,
    )
    check(
      results,
      `${label}：重建的 shell session 於最後已知的工作目錄重生`,
      cwdText.includes(`CWD=${sub}`),
      `期待 CWD=${sub}；實得 ${JSON.stringify(cwdText.slice(-100))}`,
    )

    // 喚醒之後，pty 最終要拿到終端真正的尺寸（而不是 spawn 時的 80 欄）。
    //
    // **這條擋的是「完全沒有人告訴 pty 尺寸」的回歸，它證明不了那個競態被修好了。**
    // dogfooding 抓到的 bug 是：`active` 的 effect 先 `fit()` 成功（量到 63）→ 送出 resize →
    // **pty 還不存在，被丟掉** → 而 `lastCols` 已記成 63，之後 ResizeObserver 的 `fit()` 一律回
    // `null`，於是 pty 一輩子停在 80 欄。但**走不走到這條路，取決於 xterm 何時量到字元尺寸** ——
    // 探針一直走另一條（`fit()` 當下回 null → ResizeObserver 事後補救成功）。**對照組證實：把修正
    // 拿掉，這條斷言照樣是綠的。** 真正的防護是 `TerminalView` 裡「pty 一誕生就告訴它當下尺寸」
    // 的那個 effect，它由 code review 與 design 承擔（比照 OSC 8 linkHandler 的先例）。
    //
    // 判準是「**不等於 spawn 的預設值 80**」，不是「大於 80」—— 探針視窗裡終端的真實寬度是 60 幾欄。
    // 回顯不含答案：`$(stty size)` 在輸入行的回顯裡不會展開。
    await typeLine(app.client, "echo COLS=$(stty size | cut -d' ' -f2)")
    const colsText = String(
      await pollUntil(app.client, TERMINAL_TEXT, (value) => /COLS=\d+/.test(value), 10_000).catch(
        () => '',
      ),
    )
    const cols = Number(colsText.match(/COLS=(\d+)/)?.[1] ?? 0)
    check(
      results,
      `${label}：喚醒的 session 其 pty 最終取得終端的真實尺寸（不是 spawn 時的 80 欄）`,
      cols > 0 && cols !== 80,
      `pty 的欄數=${cols}（停在 80 就表示喚醒之後沒有人告訴過它真正的尺寸）`,
    )

    // ── 已結束的 session 不持久化
    await typeLine(app.client, 'exit')
    await pollUntil(
      app.client,
      TABS,
      (value) => value.some((tab) => tab.label?.includes(copy('sessions.exitedBadge')) || true),
      3000,
    ).catch(() => {})
    await sleep(800)
    await app.quitGracefully()
    await waitPtysGone(marker)

    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    const afterExit = await pollUntil(app.client, TAB_LABELS, (value) => value.length >= 1, 10_000)
    check(
      results,
      `${label}：已結束的 session 不被持久化（重開後不出現）`,
      afterExit.length === 1 && afterExit[0].includes('agent-a'),
      `分頁=${JSON.stringify(afterExit)}`,
    )
    await app.quitGracefully()
    await waitPtysGone(marker)
    app = null

    // ── 損毀韌性：整份無法解析 → app 照常啟動、無 session、原檔保留
    writeFileSync(join(profile, 'sessions.json'), '{ 損毀的內容')
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(1200)
    const tabsAfterCorrupt = await app.client.evaluate(TAB_LABELS)
    const quarantined = readdirSync(profile).filter((entry) => entry.includes('.corrupt-'))
    check(
      results,
      `${label}：持久化檔案損毀時應用程式照常啟動，且原檔保留`,
      tabsAfterCorrupt.length === 0 && quarantined.length === 1,
      `分頁=${tabsAfterCorrupt.length} 隔離檔=${quarantined.join(',') || '無'}`,
    )
    await app.quitGracefully()
    await waitPtysGone(marker)
    app = null
  } finally {
    if (app) await app.destroy()
    for (const pid of ptyPids(marker)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已經走了
      }
    }
  }
}

/**
 * 續接失敗的自癒，以及「非正常結束仍保有最近一次快照」。
 *
 * 這兩條各自需要一個**不同的 stub**（`resumeFails`）或一次**非正常的死法**（SIGKILL），因此獨立
 * 一段，不與上面那段共用 app。
 */
async function runHealAndCrash(label, { port, rendererUrl }) {
  console.log(`\n── ${label}（自癒與非正常結束）──`)

  const marker = `spek-heal-${process.pid}-${Date.now()}`
  const { repo } = makeFixture()
  const profile = seedProfile([['f1', repo]])
  // 這支 stub 對 `--resume` 一律以非零碼結束 —— 正是「從未與該 session 對話過」時 claude 的行為。
  const stub = makeStubClaude({ resumeFails: true })

  let app = null
  try {
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    await openSessionViaMenu(app.client, copy('sessions.spawnClaude'))
    await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)
    await waitForPtyCount(marker, 1)
    const created = stub.calls()[0]?.split(' ')[1] ?? ''

    await openTabMenu(app.client, 0)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await sleep(300)
    await app.client.send('Input.insertText', { text: 'healme' })
    await pressEnter(app.client)
    await pollUntil(app.client, TAB_LABELS, (value) => value[0]?.includes('healme'), 6000)

    await app.quitGracefully()
    await waitPtysGone(marker)

    // ── 重新開啟：--resume 會失敗（沒有對話可續）→ 必須自癒成一個全新的對話
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await pollUntil(app.client, TAB_LABELS, (value) => value.length === 1, 10_000)

    const healed = await (async () => {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const calls = stub.calls()
        if (calls.length >= 3) return calls
        await sleep(200)
      }
      return stub.calls()
    })()

    check(
      results,
      `${label}：續接失敗時以全新的對話識別碼自癒（不沿用舊 id —— 那會撞號）`,
      healed.length === 3 &&
        healed[1] === `--resume ${created}` &&
        /^--session-id [0-9a-f-]{36}$/.test(healed[2]) &&
        healed[2].split(' ')[1] !== created,
      `argv=${JSON.stringify(healed)}`,
    )

    // 身分不變：分頁還在、名字還在、session 可用。
    const healedLabels = await app.client.evaluate(TAB_LABELS)
    check(
      results,
      `${label}：自癒不改變 session 的身分（分頁與名字不變）`,
      healedLabels.length === 1 && healedLabels[0].includes('healme'),
      `分頁=${JSON.stringify(healedLabels)}`,
    )
    check(
      results,
      `${label}：自癒後的 session 有一個活著的 pty`,
      ptySessionPids(marker).length === 1,
      `已喚醒 ${ptySessionPids(marker).length} 個 session`,
    )

    // 啟動的嘗試不超過兩次 —— claude 若根本起不來，不可反覆重試。
    await sleep(1500)
    check(
      results,
      `${label}：自癒至多一次（啟動的嘗試不超過兩次）`,
      stub.calls().length === 3,
      `argv=${JSON.stringify(stub.calls())}`,
    )

    // **自癒重生的 pty 也必須拿到終端的真實尺寸。**
    //
    // 自癒對 renderer **完全不可見**（`status` 一直是 `running`）—— 那個「pty 誕生時推尺寸」的
    // effect 不會重跑，`fit()` 又因「尺寸沒變」回 `null`。少了「繼承將死那顆 pty 的尺寸」，自癒
    // 出來的 pty 一輩子停在 80×24。**而自癒是主線情境**（沒跟 claude 講過話的 session，續接必定
    // 失敗），這條路上的尺寸壞掉比 wake 那條更常被看到。
    //
    // stub claude 自己 `exec "$SHELL" -i`，所以這個 session 是個可以打字的互動 shell。
    await realClick(app.client, await app.client.evaluate(TERMINAL_RECT))
    await typeLine(app.client, "echo HCOLS=$(stty size | cut -d' ' -f2)")
    const healedCols = Number(
      String(
        await pollUntil(
          app.client,
          TERMINAL_TEXT,
          (value) => /HCOLS=\d+/.test(value),
          10_000,
        ).catch(() => ''),
      ).match(/HCOLS=(\d+)/)?.[1] ?? 0,
    )
    check(
      results,
      `${label}：自癒重生的 pty 也採用終端的真實尺寸（不是 spawn 時的 80 欄）`,
      healedCols > 0 && healedCols !== 80,
      `pty 的欄數=${healedCols}（停在 80 就表示自癒那條路沒有把尺寸帶過去）`,
    )

    // ── 被竄改的對話識別碼絕不可被拼進命令
    await app.quitGracefully()
    await waitPtysGone(marker)

    const persisted = JSON.parse(readFileSync(join(profile, 'sessions.json'), 'utf8'))
    const pwned = join(repo, 'pwned')
    persisted.sessions[0].claudeSessionId = `x; touch ${pwned}`
    writeFileSync(join(profile, 'sessions.json'), JSON.stringify(persisted))

    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await waitForPtyCount(marker, 1)
    await sleep(800)

    const afterTamper = stub.calls().slice(3)
    check(
      results,
      `${label}：被竄改的對話識別碼不進入命令，該 session 以全新對話重建`,
      !existsSync(pwned) &&
        afterTamper.length === 1 &&
        /^--session-id [0-9a-f-]{36}$/.test(afterTamper[0]),
      `注入的檔案存在=${existsSync(pwned)} argv=${JSON.stringify(afterTamper)}`,
    )

    // ── 非正常結束（SIGKILL）：最近一次快照仍在
    await app.quitGracefully()
    await waitPtysGone(marker)

    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await pollUntil(app.client, TABS, (value) => value.length === 1, 10_000)

    await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    await pollUntil(app.client, TABS, (value) => value.length === 2, 8000)
    await realClick(app.client, await app.client.evaluate(TERMINAL_RECT))
    await typeLine(app.client, 'echo CRASH_$((8*8))')
    await waitForOutput(app.client, 'CRASH_64')

    // 滾動快照是 debounce 落盤的 —— 等過它，然後**不給 app 任何收尾的機會**。
    await sleep(SNAPSHOT_SETTLE_MS)
    await app.destroy()
    for (const pid of ptyPids(marker)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已經走了
      }
    }
    app = null
    await sleep(500)

    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await pollUntil(app.client, TAB_LABELS, (value) => value.length === 2, 10_000)
    await realClick(app.client, await app.client.evaluate(TAB_RECT(1)))

    const crashText = await pollUntil(
      app.client,
      TERMINAL_TEXT,
      (value) => value.includes('CRASH_64'),
      10_000,
    ).catch(() => '')
    check(
      results,
      `${label}：應用程式被強制結束後，最近一次快照仍可還原畫面`,
      String(crashText).includes('CRASH_64'),
      // 這條擋住「只在關閉視窗時才序列化」的實作 —— SIGKILL 收不到任何收尾的機會。
      `終端內容=${JSON.stringify(String(crashText).slice(-120))}`,
    )
  } finally {
    if (app) await app.destroy()
    for (const pid of ptyPids(marker)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已經走了
      }
    }
  }
}

/**
 * 關掉 app 時終端正處於 **alternate screen**（開著 vim）或**滑鼠追蹤**模式 —— 重播不得讓**新的**
 * shell 卡在那個模式裡。
 *
 * 歷史是死的文字，live 不該繼承它的狀態。卡住的症狀很難懂：新 shell 的輸出**看不見**（它被畫到
 * 另一個緩衝區去了），使用者只會覺得「終端壞了」。
 */
async function runAltScreen(label, { port, rendererUrl }) {
  console.log(`\n── ${label}（alternate screen 的殘留）──`)

  const marker = `spek-alt-${process.pid}-${Date.now()}`
  const { repo } = makeFixture()
  const profile = seedProfile([['f1', repo]])
  const stub = makeStubClaude()

  let app = null
  try {
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    await openSessionViaMenu(app.client, copy('sessions.spawnShell'))
    await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)
    await realClick(app.client, await app.client.evaluate(TERMINAL_RECT))

    // 進入 alternate screen（`?1049h`）並開啟滑鼠追蹤（`?1003h`）—— 這正是 vim 開著時的狀態。
    await typeLine(app.client, "printf '\\033[?1049h\\033[?1003h'; echo INSIDE_ALT")
    await waitForOutput(app.client, 'INSIDE_ALT')

    await sleep(SNAPSHOT_SETTLE_MS)
    await app.quitGracefully()
    await waitPtysGone(marker)

    // ── 重開：新的 shell 必須是可用的
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await pollUntil(app.client, TABS, (value) => value.length === 1, 10_000)
    await waitForPtyCount(marker, 1)
    await realClick(app.client, await app.client.evaluate(TERMINAL_RECT))

    // 回顯不含答案 —— 只有真的執行了才會出現 `ALT_OK_81`。
    await typeLine(app.client, 'echo ALT_OK_$((9*9))')
    const text = String(
      await pollUntil(app.client, TERMINAL_TEXT, (value) => value.includes('ALT_OK_81'), 10_000).catch(
        () => '',
      ),
    )

    // **判準是「normal buffer 的歷史看得見」，不是「新 shell 的輸出看得見」。**
    //
    // 後者是個假綠（對照組證明過）：卡在 alternate buffer 裡的 shell，它的輸出**照樣看得見**
    // —— 只是被畫在 vim 的那塊畫面上。使用者失去的是**歷史與 scrollback**（normal buffer 被
    // 蓋住了）。真正有鑑別力的是那行 `printf` —— 它在 normal buffer 裡，只有真的離開了
    // alternate buffer 才看得到它。
    check(
      results,
      `${label}：關閉時處於 alternate screen，重建後離開它（歷史與 scrollback 都還在）`,
      text.includes('printf') && text.includes('ALT_OK_81'),
      `終端內容=${JSON.stringify(text.slice(-160))}`,
    )
  } finally {
    if (app) await app.destroy()
    for (const pid of ptyPids(marker)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已經走了
      }
    }
  }
}

/**
 * **休眠的 session 絕不能只是一塊空白終端**（session-persistence 明文要求）。
 *
 * 這條原本是零覆蓋的 —— 而它是壞的：休眠提示是 host div 的 React child，xterm 的 `.xterm`
 * （`position: relative`）由 `handle.open(host)` 在 effect 裡 append，**排在 React children 之後**。
 * 兩者都是 `z-index: auto` → 依 tree order 繪製 → **xterm 蓋在提示上**，而 `.xterm-viewport`
 * 的背景是不透明的。休眠的 claude 分頁於是看起來就是一塊空白終端。
 *
 * **載體：folder 的路徑失效。** 休眠的 session 一被顯示就會醒過來，那個提示只是一瞬間 ——
 * 除非它**醒不過來**。路徑失效時 `create` 以 FOLDER_UNAVAILABLE 拒絕，session 停在休眠態並
 * 呈現原因。這給了一個穩定可觀察的休眠畫面，同時也驗到了「喚醒失敗要說明原因，而不是靜默
 * 地什麼都不發生」。
 *
 * 判準是 `elementFromPoint` —— 只有真的畫在最上層才拿得到它。斷言「DOM 裡有這個節點」是驗不到
 * 堆疊順序的（它一直都在，只是被蓋住）。
 */
async function runDormantHint(label, { port, rendererUrl }) {
  console.log(`\n── ${label}（休眠的呈現）──`)

  const marker = `spek-hint-${process.pid}-${Date.now()}`
  const { repo } = makeFixture()
  const profile = seedProfile([['f1', repo]])
  const stub = makeStubClaude()

  // 直接種一份持久化的 session，然後把 repo 目錄整個刪掉 —— folder 仍在 workspace 裡，但路徑失效。
  writeFileSync(
    join(profile, 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        {
          id: '9f1e7a2c-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
          folderId: 'f1',
          spawnTarget: 'claude',
          ordinal: 1,
          customTitle: 'ghost',
        },
      ],
    }),
  )
  rmSync(repo, { recursive: true, force: true })

  let app = null
  try {
    app = await launch({ port, profileDir: profile, rendererUrl, marker, stub })
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await pollUntil(app.client, TABS, (value) => value.length === 1, 10_000)

    // 顯示它 → 嘗試喚醒 → folder 路徑失效 → 停在休眠態並說明原因。
    const hint = await pollUntil(
      app.client,
      `(() => {
        const term = document.querySelector('section[aria-label="${copy('stage.terminal')}"]')
        if (!term) return null
        const box = term.getBoundingClientRect()
        // 終端正中央實際被畫在最上層的是誰？
        const top = document.elementFromPoint(
          Math.round(box.left + box.width / 2),
          Math.round(box.top + box.height / 2),
        )
        return top ? { text: top.innerText ?? '', className: String(top.className ?? '') } : null
      })()`,
      (value) => Boolean(value?.text),
      12_000,
    ).catch(() => null)

    check(
      results,
      `${label}：休眠的 session 不呈現為一塊空白終端（提示畫在最上層）`,
      Boolean(hint?.text) && !hint.className.includes('xterm'),
      `終端中央最上層的元素=${JSON.stringify(hint)}`,
    )
    check(
      results,
      `${label}：喚醒失敗時說明原因，而不是靜默地什麼都不發生`,
      Boolean(hint?.text?.includes(prefixOf('sessions.wakeFailed'))),
      `提示內容=${JSON.stringify(hint?.text)}`,
    )
    check(
      results,
      `${label}：喚醒失敗的 session 不留下任何 pty`,
      ptyPids(marker).length === 0,
      `殘留 pids=${ptyPids(marker).join(',') || '無'}`,
    )
  } finally {
    if (app) await app.destroy()
    for (const pid of ptyPids(marker)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 已經走了
      }
    }
  }
}

async function main() {
  let devServer = null
  try {
    await runMode('build', { port: BUILD_PORT, rendererUrl: null })
    await runRestore('build', { port: BUILD_PORT, rendererUrl: null })
    await runHealAndCrash('build', { port: BUILD_PORT, rendererUrl: null })
    await runAltScreen('build', { port: BUILD_PORT, rendererUrl: null })
    await runDormantHint('build', { port: BUILD_PORT, rendererUrl: null })

    devServer = await startRendererDevServer()
    await runMode('dev', { port: DEV_PORT, rendererUrl: devServer.url })
    await runRestore('dev', { port: DEV_PORT, rendererUrl: devServer.url })
    await runHealAndCrash('dev', { port: DEV_PORT, rendererUrl: devServer.url })
    await runAltScreen('dev', { port: DEV_PORT, rendererUrl: devServer.url })
    await runDormantHint('dev', { port: DEV_PORT, rendererUrl: devServer.url })
  } finally {
    if (devServer) {
      try {
        // dev server 以 detached 起成 group leader —— 殺整組，否則 vite 會變孤兒佔著 port。
        process.kill(-devServer.child.pid, 'SIGKILL')
      } catch {
        // 已經結束
      }
    }
    for (const dir of temps) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // 暫存目錄清不掉不影響結論
      }
    }
  }

  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} 通過`)
  process.exit(passed === results.length ? 0 : 1)
}

await main()
