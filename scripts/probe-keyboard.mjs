/**
 * `keyboard-navigation` 的驗收。
 *
 * 一律透過 CDP 連進真正執行中的 app —— 不在產品程式碼裡塞測試分支。dev 與 build 兩種模式都跑。
 *
 * ## 這支探針能證明什麼、不能證明什麼
 *
 * `Input.dispatchKeyEvent` 是把事件**注入 Chromium 的輸入管線**，它**繞過**作業系統與瀏覽器的
 * accelerator 層。因此：
 *
 * - **能證明**：handler 的邏輯正確（切對了 session／repo、順序是位置序而非 MRU、對話框開著時
 *   讓位），以及**被攔下的按鍵沒有流進 pty**。
 * - **不能證明**：一顆**真實鍵盤**送出的 `Ctrl+Tab` 抵達得了 renderer（若 Chromium 把它保留給
 *   分頁切換，這支探針照樣全綠）。那道缺口只能由真人按一次鍵補上 —— 它列在 change 的 tasks 第 7 節，
 *   **不假裝這裡涵蓋了它**。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, pollFor, pollUntil, waitForPageTarget } from './lib/cdp.mjs'
import { sectionConsole } from './lib/instrument.mjs'
import { copy, prefixOf } from './lib/copy.mjs'
import { MOUNTED, describeMounted } from './lib/mounted.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { runSections } from './lib/sections.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'

const BUILD_PORT = PROBE_PORTS.keyboard.build
const DEV_PORT = PROBE_PORTS.keyboard.dev

/** 可預測、無 profile 雜訊，且處處存在。 */
const SHELL_PATH = '/bin/sh'

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

/** pty 寫檔的觀測落點。刻意在 repo 之外 —— repo 內有 chokidar 在監看。 */
let ptyOutDir = null

function makeFixture() {
  const base = mkTemp('spekterm-keyboard-fixture-')
  const repos = ['repo-a', 'repo-b', 'repo-c'].map((name) => {
    const repo = join(base, name)
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'notes.txt'), `${name} 的內容\n第二行\n`)
    return [name, repo]
  })
  ptyOutDir = join(base, 'probe-out')
  mkdirSync(ptyOutDir, { recursive: true })
  return repos
}

/**
 * 送一顆 Enter（不打任何字）。
 *
 * **這是「讀檔」判定按鍵是否進 pty 的關鍵一步，而它不直觀。** tty 處於 **canonical mode**，
 * 輸入會停在**行緩衝**裡 —— **沒有換行，`cat` 永遠讀不到那些位元組**，檔案自然是空的
 * （實測：`cat -A > f` 與 `stdbuf -o0 cat -A > f` 都拿不到，不是緩衝設定的問題，是行紀律）。
 * 按完待測的鍵之後補一顆 Enter，那一行才會被送進 `cat`，也才會落檔。
 */
async function pressEnter(client) {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/**
 * 等 pty 寫出的檔案出現並滿足條件，回傳內容。
 *
 * 判定「按鍵有沒有流進 pty」為什麼要走磁碟：**畫面上那串 caret 記法（`^[[A`）不是 `cat` 印的，
 * 是 tty 自己的 echo**（canonical mode 的 `echoctl`）—— 實測**完全不跑 `cat`，畫面照樣有它**。
 * 於是「讀畫面」讀到的是 tty 的行為，而 `cat -A > file` 讓那些位元組真的落到磁碟上，
 * 且**渲染方式怎麼變都不影響它**。
 */
async function waitForPtyFile(name, settled, timeoutMs = 8000) {
  const path = join(ptyOutDir, name)
  return pollFor({
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : ''),
    settled,
    timeoutMs,
    interval: 150,
    label: `waitForPtyFile(${name})`,
  })
}

function seedProfile(repos) {
  const profile = mkTemp('spekterm-keyboard-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: repos.map(([name, path], index) => ({
        id: `f${index + 1}`,
        path,
        addedAt: '2026-07-12T00:00:00.000Z',
        name,
      })),
    }),
  )
  return profile
}

// ── app 啟動 ────────────────────────────────────────────────────────────────

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text) => text.replace(ANSI_PATTERN, '')

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

async function launch({ port, profileDir, rendererUrl }) {
  const child = spawn(
    'electron',
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...electronExtraArgs(), '.'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SHELL: SHELL_PATH,
        ...(rendererUrl ? { ELECTRON_RENDERER_URL: rendererUrl } : {}),
      },
    },
  )

  const target = await waitForPageTarget(port, 30_000)
  const client = await connect(target)
  const mounted = await pollUntil(client, MOUNTED, (value) => value?.ok === true)

  return {
    client,
    mounted,
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
        // 沒有殘留 —— 正是我們要的。
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

/** 當前選中的 repo（rail 上被標示的那一列）。 */
const SELECTED_FOLDER = `(() => {
  const row = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] li > div[role="button"]')]
    .find((r) => r.getAttribute('aria-current') === 'true' || r.dataset.selected === 'true')
  // **以 aria-label 取名稱，不以 innerText 的第一行** —— 該列展開時，第一行是那顆 ▾ 展開鈕。
  // 這條退路此前從未被走到（產品沒有 aria-current），global-session 加上它之後才第一次生效。
  // （此處不得使用反引號 —— 這一段住在模板字串裡。這是本 change 第三次踩到它。）
  if (row) return row.getAttribute('aria-label') ?? row.innerText.split('\\n')[0].trim()
  // 退路：主舞台的 repo header 就是當前 repo
  const header = document.querySelector('main[aria-label="${copy('stage.label')}"] header')
  return header ? header.innerText.split('\\n')[0].trim() : null
})()`

const TABS = `[...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')].map((tab) => ({
  label: tab.innerText.replace(/\\s+/g, ' ').trim(),
  selected: tab.getAttribute('aria-selected') === 'true',
}))`

const FOCUSED_TAB = `(() => {
  const tab = [...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
    .find((t) => t.getAttribute('aria-selected') === 'true')
  return tab ? tab.innerText.replace(/\\s+/g, ' ').trim() : null
})()`

const RECT_OF = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const NEW_SESSION_RECT = RECT_OF(`[aria-label="${copy('sessions.new')}"]`)
const TERMINAL_RECT = RECT_OF(`section[aria-label="${copy('stage.terminal')}"]`)

/**
 * rail 上**全域項目**的建立 session 入口。
 *
 * 與 `NEW_SESSION_RECT` 是兩個東西：後者是主舞台的按鈕，而**零 folder 時沒有選中的 repo**，
 * 主舞台根本不呈現它。寫法取自 `probe-package.mjs`（那支同樣在零 folder 下建 session）。
 */
const GLOBAL_NEW_SESSION_RECT = RECT_OF(
  `aside[aria-label="${copy('rail.label')}"] [aria-label="${copy('rail.newSessionIn', { name: copy('rail.globalName') })}"]`,
)

/** 狀態列的文字。空狀態與有脈絡兩種情形都由它讀出（寫法取自 `probe-openspec.mjs`）。 */
const STATUS_BAR_TEXT = `(() => {
  const bar = document.querySelector('footer[aria-label="${copy('statusBar.label')}"]')
  return bar ? (bar.textContent ?? '') : null
})()`

/** 側欄在 Files 身分下的文字 —— 無來源時的提示由它讀出。 */
const FILES_PANEL_TEXT = `(() => {
  const panel = document.querySelector('section[aria-label="${copy('files.label')}"]')
  return panel ? (panel.textContent ?? '') : null
})()`

/** 有沒有對話框或選單開著 —— 快捷鍵的抑制條件（`KeyboardNavigation.tsx`）。 */
const SUPPRESSORS = `document.querySelectorAll('[role="dialog"], [role="menu"]').length`

const MENU_ITEM_RECT = (label) => `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return null
  const item = [...menu.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(label)}))
  if (!item) return null
  const r = item.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const TAB_RECT = (index) => `(() => {
  const tabs = [...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
  const tab = tabs[${index}]
  if (!tab) return null
  const r = tab.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/**
 * 只讀「當前顯示中」的那個終端 —— 其餘 session 的終端仍掛載，只是 display:none。
 *
 * **讀不到就丟錯，絕不回空字串**（與 `probe-terminal.mjs` 的同名 expression 同源，兩份都要改）。
 *
 * **這支探針是假綠的重災區**：它的核心保證「被攔下的按鍵沒有流進 pty」全是否定式斷言
 * （`leaked.length === 0`）—— 空字串 ⇒ `leaked` 必為空 ⇒ **通過**。也就是說，終端完全讀不到時
 * 它們照樣是綠的，而它們自稱在測的東西一個字都沒測到。
 */
const TERMINAL_TEXT = `(() => {
  const host = [...document.querySelectorAll('section[aria-label="${copy('stage.terminal')}"] > div')]
    .find((d) => !d.classList.contains('hidden'))
  if (!host) throw new Error('TERMINAL_TEXT: 找不到顯示中的終端容器（沒有 session？還是版面變了？）')
  const rows = host.querySelector('.xterm-rows')
  if (!rows) throw new Error('TERMINAL_TEXT: 終端容器在，但讀不到 .xterm-rows —— 渲染方式換了？這條觀測管道已失效，不可當成「畫面上沒有東西」')
  return rows.innerText
})()`

const DIALOG_OPEN = `Boolean(document.querySelector('[role="dialog"]'))`

const MENU_STATE = `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return null
  const r = menu.getBoundingClientRect()
  const items = [...menu.querySelectorAll('button[role="menuitem"]')]
  return {
    rect: { x: Math.round(r.x), y: Math.round(r.y) },
    items: items.map((b) => b.innerText.trim()),
    focused: items.findIndex((b) => b === document.activeElement),
  }
})()`

const IDENTITY_FILES = `(() => {
  const btn = [...document.querySelectorAll('[role="tablist"][aria-label="${copy('panelSwitch.label')}"] button[role="tab"]')]
    .find((b) => b.innerText.includes('Files'))
  if (!btn) return false
  btn.click()
  return true
})()`

const OPEN_FILE = (name) => `(() => {
  const row = [...document.querySelectorAll('section[aria-label="${copy('files.label')}"] [role="treeitem"]')]
    .find((r) => r.innerText.includes(${JSON.stringify(name)}))
  if (!row) return false
  row.click()
  return true
})()`

const EDITOR_TEXTAREA_FOCUSED = `(() => {
  const ta = document.querySelector('section[aria-label="${copy('files.label')}"] textarea')
  if (!ta) return false
  ta.focus()
  return document.activeElement === ta
})()`

/**
 * quick open 的狀態。`null` ＝ 入口未開啟。
 *
 * `titles` 是每一列的 `title` 屬性 —— 那是**完整的 folder-relative 路徑**（權威值）；
 * `shown` 是呈現的文字 —— 它剝掉了工作目錄前綴。兩者要分開看，因為「呈現剝前綴而權威不剝」
 * 正是 `side-panel-worktree` 立下的紀律，只驗一邊的話兩種錯誤實作都會通過。
 */
const QUICK_OPEN = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="${copy('quickOpen.label')}"]')
  if (!dialog) return null
  const input = dialog.querySelector('input')
  const options = [...dialog.querySelectorAll('[role="option"]')]
  return {
    query: input ? input.value : null,
    inputFocused: document.activeElement === input,
    count: options.length,
    selected: options.findIndex((o) => o.getAttribute('aria-selected') === 'true'),
    titles: options.map((o) => o.getAttribute('title')),
    shown: options.map((o) => o.innerText.replace(/\\s+/g, ' ').trim()),
  }
})()`

/** 聚焦檔案樹的第一列 —— 那是側欄之內一個真實可聚焦的元素（它帶 tabIndex）。 */
const FOCUS_FILE_TREE = `(() => {
  const row = document.querySelector('section[aria-label="${copy('files.label')}"] [role="treeitem"]')
  if (!row) return false
  row.focus()
  return document.activeElement === row
})()`

/**
 * 當前在檔案檢視器中開啟的檔案（麵包屑文字）。`null` ＝ 仍在檔案樹。
 *
 * **判準是「檔案樹還在不在」，不是「麵包屑有沒有文字」** —— 麵包屑在兩種狀態下都存在，
 * 以它的文字判定會讓「未開啟任何檔案」恆為假（實測：那條斷言因此紅了，而產品是對的）。
 * 檔案樹與檢視器是互斥渲染的，那才是兩種狀態真正的差別。
 */
const OPENED_FILE = `(() => {
  const panel = document.querySelector('section[aria-label="${copy('files.label')}"]')
  if (!panel) return null
  if (panel.querySelector('[role="treeitem"]')) return null
  const nav = panel.querySelector('nav')
  if (!nav) return null
  const text = nav.innerText.replace(/\\s+/g, ' ').trim()
  return text === '' ? null : text
})()`

/**
 * rail 上 repo 的呈現順序。
 *
 * **選擇器必須限定為頂層的 `<li>`** —— session 子列在 DOM 上同樣是 `li > div[role="button"]`
 * （它們巢狀在 folder 的 `<li>` 之內）。少了 `> ul >` 這一段，repo 一有 session，順序就會變成
 * `["▾", "shell 1", "shell 2", …]`（實測：這條斷言因此以「產品把 repo 排錯了」的樣貌紅掉）。
 *
 * 名稱取自 `title`（＝folder 的絕對路徑）的 basename，不取 `innerText` —— 後者的第一行是展開
 * 鈕的 `▾`，不是名稱。
 */
/**
 * rail 上 **folder** 的順序。
 *
 * **排除全域項目**（`global-session`）—— 它恆為第一列，但它不是 workspace 的成員，也沒有路徑
 * 可供 basename 取用（它的 `title` 是一句說明）。少了這道過濾，這份清單的第一項會變成那句
 * 說明的整串文字，而每一條順序斷言都會以「順序錯了」的樣貌失敗。
 */
const RAIL_ORDER = `[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > div[role="button"]')]
  .filter((row) => row.getAttribute('aria-label') !== ${JSON.stringify(copy('rail.globalName'))})
  .map((row) => (row.getAttribute('title') ?? '').split('/').pop())`

/** rail 上**全部**項目的 aria-label（含全域項目）—— 導航序以它為準。 */
const RAIL_ITEMS = `[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > div[role="button"]')]
  .map((row) => row.getAttribute('aria-label'))`

/** 當前選中的 rail 項目（以 aria-label 表示）。 */
const SELECTED_ITEM = `(() => {
  const rows = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > div[role="button"]')]
  // **以 aria-current 判斷，不以 class** —— 未選中的列帶著 hover:bg-hover/60，而那個字串
  // 也包含 bg-hover：以 class 判斷會恆回第一列，讓期望值為第一列的斷言變成假綠。
  // （此處不得使用反引號 —— 這整段住在一個模板字串裡，反引號會提前把它結束掉。）
  const hit = rows.find((row) => row.getAttribute('aria-current') === 'true')
  return hit ? hit.getAttribute('aria-label') : null
})()`

/** rail 上某個 repo 的 session 子列順序 —— 它必須與分頁列一致（兩個視圖共用同一順序）。 */
const RAIL_SESSIONS = (folderName) => `(() => {
  const list = document.querySelector('ul[aria-label="${copy('rail.folderSessions', { name: '%NAME%' })}"]'
    .replace('%NAME%', ${JSON.stringify(folderName)}))
  if (!list) return null
  return [...list.querySelectorAll('li > div[role="button"]')]
    .map((row) => row.innerText.split('\\n')[0].trim())
})()`

/**
 * Monaco **真的選取了文字**嗎。
 *
 * **不能用 `window.getSelection()`** —— Monaco 的選取不是 DOM selection，它自己畫（與 xterm
 * 同源的坑，`terminal-clipboard` 已經踩過）。它把選取畫成 view overlay 上的 `.selected-text`
 * 元素，那是唯一從外部觀察得到的憑據。
 */
const EDITOR_HAS_SELECTION = `Boolean(
  document.querySelector('section[aria-label="${copy('files.label')}"] .monaco-editor .selected-text')
)`

/**
 * > **這裡原本有一條「`Shift+←` 照常抵達對話框的輸入框並選取了文字」的斷言，已移除 —— CDP
 * > 驅動不了它。** 原生 `<input>` 的文字選取是**瀏覽器的預設動作**：`rawKeyDown` 刻意跳過預設
 * > 動作，而 `keyDown` 的編輯命令在 Linux 上來自平台的 key-binding 層，**合成事件繞過它**
 * > （實測：兩種送法的選取長度都恆為 0，與 app 有沒有攔截這顆鍵無關）。留著它就是一盞永遠紅、
 * > 而且測不到自己宣稱在測的東西的燈。
 * >
 * > 「讓位不是『不做事』，而是**完全不攔**」由**編輯器**那一條承擔（見下方 `EDITOR_HAS_SELECTION`）
 * > —— Monaco 在 JS 裡自己處理 keydown，不靠預設動作，因此 CDP 驅動得了它，而且對照組證明它
 * > 有鑑別力：拿掉讓路的判準，那條就變紅。比照 `probe:terminal` 對 OSC 8 `linkHandler` 的處理。
 */

// ── 輸入 ────────────────────────────────────────────────────────────────────

const center = (rect) => ({
  x: Math.round(rect.x + rect.width / 2),
  y: Math.round(rect.y + rect.height / 2),
})

async function realMouse(client, x, y, button = 'left') {
  const buttons = button === 'right' ? 2 : 1
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons, clickCount: 1 })
}

async function realClick(client, rect) {
  const at = center(rect)
  await realMouse(client, at.x, at.y, 'left')
}

/** CDP 的 modifiers 是位元遮罩：Alt=1、Ctrl=2、Meta=4、Shift=8。 */
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  t: { key: 't', code: 'KeyT', vk: 84 },
  w: { key: 'w', code: 'KeyW', vk: 87 },
  p: { key: 'p', code: 'KeyP', vk: 80 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
}

/**
 * 送一顆按鍵。`mods` 形如 `['ctrl']`、`['ctrl', 'shift']`。
 *
 * **`rawKeyDown` 而非 `keyDown`**：帶修飾鍵而不產生文字的按鍵，Chromium 的輸入管線走的是
 * raw 事件；用 `keyDown` 並附 `text` 會多出一個 `char` 事件（在終端上就是多打了一個字）。
 *
 * **但 `Enter` 是例外，它必須是 `keyDown` + `text`。** `<button>` 是靠 Enter 的**預設動作**
 * 被觸發的，而 `rawKeyDown` 刻意跳過預設動作 —— 用它送 Enter，按鈕不會有反應（實測：選單裡
 * 按 Enter 完全沒建立 session）。這與 `probe:terminal` 的「Enter 必須是一次真的按鍵事件」
 * 同源：**送不出預設動作的按鍵，等於沒按。**
 */
async function pressKey(client, name, mods = []) {
  const spec = KEYS[name]
  const modifiers = mods.reduce((mask, m) => mask | MOD[m], 0)
  const base = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk,
    modifiers,
  }

  if (name === 'Enter') {
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: '\r' })
  } else {
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  }
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(250)
}

async function typeLine(client, text) {
  await client.send('Input.insertText', { text })
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

async function createSession(client) {
  const btn = await pollUntil(client, NEW_SESSION_RECT, (value) => value !== null, 10_000)
  if (!btn) throw new Error('找不到「+ session」按鈕')
  await realClick(client, btn)

  const item = await pollUntil(client, MENU_ITEM_RECT(copy('sessions.spawnShell')), (value) => value !== null, 3000)
  if (!item) throw new Error('選單中找不到 shell')
  await realClick(client, item)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * quick open（`Ctrl+P`）的驗收。
 *
 * 觸發條件是「按鍵事件行經側欄容器」＝「焦點在側欄之內」。因此每一條斷言之前都要先確定
 * 焦點落在哪裡 —— 那不是前置作業，那就是待測的性質本身。
 *
 * **插在 runMode 的最後**：本段會建立檔案、開啟檔案、切換身分，前面每一條既有斷言都在它之前
 * 跑完（既有紀律：新段落插在既有段落之後，內部用相對數字）。
 */
async function runQuickOpen(label, app, repos) {
  const [, repoAPath] = repos[0]
  mkdirSync(join(repoAPath, 'src'), { recursive: true })
  mkdirSync(join(repoAPath, 'docs'), { recursive: true })
  writeFileSync(join(repoAPath, 'src', 'alpha.ts'), 'x')
  writeFileSync(join(repoAPath, 'src', 'beta.ts'), 'x')
  writeFileSync(join(repoAPath, 'docs', 'alpha-notes.md'), 'x')

  check(results, `${label}：quick open 前置 —— 選中 repo-a`,
    (await app.client.evaluate(SELECT_FOLDER('repo-a'))) === true)
  await sleep(400)
  check(results, `${label}：quick open 前置 —— 切至 Files 身分`,
    (await app.client.evaluate(IDENTITY_FILES)) === true)
  await sleep(800)

  const treeFocused = await pollUntil(app.client, FOCUS_FILE_TREE, (v) => v === true, 8000)
  check(results, `${label}：quick open 前置 —— 檔案樹取得焦點`, treeFocused === true)

  await pressKey(app.client, 'p', ['ctrl'])
  const opened = await pollUntil(app.client, QUICK_OPEN, (v) => v !== null, 8000)
  check(results, `${label}：檔案樹持有焦點時 Ctrl+P 開啟 quick open`,
    opened !== null && opened.inputFocused === true, JSON.stringify(opened))

  await app.client.send('Input.insertText', { text: 'alpha' })
  const filtered = await pollUntil(app.client, QUICK_OPEN,
    (v) => v !== null && v.query === 'alpha' && v.count > 0, 8000)
  check(results, `${label}：輸入片段即時篩選出相符的檔案`,
    filtered !== null && filtered.count === 2, JSON.stringify(filtered))
  check(results, `${label}：檔名命中排在路徑中段命中之前`,
    filtered !== null && filtered.titles[0] === 'src/alpha.ts', JSON.stringify(filtered && filtered.titles))

  await pressKey(app.client, 'ArrowDown')
  const moved = await app.client.evaluate(QUICK_OPEN)
  check(results, `${label}：↓ 移動選取`, moved !== null && moved.selected === 1, JSON.stringify(moved))

  await pressKey(app.client, 'p', ['ctrl'])
  await sleep(400)
  const reentered = await app.client.evaluate(QUICK_OPEN)
  check(results, `${label}：開啟期間再按 Ctrl+P 不重新開啟、不清空查詢`,
    reentered !== null && reentered.query === 'alpha' && reentered.selected === 1,
    JSON.stringify(reentered))

  await pressKey(app.client, 'Escape')
  await sleep(400)
  const quickOpenAfterEsc = await app.client.evaluate(QUICK_OPEN)
  const openedAfterEsc = await app.client.evaluate(OPENED_FILE)
  check(results, `${label}：Esc 關閉入口且未開啟任何檔案`,
    quickOpenAfterEsc === null && openedAfterEsc === null,
    `quick open=${JSON.stringify(quickOpenAfterEsc)}；開啟的檔案=${JSON.stringify(openedAfterEsc)}`)

  await pressKey(app.client, 'p', ['ctrl'])
  const reopened = await pollUntil(app.client, QUICK_OPEN, (v) => v !== null, 8000)
  check(results, `${label}：關閉後可再次以同一顆快捷鍵開啟（焦點已歸還側欄）`,
    reopened !== null, JSON.stringify(reopened))

  await app.client.send('Input.insertText', { text: 'beta' })
  await pollUntil(app.client, QUICK_OPEN, (v) => v !== null && v.count === 1, 8000)
  await pressKey(app.client, 'Enter')
  const viewing = await pollUntil(app.client, OPENED_FILE, (v) => v !== null && v.includes('beta.ts'), 8000)
  check(results, `${label}：Enter 於側欄的 Files 檢視開啟選取的檔案`,
    viewing !== null, JSON.stringify(viewing))
  check(results, `${label}：開啟後入口已關閉`, (await app.client.evaluate(QUICK_OPEN)) === null)

  await pressKey(app.client, 'p', ['ctrl'])
  const afterOpen = await pollUntil(app.client, QUICK_OPEN, (v) => v !== null, 8000)
  check(results, `${label}：開啟檔案後可再次以同一顆快捷鍵開啟（記住的元素已消失，焦點退回側欄容器）`,
    afterOpen !== null, JSON.stringify(afterOpen))
  await pressKey(app.client, 'Escape')
  await sleep(300)

  // ── 終端持有焦點時讓路給 pty
  //
  // **兩條斷言缺一不可。** 只驗「入口沒開」的話，一個「攔下按鍵但不開入口」的錯誤實作照樣
  // 通過；只驗「按鍵抵達 pty」的話，一個「兩件事都做」的實作也會通過。
  //
  // 載體是 `cat -A`（不是 `cat -v`）—— 既有紀律。`Ctrl+P` ＝ `0x10`，`-v` 會把它印成 `^P`。
  await createSession(app.client)
  const term = await pollUntil(app.client, TERMINAL_RECT, (v) => v !== null, 10_000)
  await sleep(2000)
  await realClick(app.client, term)
  await sleep(200)

  const keyLog = join(ptyOutDir, 'quickopen-keys.txt')
  await typeLine(app.client, `cat -A > ${keyLog}`)
  await sleep(1200)

  await pressKey(app.client, 'p', ['ctrl'])
  await sleep(500)
  check(results, `${label}：終端持有焦點時 Ctrl+P 不開啟 quick open`,
    (await app.client.evaluate(QUICK_OPEN)) === null)

  // tty 處於 canonical mode，沒有換行那些位元組不會離開行緩衝 —— 補一顆 Enter 才會落檔。
  await pressEnter(app.client)
  const ptyText = await waitForPtyFile('quickopen-keys.txt', (v) => v.includes('^P'), 8000)
  check(results, `${label}：Ctrl+P 照常抵達 pty（讓路，而非攔下不用）`,
    ptyText.includes('^P'), JSON.stringify(ptyText))
}

async function runMode(label, { port, rendererUrl }) {
  console.log(`\n── ${label} ──`)

  const repos = makeFixture()
  const profile = seedProfile(repos)
  const app = await launch({ port, profileDir: profile, rendererUrl })

  try {
    check(results, `${label}：app 掛載`, app.mounted?.ok === true, describeMounted(app.mounted))

    // ── renderer 的 console 錯誤進得了收集器
    //
    // **這一條驗的是驗收工具自己**，不是產品 —— 它是 `probe-execution-scope` 的一部分。放在這裡
    // 而不是 `probe:shell`，是因為出貨的讀取路徑是「`sections.mjs` 於段落結束時印出」，而
    // `probe-shell` 沒有段落機制；在那裡只能驗一個沒有人在用的存取器。
    //
    // **標記在 connect 之後發出，而那不構成假綠** —— 這一點是實測過的，不是推論：Chromium 的
    // `Runtime` 與 `Log` 兩個 domain 都會緩衝訊息並在 `enable` 時重播（見 `lib/cdp.mjs` 的
    // `subscribeConsole`），所以「enable 之前」與「enable 之後」走的是同一條管道。若當初推論
    // 「enable 之後才開始收」而據此設計驗收，反而會漏掉真正重要的那半段。
    await app.client.evaluate(`console.error('PROBE_CONSOLE_SENTINEL'); void 0`)
    const collected = await pollFor({
      read: () => sectionConsole(),
      settled: (entries) => entries.some((e) => e.text.includes('PROBE_CONSOLE_SENTINEL')),
      timeoutMs: 3000,
      interval: 100,
      label: 'console 收集器收到標記',
    })
    check(
      results,
      `${label}：renderer 的 console 錯誤進得了探針的收集器`,
      collected.some((e) => e.text.includes('PROBE_CONSOLE_SENTINEL') && e.level === 'error'),
      `本段收到 ${collected.length} 則：${JSON.stringify(collected.map((e) => e.text.slice(0, 40)))}`,
    )

    // ── 還沒選中任何 repo 時，Ctrl+T 為無操作
    //
    // 這個狀態下「+ session」按鈕根本不在 DOM 裡 —— 驗的是它不會炸，也不會憑空生出一個選單。
    await pressKey(app.client, 't', ['ctrl'])
    await sleep(500)
    const menuWithoutRepo = await app.client.evaluate(MENU_STATE)
    const mountedWithoutRepo = await app.client.evaluate(MOUNTED)
    check(
      results,
      `${label}：沒有選中的 repo 時，Ctrl+T 為無操作且 app 不崩潰`,
      menuWithoutRepo === null && mountedWithoutRepo?.ok === true,
      `選單=${JSON.stringify(menuWithoutRepo)}；${describeMounted(mountedWithoutRepo) || '掛載正常'}`,
    )

    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    // ── 三個 session，標籤為 shell 1 / 2 / 3（login shell 不採用 pty 的標題，標籤是穩定的）
    for (let i = 0; i < 3; i++) {
      await createSession(app.client)
      await pollUntil(app.client, TABS, (value) => value.length === i + 1, 10_000)
    }
    const tabs = await app.client.evaluate(TABS)
    check(
      results,
      `${label}：repo-a 有三個 session`,
      tabs.length === 3,
      JSON.stringify(tabs.map((t) => t.label)),
    )

    // ── Ctrl+Tab：下一個 session（位置序、可循環）
    await realClick(app.client, await app.client.evaluate(TAB_RECT(0)))
    await sleep(200)

    await pressKey(app.client, 'Tab', ['ctrl'])
    const afterNext = await pollUntil(app.client, FOCUSED_TAB, (v) => v?.includes('shell 2'), 4000)
    check(
      results,
      `${label}：Ctrl+Tab 切至下一個 session`,
      afterNext?.includes('shell 2'),
      String(afterNext),
    )

    await pressKey(app.client, 'Tab', ['ctrl', 'shift'])
    const afterPrev = await pollUntil(app.client, FOCUSED_TAB, (v) => v?.includes('shell 1'), 4000)
    check(
      results,
      `${label}：Ctrl+Shift+Tab 切至上一個 session`,
      afterPrev?.includes('shell 1'),
      String(afterPrev),
    )

    // 於首端往回 → 循環到最後一個
    await pressKey(app.client, 'Tab', ['ctrl', 'shift'])
    const wrapped = await pollUntil(app.client, FOCUSED_TAB, (v) => v?.includes('shell 3'), 4000)
    check(results, `${label}：於首端往回會循環到最後一個`, wrapped?.includes('shell 3'), String(wrapped))

    // ── **位置序，不是 MRU** —— 這條是唯一能把兩者區分開的斷言
    //
    // 先聚焦第三個、再聚焦第一個，然後按 Ctrl+Tab：
    //   位置序 → 第二個（第一個的下一個）
    //   MRU   → 第三個（上一個待過的）
    // 少了這條，寫成 MRU 的實作也會全綠。
    await realClick(app.client, await app.client.evaluate(TAB_RECT(2)))
    await sleep(200)
    await realClick(app.client, await app.client.evaluate(TAB_RECT(0)))
    await sleep(200)
    await pressKey(app.client, 'Tab', ['ctrl'])
    const positional = await pollUntil(app.client, FOCUSED_TAB, (v) => v !== null, 4000)
    check(
      results,
      `${label}：Ctrl+Tab 依分頁位置序，而非最近使用順序`,
      positional?.includes('shell 2'),
      `${positional}（MRU 的話會是 shell 3）`,
    )

    // ── 被攔下的按鍵**不得抵達 pty**
    //
    // **斷言必須有正對照組。** 先送一顆**不帶 Ctrl** 的 ↑，證明方向鍵本來就到得了 pty
    //（`cat -v` 會把它印成 `^[[A`）；否則「沒看到 ^[[1;5A」可能只是因為那條路本來就不通。
    const term = await pollUntil(app.client, TERMINAL_RECT, (value) => value !== null, 10_000)
    await sleep(2000) // 等 shell 畫出 prompt
    await realClick(app.client, term)
    await sleep(200)
    // **載體是 `cat -A`，不是 `cat -v` —— 這個差別是承重的。**
    //
    // `-v` 只處理 nonprinting 字元，**它不 escape Tab**（那要 `-T`）。而 `Ctrl+Tab` 未被攔截時
    // 送出的正是 `\x09`（Tab ＝ Ctrl+I）—— 實測：送 `\x09` 到 pty，`cat -v` 那邊出現的是**字面的
    // tab**，`^I` **永不出現**。於是舊版那條 `leaked` 裡的 `'^I'` **從來沒有機會命中**：
    // **`Ctrl+Tab` 若外洩進 pty，這支探針抓不到**，而 `Ctrl+Tab` 正是本能力的頭號快捷鍵。
    // `-A` ＝ `-vET`，Tab 才會顯示為 `^I`（行尾則顯示為 `$`）。
    await typeLine(app.client, `cat -A > ${join(ptyOutDir, 'keys.txt')}`)
    await sleep(1000)

    await pressKey(app.client, 'ArrowUp') // 對照組：不帶 Ctrl
    await pressEnter(app.client) // 沖掉 tty 的行緩衝，那一行才會進 cat
    const controlText = await waitForPtyFile('keys.txt', (value) => value.includes('^[[A'))
    check(
      results,
      `${label}：對照組 —— 未攔截的方向鍵確實抵達 pty`,
      controlText.includes('^[[A'),
      `（沒有這條，下一條的「沒看到垃圾」證明不了任何事）檔案=${JSON.stringify(controlText.slice(-24))}`,
    )

    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await pressKey(app.client, 'Tab', ['ctrl'])
    await pressKey(app.client, 'Tab', ['ctrl', 'shift'])
    await sleep(1200)

    // 切回原本那個 session 才送得出沖行緩衝的 Enter
    await realClick(app.client, await app.client.evaluate(TAB_RECT(1)))
    await sleep(400)
    await pressEnter(app.client)
    await sleep(600)
    const ptyText = await waitForPtyFile('keys.txt', () => true, 1500)
    const leaked = ['^[[1;5A', '^[[1;5B', '^I'].filter((seq) => ptyText.includes(seq))
    check(
      results,
      `${label}：被攔下的按鍵沒有流進 pty`,
      // **`ptyText !== ''` 不是贅字，是哨兵。** 這是一條**否定式**斷言 —— 觀測管道整個失效時
      // `leaked` 必為空，於是它會在「什麼都沒觀測到」的情況下發綠燈。必須先證明「這條管道
      // 讀得到東西」，「沒讀到垃圾」才有意義。（`Shift+arrow` 那條一直有這個哨兵，這條沒有。）
      leaked.length === 0 && ptyText !== '',
      leaked.length
        ? `外洩：${leaked.join(' ')}`
        : `（檔案 ${ptyText.length} 字元，其中不含被攔下的序列）`,
    )

    // ── Ctrl+↓ / Ctrl+↑：切換 repo（可循環）
    const before = await app.client.evaluate(SELECTED_FOLDER)
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    const nextRepo = await pollUntil(app.client, SELECTED_FOLDER, (v) => v?.includes('repo-b'), 4000)
    check(
      results,
      `${label}：Ctrl+↓ 切至下一個 repo`,
      nextRepo?.includes('repo-b'),
      `${before} → ${nextRepo}`,
    )

    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    const prevRepo = await pollUntil(app.client, SELECTED_FOLDER, (v) => v?.includes('repo-a'), 4000)
    check(results, `${label}：Ctrl+↑ 切回上一個 repo`, prevRepo?.includes('repo-a'), String(prevRepo))

    /*
      **這條斷言隨規格更新過。**

      此前它是「於首端往上會循環到最後一個 repo」—— 那在 rail 的項目集合恰等於 folder 清單時
      成立。`global-session` 之後，rail 的第一個項目是那個不隸屬任何 folder 的全域項目，於是
      自第一個 folder 往上抵達的是**它**，再往上才循環到最後一個 repo。

      兩步都驗：少了第一步，「循環」與「跳過全域項目」在結果上分不開。
    */
    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    const atGlobalFromFirst = await pollUntil(
      app.client,
      SELECTED_ITEM,
      (v) => v === copy('rail.globalName'),
      4000,
    )
    check(
      results,
      `${label}：自第一個 folder 往上抵達全域項目`,
      atGlobalFromFirst === copy('rail.globalName'),
      String(atGlobalFromFirst),
    )

    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    const wrappedRepo = await pollUntil(app.client, SELECTED_FOLDER, (v) => v?.includes('repo-c'), 4000)
    check(
      results,
      `${label}：自全域項目往上會循環到最後一個 repo`,
      wrappedRepo?.includes('repo-c'),
      String(wrappedRepo),
    )

    // ── 切回 repo：focused session 落在**最後聚焦過**的那一個，且滑鼠與鍵盤落點相同
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 6000)
    await sleep(400)
    await realClick(app.client, await app.client.evaluate(TAB_RECT(2)))
    await sleep(300)
    const parked = await app.client.evaluate(FOCUSED_TAB)

    // 以鍵盤切走再切回
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await sleep(400)
    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    const byKeyboard = await pollUntil(app.client, FOCUSED_TAB, (v) => v !== null, 4000)
    check(
      results,
      `${label}：以鍵盤切走再切回，focused session 回到離開時的那一個`,
      byKeyboard === parked && byKeyboard?.includes('shell 3'),
      `離開時=${parked} 回來時=${byKeyboard}`,
    )

    // 以滑鼠切走再切回 —— 落點必須相同（同一個動作不該有兩種行為）
    await pollUntil(app.client, SELECT_FOLDER('repo-b'), (value) => value === true, 6000)
    await sleep(400)
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 6000)
    const byMouse = await pollUntil(app.client, FOCUSED_TAB, (v) => v !== null, 4000)
    check(
      results,
      `${label}：以滑鼠切走再切回，落點與鍵盤相同`,
      byMouse === byKeyboard,
      `鍵盤=${byKeyboard} 滑鼠=${byMouse}`,
    )

    // ── Ctrl+T：開啟建立 session 的入口
    //
    // **位置必須與滑鼠觸發時相同。** 這條才是「走既有入口、不另闢路徑」（design D9）唯一測得
    // 出來的後果 —— 一個自己算座標的實作也會「開得起來」，但選單會錨在別的地方。
    const menuByMouse = await (async () => {
      await realClick(app.client, await app.client.evaluate(NEW_SESSION_RECT))
      const state = await pollUntil(app.client, MENU_STATE, (v) => v !== null, 4000)
      await pressKey(app.client, 'Escape')
      await pollUntil(app.client, MENU_STATE, (v) => v === null, 4000)
      return state
    })()

    await pressKey(app.client, 't', ['ctrl'])
    const menuByKey = await pollUntil(app.client, MENU_STATE, (v) => v !== null, 4000)
    check(
      results,
      `${label}：Ctrl+T 開啟 spawn 選單，且位置與滑鼠觸發時相同`,
      menuByKey !== null &&
        menuByKey.rect.x === menuByMouse.rect.x &&
        menuByKey.rect.y === menuByMouse.rect.y,
      `鍵盤=${JSON.stringify(menuByKey?.rect)} 滑鼠=${JSON.stringify(menuByMouse?.rect)}`,
    )

    check(
      results,
      `${label}：選單開啟時焦點落在第一個選項`,
      menuByKey?.focused === 0,
      `焦點索引=${menuByKey?.focused} 選項=${JSON.stringify(menuByKey?.items)}`,
    )

    // 選單開著時，導航快捷鍵必須讓位 —— 否則使用者正用方向鍵挑選項，Ctrl+Tab 就把畫面切走了
    const focusedBeforeMenu = await app.client.evaluate(FOCUSED_TAB)
    await pressKey(app.client, 'Tab', ['ctrl'])
    await sleep(400)
    const focusedUnderMenu = await app.client.evaluate(FOCUSED_TAB)
    const menuStillOpen = await app.client.evaluate(MENU_STATE)
    check(
      results,
      `${label}：spawn 選單開啟時，導航快捷鍵不生效`,
      focusedUnderMenu === focusedBeforeMenu && menuStillOpen !== null,
      `focused ${focusedBeforeMenu} → ${focusedUnderMenu}；選單仍開著=${menuStillOpen !== null}`,
    )

    // ↓ 到末端會循環回第一項
    await pressKey(app.client, 'ArrowDown')
    const moved = await app.client.evaluate(MENU_STATE)
    await pressKey(app.client, 'ArrowDown')
    const wrappedMenu = await app.client.evaluate(MENU_STATE)
    check(
      results,
      `${label}：選單以 ↓ 移動並於末端循環`,
      moved?.focused === 1 && wrappedMenu?.focused === 0,
      `第一次↓=${moved?.focused} 第二次↓=${wrappedMenu?.focused}（共 ${moved?.items.length} 項）`,
    )

    // Enter 觸發當前選項 —— 移到「進 login shell」再按
    const tabsBeforeEnter = (await app.client.evaluate(TABS)).length
    await pressKey(app.client, 'ArrowDown') // 回到第二項＝「進 login shell」
    await pressKey(app.client, 'Enter')
    const tabsAfterEnter = await pollUntil(
      app.client,
      TABS,
      (value) => value.length === tabsBeforeEnter + 1,
      10_000,
    )
    check(
      results,
      `${label}：以 Enter 觸發選項，真的建立了一個 session`,
      tabsAfterEnter.length === tabsBeforeEnter + 1 &&
        (await app.client.evaluate(MENU_STATE)) === null,
      JSON.stringify(tabsAfterEnter.map((t) => t.label)),
    )

    // ── 被攔下的 Ctrl+T 不得流進 pty（對照組：不帶 Ctrl 的 t 會抵達）
    const termForT = await pollUntil(app.client, TERMINAL_RECT, (value) => value !== null, 10_000)
    await sleep(2000)
    await realClick(app.client, termForT)
    await sleep(200)
    await typeLine(app.client, `cat -A > ${join(ptyOutDir, 'ctrlt.txt')}`)
    await sleep(1000)

    // **判準是 pty 寫出的檔案。** 舊版比對「終端內容有沒有變」—— 那是因為畫面上本來就到處是 t
    // （連命令列自己都有），不能直接找 t。改讀檔之後判準乾淨得多：**每按一次 Enter，`cat` 就多寫
    // 一行；那一行裡有沒有 t，就是「這顆鍵有沒有進 pty」。**
    await pressKey(app.client, 't') // 對照組：不帶 Ctrl
    await pressEnter(app.client)
    const afterPlainT = await waitForPtyFile('ctrlt.txt', (value) => value.includes('t'))
    check(
      results,
      `${label}：對照組 —— 未攔截的 t 確實抵達 pty`,
      afterPlainT.includes('t'),
      `（沒有這條，下一條的「沒有 t」證明不了任何事）檔案=${JSON.stringify(afterPlainT.slice(-16))}`,
    )

    const beforeCtrlT = afterPlainT
    await pressKey(app.client, 't', ['ctrl'])
    await sleep(1000)
    await pressKey(app.client, 'Escape') // 關掉它開出來的選單
    await pollUntil(app.client, MENU_STATE, (v) => v === null, 4000)
    // **焦點要先還給終端，Enter 才送得進 pty。** 選單關掉之後焦點不在終端上（CLAUDE.md 既有的
    // 教訓：「自右鍵選單貼上之後按 Enter 不會執行 —— 焦點還在選單那邊」）。少了這一步，下面那顆
    // Enter 會落空、檔案不會增長 —— 而「沒有新增內容」正是哨兵擋下的東西（實測：它擋下了）。
    await realClick(app.client, termForT)
    await sleep(200)
    await pressEnter(app.client) // 沖行緩衝 —— Ctrl+T 若外洩，那顆 t 就在這一行裡
    await sleep(600)
    const afterCtrlT = await waitForPtyFile('ctrlt.txt', (value) => value.length > beforeCtrlT.length, 4000)
    const addedByCtrlT = afterCtrlT.slice(beforeCtrlT.length)
    check(
      results,
      `${label}：被攔下的 Ctrl+T 沒有流進 pty`,
      // **`length > before` 是哨兵**：它證明那顆 Enter 真的讓 cat 多寫了一行 —— 否則「沒有 t」
      // 只是因為根本什麼都沒寫進來（否定式斷言的老問題）。
      !addedByCtrlT.includes('t') && afterCtrlT.length > beforeCtrlT.length,
      `Ctrl+T 之後新增的內容=${JSON.stringify(addedByCtrlT)}（應只有行尾標記，不含 t）`,
    )

    // ── 0 個 / 1 個 session 時，Ctrl+Tab 為無操作且不得產生錯誤
    //
    // 沒有這兩條，`cycle()` 的邊界（空清單、單元素）就沒人守 —— 而它們正是最容易寫成
    // 除以零、索引越界或無窮迴圈的地方。
    await pollUntil(app.client, SELECT_FOLDER('repo-b'), (value) => value === true, 6000)
    await sleep(400)
    const emptyTabs = await app.client.evaluate(TABS)
    await pressKey(app.client, 'Tab', ['ctrl'])
    await pressKey(app.client, 'Tab', ['ctrl', 'shift'])
    await sleep(400)
    // **issue #19 指名的那一條** —— 它原本沒有 detail，於是三個條件哪個不成立無從得知。
    const tabsAfterCtrlTab = await app.client.evaluate(TABS)
    const mountedAfterCtrlTab = await app.client.evaluate(MOUNTED)
    check(
      results,
      `${label}：repo 沒有 session 時，Ctrl+Tab 為無操作且 app 不崩潰`,
      emptyTabs.length === 0 &&
        tabsAfterCtrlTab.length === 0 &&
        mountedAfterCtrlTab?.ok === true,
      `按之前 ${emptyTabs.length} 個分頁 → 之後 ${tabsAfterCtrlTab.length} 個；` +
        `${describeMounted(mountedAfterCtrlTab) || '掛載正常'}`,
    )

    await createSession(app.client)
    await pollUntil(app.client, TABS, (value) => value.length === 1, 10_000)
    const soleFocused = await app.client.evaluate(FOCUSED_TAB)
    await pressKey(app.client, 'Tab', ['ctrl'])
    await sleep(400)
    const stillSole = await app.client.evaluate(FOCUSED_TAB)
    // **先求值成變數，detail 取自這一次。** 寫成 `(await evaluate(MOUNTED))?.ok === true` 塞在條件
    // 運算式裡，掛載子條件不成立時 detail 一個字都說不出來 —— 而**這條斷言正是 issue #19 那七條
    // 之一**，`shell 1 → shell 1` 只證明了另一個子條件成立。
    const mountedAfterSoleTab = await app.client.evaluate(MOUNTED)
    check(
      results,
      `${label}：repo 只有一個 session 時，Ctrl+Tab 為無操作`,
      stillSole === soleFocused && mountedAfterSoleTab?.ok === true,
      `${soleFocused} → ${stillSole}；${describeMounted(mountedAfterSoleTab) || '掛載正常'}`,
    )

    // ── 最後聚焦的 session 被關掉之後，切回該 repo 落在第一個 session
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 6000)
    await sleep(400)
    await realClick(app.client, await app.client.evaluate(TAB_RECT(2)))
    await sleep(300)

    // 關掉當前 focused（第三個）的那個分頁
    await app.client.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('[aria-label="${copy('sessions.tabs')}"] [role="tab"]')]
      const group = tabs[2]?.closest('div[role="presentation"]')
      const close = group?.querySelector('[aria-label^="${prefixOf('sessions.closeSession')}"]')
      if (!close) return false
      close.click()
      return true
    })()`)
    await pollUntil(app.client, TABS, (value) => value.length === 2, 8000)

    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await sleep(400)
    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    const afterClosedFocus = await pollUntil(app.client, FOCUSED_TAB, (v) => v !== null, 4000)
    check(
      results,
      `${label}：最後聚焦的 session 被關閉後，切回該 repo 落在第一個 session`,
      afterClosedFocus?.includes('shell 1'),
      String(afterClosedFocus),
    )

    // ── 對話框開啟時，導航快捷鍵讓位（每一種對話框各驗一次）
    const focusedBeforeDialog = await app.client.evaluate(FOCUSED_TAB)

    // (1) session 命名對話框
    const tab0 = center(await app.client.evaluate(TAB_RECT(0)))
    await realMouse(app.client, tab0.x, tab0.y, 'right')
    await pollUntil(app.client, `Boolean(document.querySelector('[role="menu"]'))`, (v) => v === true, 4000)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await pollUntil(app.client, DIALOG_OPEN, (value) => value === true, 4000)

    await pressKey(app.client, 'Tab', ['ctrl'])
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await sleep(400)
    const duringNameDialog = await app.client.evaluate(FOCUSED_TAB)
    const repoDuringDialog = await app.client.evaluate(SELECTED_FOLDER)
    const dialogStillOpen = await app.client.evaluate(DIALOG_OPEN)
    check(
      results,
      `${label}：session 命名對話框開啟時，導航快捷鍵不生效`,
      duringNameDialog === focusedBeforeDialog &&
        repoDuringDialog?.includes('repo-a') &&
        dialogStillOpen === true,
      `focused=${duringNameDialog} repo=${repoDuringDialog} 對話框=${dialogStillOpen}`,
    )

    // 關掉它（Esc）
    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await pollUntil(app.client, DIALOG_OPEN, (value) => value === false, 4000)

    // (2) files 的對話框（本 change 才補上 role="dialog"，這條就是在守它）
    check(results, `${label}：切至 Files 身分`, (await app.client.evaluate(IDENTITY_FILES)) === true)
    await sleep(500)
    const fileRow = await pollUntil(
      app.client,
      `(() => {
        const rows = [...document.querySelectorAll('section[aria-label="${copy('files.label')}"] [role="treeitem"]')]
        const row = rows.find((r) => r.innerText.includes('notes.txt'))
        if (!row) return null
        const r = row.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      })()`,
      (v) => v !== null,
      8000,
    )
    const rowAt = center(fileRow)
    await realMouse(app.client, rowAt.x, rowAt.y, 'right')
    await pollUntil(app.client, `Boolean(document.querySelector('[role="menu"]'))`, (v) => v === true, 4000)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    const filesDialog = await pollUntil(app.client, DIALOG_OPEN, (value) => value === true, 4000)
    check(results, `${label}：files 的對話框帶有 role="dialog"`, filesDialog === true)

    const focusedBeforeFilesDialog = await app.client.evaluate(FOCUSED_TAB)
    await pressKey(app.client, 'Tab', ['ctrl'])
    await sleep(400)
    const duringFilesDialog = await app.client.evaluate(FOCUSED_TAB)
    check(
      results,
      `${label}：files 的對話框開啟時，導航快捷鍵不生效`,
      duringFilesDialog === focusedBeforeFilesDialog,
      `之前=${focusedBeforeFilesDialog} 之後=${duringFilesDialog}`,
    )

    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await app.client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await pollUntil(app.client, DIALOG_OPEN, (value) => value === false, 4000)

    // (3) 終端字型設定對話框（`terminal-preferences`）
    //
    // 抑制以 `[role="dialog"]` 的**存在**判定，因此任何遵守這個慣例的新對話框都自動被尊重 ——
    // 但代價是「漏掉 role 的對話框會靜默失效」，所以每一種對話框都要各驗一次（這條紀律寫在
    // `keyboard-navigation` 的 spec 裡）。這是第三個受測載體。
    const settingsAt = center(
      await app.client.evaluate(`(() => {
        const b = document.querySelector('nav[aria-label="${copy('activityBar.label')}"] button[aria-label="${copy('activityBar.settings')}"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      })()`),
    )
    await realClick(app.client, { x: settingsAt.x, y: settingsAt.y, width: 1, height: 1 })
    const settingsDialogOpen = await pollUntil(
      app.client,
      `Boolean(document.querySelector('[role="dialog"][aria-label="${copy('settings.title')}"]'))`,
      (value) => value === true,
      4000,
    ).catch(() => false)
    check(results, `${label}：終端字型設定對話框帶有 role="dialog"`, settingsDialogOpen === true)

    const focusedBeforeSettings = await app.client.evaluate(FOCUSED_TAB)
    const repoBeforeSettings = await app.client.evaluate(SELECTED_FOLDER)
    await pressKey(app.client, 'Tab', ['ctrl'])
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await sleep(400)
    const duringSettings = await app.client.evaluate(FOCUSED_TAB)
    const repoDuringSettings = await app.client.evaluate(SELECTED_FOLDER)
    check(
      results,
      `${label}：終端字型設定對話框開啟時，導航快捷鍵不生效`,
      duringSettings === focusedBeforeSettings && repoDuringSettings === repoBeforeSettings,
      `focused=${duringSettings} repo=${repoDuringSettings}`,
    )

    await pressKey(app.client, 'Escape')
    await pollUntil(app.client, DIALOG_OPEN, (value) => value === false, 4000)

    // ── 編輯器持有焦點時，快捷鍵仍生效（Monaco 會吃鍵 —— capture 階段才攔得到）
    check(results, `${label}：開啟檔案`, (await app.client.evaluate(OPEN_FILE('notes.txt'))) === true)
    const editorFocused = await pollUntil(
      app.client,
      EDITOR_TEXTAREA_FOCUSED,
      (value) => value === true,
      10_000,
    )
    check(results, `${label}：編輯器取得焦點`, editorFocused === true)

    const beforeEditorKey = await app.client.evaluate(FOCUSED_TAB)
    await pressKey(app.client, 'Tab', ['ctrl'])
    const afterEditorKey = await pollUntil(
      app.client,
      FOCUSED_TAB,
      (v) => v !== beforeEditorKey,
      4000,
    )
    check(
      results,
      `${label}：編輯器持有焦點時，Ctrl+Tab 仍切換 session`,
      afterEditorKey !== beforeEditorKey && afterEditorKey !== null,
      `${beforeEditorKey} → ${afterEditorKey}`,
    )

    // ── Ctrl+Shift+W 關閉當前 session ──────────────────────────────────────
    //
    // 這個 app 沒有對應 Ctrl+T 的關閉快捷鍵，只能點分頁的 ✕。選 Shift 版而非 `Ctrl+W`：後者是
    // zsh／bash 的高頻刪字鍵，且沒有 `Ctrl+T` 的「GNOME Terminal 早已拿走」豁免；`Ctrl+Shift+<字母>`
    // 編碼不出來，pty 內收不到，代價為零（本 change 的 design D1）。
    //
    // **放在 runMode 最後** —— 前面的既有測試對 `shell 1` 等具名分頁有假設（序號不重用，關掉就
    // 回不來，見 CLAUDE.md）。這段跑完 runMode 就 teardown，不會污染任何後續斷言。用相對數字
    // （nBefore/nAfter），不寫死絕對值。
    //
    // 先切回 OpenSpec 身分並選 repo-a —— 前一段既有測試把身分切成了 Files、focus 在編輯器。
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 6000)
    await sleep(400)
    const tabsBeforeClose = await app.client.evaluate(TABS)
    check(
      results,
      `${label}：Ctrl+Shift+W 前置條件（repo-a 至少有 2 個 session）`,
      tabsBeforeClose.length >= 2,
      `tabs=${tabsBeforeClose.length}`,
    )
    const nBeforeClose = tabsBeforeClose.length

    // (1) 關掉當前 focused
    const focusedBeforeClose = await app.client.evaluate(FOCUSED_TAB)
    await pressKey(app.client, 'w', ['ctrl', 'shift'])
    const tabsAfterClose = await pollUntil(
      app.client,
      TABS,
      (list) => list.length === nBeforeClose - 1,
      6000,
    )
    check(
      results,
      `${label}：Ctrl+Shift+W 關閉當前 focused 的 session`,
      tabsAfterClose.length === nBeforeClose - 1 &&
        !tabsAfterClose.some((t) => t.label === focusedBeforeClose),
      `之前 focused=${focusedBeforeClose}、之後 tabs=${JSON.stringify(tabsAfterClose.map((t) => t.label))}`,
    )

    // (2) 終端持有焦點時仍生效，且按鍵不進 pty（capture 攔截的核心保證）
    //     對照組：純 w 進 pty 會改變終端內容 —— 這條的鑑別力承擔了「Ctrl+Shift+W 沒進 pty」
    //     的證明（若它進 pty，終端會多一個 w）。
    const termRect = await pollUntil(app.client, TERMINAL_RECT, (v) => v !== null, 6000)
    await realClick(app.client, termRect)
    await sleep(400)
    await typeLine(app.client, `cat -A > ${join(ptyOutDir, 'ctrlshiftw.txt')}`)
    await sleep(800)
    await pressKey(app.client, 'w')
    await pressEnter(app.client)
    const echoedW = await waitForPtyFile('ctrlshiftw.txt', (v) => v.includes('w'))
    check(
      results,
      `${label}：對照組 —— 未攔截的 w 確實抵達 pty`,
      echoedW.includes('w'),
      `（沒有這條，下一條的意義降為零）檔案=${JSON.stringify(echoedW.slice(-16))}`,
    )

    // 攔截組：終端仍持有焦點，按 Ctrl+Shift+W —— 應該關掉當前 session
    const focusedInTerm = await app.client.evaluate(FOCUSED_TAB)
    const nBeforeTermW = (await app.client.evaluate(TABS)).length
    await pressKey(app.client, 'w', ['ctrl', 'shift'])
    const tabsAfterTermW = await pollUntil(
      app.client,
      TABS,
      (list) => list.length === nBeforeTermW - 1,
      6000,
    )
    check(
      results,
      `${label}：終端持有焦點時 Ctrl+Shift+W 仍關閉 session`,
      tabsAfterTermW.length === nBeforeTermW - 1 &&
        !tabsAfterTermW.some((t) => t.label === focusedInTerm),
      `focused=${focusedInTerm}、剩=${JSON.stringify(tabsAfterTermW.map((t) => t.label))}`,
    )

    // (3) 對話框開啟時不生效 —— 沿用 `[role="dialog"]` 判定
    const nBeforeCreate = (await app.client.evaluate(TABS)).length
    await createSession(app.client)
    await pollUntil(app.client, TABS, (list) => list.length === nBeforeCreate + 1, 8000)
    const tab0RectForDialog = center(await app.client.evaluate(TAB_RECT(0)))
    await realMouse(app.client, tab0RectForDialog.x, tab0RectForDialog.y, 'right')
    await pollUntil(app.client, `Boolean(document.querySelector('[role="menu"]'))`, (v) => v === true, 4000)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await pollUntil(app.client, DIALOG_OPEN, (value) => value === true, 4000)

    const tabsBeforeCtrlShiftWinDialog = await app.client.evaluate(TABS)
    await pressKey(app.client, 'w', ['ctrl', 'shift'])
    await sleep(400)
    const tabsAfterCtrlShiftWinDialog = await app.client.evaluate(TABS)
    const dialogStillOpenForW = await app.client.evaluate(DIALOG_OPEN)
    check(
      results,
      `${label}：對話框開啟時 Ctrl+Shift+W 不生效`,
      tabsAfterCtrlShiftWinDialog.length === tabsBeforeCtrlShiftWinDialog.length &&
        dialogStillOpenForW === true,
      `前=${tabsBeforeCtrlShiftWinDialog.length} 後=${tabsAfterCtrlShiftWinDialog.length} 對話框=${dialogStillOpenForW}`,
    )
  } finally {
    await app.destroy()
  }
}

/**
 * 「workspace 只有一個 folder 時，切換 repo 為無操作」。
 *
 * 這條需要一個**只有一個 folder** 的 workspace，因此得另外起一個 app 實例 —— 它守的是
 * `cycle()` 在單元素清單上的邊界（`(0 + 1) % 1 === 0`，繞回自己）。
 */
async function checkSingleFolder(label, { port, rendererUrl }) {
  const [only] = makeFixture()
  const profile = seedProfile([only])
  const app = await launch({ port, profileDir: profile, rendererUrl })

  try {
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    const before = await app.client.evaluate(SELECTED_FOLDER)
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    await sleep(400)
    const after = await app.client.evaluate(SELECTED_FOLDER)
    const mountedAfterSwitch = await app.client.evaluate(MOUNTED)

    check(
      results,
      `${label}：workspace 只有一個 folder 時，切換 repo 為無操作且 app 不崩潰`,
      after === before && mountedAfterSwitch?.ok === true,
      `${before} → ${after}；${describeMounted(mountedAfterSwitch) || '掛載正常'}`,
    )

    // ── 排序快捷鍵在**單一項目**上的邊界（spec 的 scenario，否則零覆蓋）
    //
    // 這正是最容易寫成索引越界或無窮迴圈的地方 —— 而它在多項目的 fixture 上永遠測不到。
    const orderBefore = await app.client.evaluate(RAIL_ORDER)
    await pressKey(app.client, 'ArrowDown', ['shift'])
    await pressKey(app.client, 'ArrowUp', ['shift'])
    await sleep(400)
    const orderAfter = await app.client.evaluate(RAIL_ORDER)
    const mountedAfterReorder = await app.client.evaluate(MOUNTED)
    check(
      results,
      `${label}：workspace 只有一個 folder 時，排序快捷鍵為無操作且 app 不崩潰`,
      JSON.stringify(orderAfter) === JSON.stringify(orderBefore) && mountedAfterReorder?.ok === true,
      `${JSON.stringify(orderBefore)}；${describeMounted(mountedAfterReorder) || '掛載正常'}`,
    )

    await createSession(app.client)
    const soleTab = await pollUntil(app.client, TABS, (value) => value.length === 1, 10_000)
    await pressKey(app.client, 'ArrowRight', ['shift'])
    await pressKey(app.client, 'ArrowLeft', ['shift'])
    await sleep(400)
    const stillSole = await app.client.evaluate(TABS)
    const mountedAfterTabReorder = await app.client.evaluate(MOUNTED)
    check(
      results,
      `${label}：repo 只有一個 session 時，排序快捷鍵為無操作且 app 不崩潰`,
      stillSole.length === 1 &&
        stillSole[0].label === soleTab[0].label &&
        mountedAfterTabReorder?.ok === true,
      `${JSON.stringify(stillSole.map((t) => t.label))}；${describeMounted(mountedAfterTabReorder) || '掛載正常'}`,
    )
  } finally {
    await app.destroy()
  }
}

/**
 * 排序快捷鍵（`Shift+↑↓` 排 repo、`Shift+←→` 排 session）。
 *
 * 自己起一個 app 實例：這組驗收要在**已知的初始順序**上做，混進上面那條長流程裡會被它切換
 * repo／關分頁的一連串動作污染。
 */
async function checkReordering(label, { port, rendererUrl }) {
  const repos = makeFixture()
  const profile = seedProfile(repos)
  const app = await launch({ port, profileDir: profile, rendererUrl })

  try {
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    // ── Shift+↓ / Shift+↑：移動選中的 repo
    const initialOrder = await app.client.evaluate(RAIL_ORDER)
    check(
      results,
      `${label}：rail 的初始順序為加入的先後`,
      JSON.stringify(initialOrder) === JSON.stringify(['repo-a', 'repo-b', 'repo-c']),
      JSON.stringify(initialOrder),
    )

    await pressKey(app.client, 'ArrowDown', ['shift'])
    const movedDown = await pollUntil(
      app.client,
      RAIL_ORDER,
      (value) => value[0] === 'repo-b',
      4000,
    )
    check(
      results,
      `${label}：Shift+↓ 把選中的 repo 往下移動一格`,
      JSON.stringify(movedDown) === JSON.stringify(['repo-b', 'repo-a', 'repo-c']),
      JSON.stringify(movedDown),
    )

    // **選中的是那個 repo，不是那個位置。**
    check(
      results,
      `${label}：移動後仍是同一個 repo 被選中`,
      (await app.client.evaluate(SELECTED_FOLDER))?.includes('repo-a'),
      String(await app.client.evaluate(SELECTED_FOLDER)),
    )

    await pressKey(app.client, 'ArrowUp', ['shift'])
    const movedBack = await pollUntil(app.client, RAIL_ORDER, (value) => value[0] === 'repo-a', 4000)
    check(
      results,
      `${label}：Shift+↑ 把它移回原位`,
      JSON.stringify(movedBack) === JSON.stringify(['repo-a', 'repo-b', 'repo-c']),
      JSON.stringify(movedBack),
    )

    // ── 端點**不循環** —— 這是與導航快捷鍵刻意不同的地方（design D3）
    //
    // 少了這條，一個「照抄 cycle()」的實作也會全綠 —— 而它會把第一名丟到最後一名。
    await pressKey(app.client, 'ArrowUp', ['shift'])
    await sleep(500)
    const atTop = await app.client.evaluate(RAIL_ORDER)
    check(
      results,
      `${label}：已在頂端時 Shift+↑ 為無操作（不循環到末端）`,
      JSON.stringify(atTop) === JSON.stringify(['repo-a', 'repo-b', 'repo-c']),
      `${JSON.stringify(atTop)}（循環的話會變成 repo-b, repo-c, repo-a）`,
    )

    // ── Shift+→ / Shift+←：移動 focused session
    for (let i = 0; i < 3; i++) {
      await createSession(app.client)
      await pollUntil(app.client, TABS, (value) => value.length === i + 1, 10_000)
    }

    await realClick(app.client, await app.client.evaluate(TAB_RECT(0)))
    await pollUntil(app.client, FOCUSED_TAB, (v) => v?.includes('shell 1'), 4000)

    await pressKey(app.client, 'ArrowRight', ['shift'])
    const tabsMoved = await pollUntil(
      app.client,
      TABS,
      (value) => value[0]?.label.includes('shell 2'),
      4000,
    )
    check(
      results,
      `${label}：Shift+→ 把 focused session 往右移動一格`,
      tabsMoved.map((t) => t.label.replace(/\s+/g, ' ').trim()).join(' | ').startsWith('shell 2 | shell 1'),
      JSON.stringify(tabsMoved.map((t) => t.label)),
    )

    check(
      results,
      `${label}：移動後仍是同一個 session 被 focused`,
      (await app.client.evaluate(FOCUSED_TAB))?.includes('shell 1'),
      String(await app.client.evaluate(FOCUSED_TAB)),
    )

    // 兩個視圖共用同一個順序 —— rail 的 session 子列必須跟著改
    const railSessions = await app.client.evaluate(RAIL_SESSIONS('repo-a'))
    const tabOrder = (await app.client.evaluate(TABS)).map((t) => t.label)
    check(
      results,
      `${label}：rail 的 session 子列呈現相同的新順序`,
      railSessions !== null &&
        JSON.stringify(railSessions) === JSON.stringify(tabOrder),
      `rail=${JSON.stringify(railSessions)} 分頁=${JSON.stringify(tabOrder)}`,
    )

    await pressKey(app.client, 'ArrowLeft', ['shift'])
    const tabsBack = await pollUntil(
      app.client,
      TABS,
      (value) => value[0]?.label.includes('shell 1'),
      4000,
    )
    check(
      results,
      `${label}：Shift+← 把它移回原位`,
      tabsBack[0]?.label.includes('shell 1'),
      JSON.stringify(tabsBack.map((t) => t.label)),
    )

    await pressKey(app.client, 'ArrowLeft', ['shift'])
    await sleep(500)
    const atLeftEnd = await app.client.evaluate(TABS)
    check(
      results,
      `${label}：已在最左時 Shift+← 為無操作（不循環到末端）`,
      atLeftEnd[0]?.label.includes('shell 1'),
      `${JSON.stringify(atLeftEnd.map((t) => t.label))}（循環的話 shell 1 會跑到最後）`,
    )

    // ── 終端持有焦點時仍生效，且該按鍵**不得抵達 pty**
    //
    // 終端是這個 app 的常態焦點 —— 這條若失敗，這兩顆快捷鍵等於不存在。
    const term = await pollUntil(app.client, TERMINAL_RECT, (value) => value !== null, 10_000)
    await sleep(2000)
    await realClick(app.client, term)
    await sleep(200)
    await typeLine(app.client, `cat -A > ${join(ptyOutDir, 'shiftarrow.txt')}`)
    await sleep(1000)

    const orderBeforeTerminalKey = await app.client.evaluate(RAIL_ORDER)
    await pressKey(app.client, 'ArrowDown', ['shift'])
    const orderFromTerminal = await pollUntil(
      app.client,
      RAIL_ORDER,
      (value) => value[0] === 'repo-b',
      4000,
    )
    check(
      results,
      `${label}：終端持有焦點時，Shift+↓ 仍移動 repo`,
      JSON.stringify(orderFromTerminal) === JSON.stringify(['repo-b', 'repo-a', 'repo-c']),
      `${JSON.stringify(orderBeforeTerminalKey)} → ${JSON.stringify(orderFromTerminal)}`,
    )

    // `cat -A` 會把 Shift+arrow 寫成 `^[[1;2A`–`^[[1;2D`。上面那條「對照組：未攔截的方向鍵
    // 確實抵達 pty」在 runMode 已經驗過，這裡驗的是被攔下的那幾顆沒有外洩。
    await pressKey(app.client, 'ArrowRight', ['shift'])
    await pressKey(app.client, 'ArrowLeft', ['shift'])
    await pressEnter(app.client) // 沖行緩衝 —— 外洩的序列就在這一行裡
    await sleep(800)
    const ptyText = await waitForPtyFile('shiftarrow.txt', () => true, 2000)
    const leaked = ['^[[1;2A', '^[[1;2B', '^[[1;2C', '^[[1;2D'].filter((seq) => ptyText.includes(seq))
    check(
      results,
      `${label}：被攔下的 Shift+arrow 沒有流進 pty`,
      // `ptyText !== ''` 是哨兵（這條一直都有，另外兩條否定式斷言先前沒有）。
      leaked.length === 0 && ptyText !== '',
      leaked.length ? `外洩：${leaked.join(' ')}` : `（檔案 ${ptyText.length} 字元，未混入控制序列）`,
    )

    await pressKey(app.client, 'ArrowUp', ['shift']) // 還原 rail 的順序
    await pollUntil(app.client, RAIL_ORDER, (value) => value[0] === 'repo-a', 4000)

    // ── 對話框開啟時不排序，且該按鍵**照常抵達對話框的輸入框**
    //
    // 後半段是這條的重點：讓位不只是「不做事」，而是**完全不攔** —— 使用者在輸入框裡按
    // `Shift+←` 就是要選字。
    const tab0 = center(await app.client.evaluate(TAB_RECT(0)))
    await realMouse(app.client, tab0.x, tab0.y, 'right')
    await pollUntil(app.client, `Boolean(document.querySelector('[role="menu"]'))`, (v) => v === true, 4000)
    await realClick(app.client, await app.client.evaluate(MENU_ITEM_RECT(copy('sessions.rename'))))
    await pollUntil(app.client, DIALOG_OPEN, (value) => value === true, 4000)

    const orderBeforeDialog = await app.client.evaluate(RAIL_ORDER)
    const tabsBeforeDialog = (await app.client.evaluate(TABS)).map((t) => t.label)
    await pressKey(app.client, 'ArrowDown', ['shift'])
    await pressKey(app.client, 'ArrowRight', ['shift'])
    await sleep(400)

    const orderDuringDialog = await app.client.evaluate(RAIL_ORDER)
    check(
      results,
      `${label}：對話框開啟時，排序快捷鍵不生效`,
      JSON.stringify(orderDuringDialog) === JSON.stringify(orderBeforeDialog) &&
        JSON.stringify((await app.client.evaluate(TABS)).map((t) => t.label)) ===
          JSON.stringify(tabsBeforeDialog) &&
        (await app.client.evaluate(DIALOG_OPEN)) === true,
      JSON.stringify(orderDuringDialog),
    )

    await pressKey(app.client, 'Escape')
    await pollUntil(app.client, DIALOG_OPEN, (value) => value === false, 4000)

    // ── 編輯器持有焦點時，Shift+arrow **仍是文字選取**（排序快捷鍵讓路）
    //
    // 這是本 change 最容易靜默壞掉的地方：判準若寫成「activeElement 是不是 textarea」，
    // 快捷鍵會在終端上完全失效；漏掉這個例外，編輯器裡連選一個字元都做不到。
    // **兩個方向都要驗** —— 上面驗了終端那一邊。
    check(results, `${label}：切至 Files 身分`, (await app.client.evaluate(IDENTITY_FILES)) === true)
    await sleep(500)
    check(results, `${label}：開啟檔案`, (await app.client.evaluate(OPEN_FILE('notes.txt'))) === true)
    const editorFocused = await pollUntil(
      app.client,
      EDITOR_TEXTAREA_FOCUSED,
      (value) => value === true,
      10_000,
    )
    check(results, `${label}：編輯器取得焦點`, editorFocused === true)

    const orderBeforeEditor = await app.client.evaluate(RAIL_ORDER)
    const tabsBeforeEditor = (await app.client.evaluate(TABS)).map((t) => t.label)
    await pressKey(app.client, 'ArrowRight', ['shift'])
    await pressKey(app.client, 'ArrowRight', ['shift'])
    const selected = await pollUntil(app.client, EDITOR_HAS_SELECTION, (value) => value === true, 4000)

    check(
      results,
      `${label}：編輯器持有焦點時，Shift+→ 仍是文字選取`,
      selected === true,
      selected === true ? '' : '（編輯器沒有選取到任何文字 —— 排序快捷鍵把它吃掉了）',
    )
    check(
      results,
      `${label}：編輯器持有焦點時，Shift+→ 不排序`,
      JSON.stringify(await app.client.evaluate(RAIL_ORDER)) === JSON.stringify(orderBeforeEditor) &&
        JSON.stringify((await app.client.evaluate(TABS)).map((t) => t.label)) ===
          JSON.stringify(tabsBeforeEditor),
      JSON.stringify(await app.client.evaluate(RAIL_ORDER)),
    )

    // ── global-session：rail 的項目序涵蓋那個不隸屬任何 folder 的固定項目
    //
    // **插在 runMode 的最後、finally 之前** —— 前面每一段對 session 與選中狀態都有假設，
    // 而這一段會改變選中的項目（既有紀律：新段落放最後，且用相對數字）。
    const GLOBAL = copy('rail.globalName')

    // 上一段把焦點留在編輯器裡，而排序快捷鍵在那裡刻意讓路 —— 點一下 rail 把焦點移出去。
    await app.client.evaluate(SELECT_FOLDER('repo-a'))
    await sleep(300)

    const items = await app.client.evaluate(RAIL_ITEMS)
    check(results, `${label}：全域項目是 rail 的第一個項目`,
      items[0] === GLOBAL && items.length === 4, JSON.stringify(items))

    // 選中第一個 folder，往上一格 ⇒ 抵達全域項目。
    await app.client.evaluate(SELECT_FOLDER('repo-a'))
    await sleep(300)
    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    const atGlobal = await pollUntil(app.client, SELECTED_ITEM, (v) => v === GLOBAL, 4000)
    check(results, `${label}：自第一個 folder 按 Ctrl+↑ 抵達全域項目`,
      atGlobal === GLOBAL, String(atGlobal))

    // 於全域項目按 Ctrl+T ⇒ spawn 選單開啟（四顆 session 快捷鍵之一，作用域必須涵蓋它）。
    await pressKey(app.client, 't', ['ctrl'])
    const menuOpen = await pollUntil(app.client, MENU_STATE, (v) => v !== null, 4000)
    check(results, `${label}：於全域項目按 Ctrl+T 開啟 spawn 選單`,
      menuOpen !== null && menuOpen.items.length >= 2, JSON.stringify(menuOpen))
    await pressKey(app.client, 'Escape')
    await sleep(200)

    // Shift+↑↓ 對它無操作 —— 它不是 workspace 的成員，沒有順序可言。
    const orderBeforeGlobalMove = await app.client.evaluate(RAIL_ORDER)
    await pressKey(app.client, 'ArrowDown', ['shift'])
    await sleep(400)
    check(results, `${label}：選中全域項目時 Shift+↓ 無操作`,
      JSON.stringify(await app.client.evaluate(RAIL_ORDER)) === JSON.stringify(orderBeforeGlobalMove) &&
        (await app.client.evaluate(SELECTED_ITEM)) === GLOBAL,
      JSON.stringify(await app.client.evaluate(RAIL_ORDER)))

    // 自最後一個 folder 往下 ⇒ 循環回全域項目。
    await app.client.evaluate(SELECT_FOLDER('repo-c'))
    await sleep(300)
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    const wrapped = await pollUntil(app.client, SELECTED_ITEM, (v) => v === GLOBAL, 4000)
    check(results, `${label}：自最後一個 folder 按 Ctrl+↓ 循環回全域項目`,
      wrapped === GLOBAL, String(wrapped))

    /*
      **四顆 session 快捷鍵在全域項目上都要真的能用，而驗它們需要全域項目真的有 session。**

      此前這一段按完 `Ctrl+T` 就 `Escape`，於是全域項目在整支探針裡 session 數**恆為 0** ——
      「於全域項目內切換 session」那條 scenario 因此不可能被驗到，而對照表卻宣稱它有載體
      （獨立稽核抓到的假載體）。這裡改為真的建兩個 login shell，再依序驗切換、排序、關閉。

      **用相對數字**，且排在全域段落的最後（既有紀律）。
    */
    const globalTabsBefore = (await app.client.evaluate(TABS)).length
    for (let i = 0; i < 2; i += 1) {
      await pressKey(app.client, 't', ['ctrl'])
      await sleep(500)
      await pressKey(app.client, 'ArrowDown')
      await pressKey(app.client, 'Enter')
      await sleep(1500)
    }
    const globalTabs = await pollUntil(
      app.client, TABS, (v) => v.length === globalTabsBefore + 2, 15_000)
    check(results, `${label}：於全域項目建立兩個 session（後三條的前提）`,
      globalTabs.length === globalTabsBefore + 2,
      JSON.stringify(globalTabs.map((tab) => tab.label)))

    // 剛建好時 focused 是最後一個 ⇒ Ctrl+Tab 循環回第一個（於是下一條的 Shift+→ 有得移動）。
    const globalFocusedBefore = await app.client.evaluate(FOCUSED_TAB)
    await pressKey(app.client, 'Tab', ['ctrl'])
    const globalFocusedAfter = await pollUntil(
      app.client, FOCUSED_TAB, (v) => v !== globalFocusedBefore, 4000)
    check(results, `${label}：於全域項目內以 Ctrl+Tab 切換 session`,
      globalFocusedAfter !== null && globalFocusedAfter !== globalFocusedBefore,
      `${globalFocusedBefore} → ${globalFocusedAfter}`)

    const globalOrderBefore = (await app.client.evaluate(TABS)).map((tab) => tab.label)
    await pressKey(app.client, 'ArrowRight', ['shift'])
    const globalOrderAfter = await pollUntil(
      app.client,
      TABS,
      (v) => JSON.stringify(v.map((tab) => tab.label)) !== JSON.stringify(globalOrderBefore),
      4000,
    )
    check(results, `${label}：於全域項目內以 Shift+→ 調整 session 順序`,
      globalOrderAfter !== null &&
        JSON.stringify(globalOrderAfter.map((tab) => tab.label)) !== JSON.stringify(globalOrderBefore) &&
        globalOrderAfter.length === globalOrderBefore.length,
      `${JSON.stringify(globalOrderBefore)} → ${JSON.stringify(globalOrderAfter?.map((tab) => tab.label))}`)

    await pressKey(app.client, 'w', ['ctrl', 'shift'])
    const globalAfterClose = await pollUntil(
      app.client, TABS, (v) => v.length === globalTabsBefore + 1, 8000)
    check(results, `${label}：於全域項目內以 Ctrl+Shift+W 關閉當前 session`,
      globalAfterClose !== null && globalAfterClose.length === globalTabsBefore + 1,
      JSON.stringify(globalAfterClose?.map((tab) => tab.label)))

    /*
      **folder 的排序索引以 folder 清單為基準，不以 rail 的列位置。**

      以列位置計算的失效是兩個方向都錯，而且**三個以上 folder 才看得出來**：兩個時夾制會把
      越界的目標拉回末端，結果與正確實作相同（既有的 off-by-one 就是這樣躲過每一輪驗收的）。
    */
    await app.client.evaluate(SELECT_FOLDER('repo-a'))
    await sleep(300)
    const beforeDown = await app.client.evaluate(RAIL_ORDER)
    await pressKey(app.client, 'ArrowDown', ['shift'])
    const afterDown = await pollUntil(app.client, RAIL_ORDER, (v) => v[0] !== beforeDown[0], 4000)
    check(results, `${label}：第一個 folder 按 Shift+↓ 恰好移動一格`,
      JSON.stringify(afterDown) === JSON.stringify([beforeDown[1], beforeDown[0], beforeDown[2]]),
      `${JSON.stringify(beforeDown)} → ${JSON.stringify(afterDown)}`)

    // 第二個 folder 往上一格 —— 以列位置計算時它會算出等於自己的目標而**靜默無操作**。
    const beforeUp = await app.client.evaluate(RAIL_ORDER)
    await pressKey(app.client, 'ArrowUp', ['shift'])
    const afterUp = await pollUntil(app.client, RAIL_ORDER, (v) => v[0] !== beforeUp[0], 4000)
    check(results, `${label}：第二個 folder 按 Shift+↑ 恰好移動一格（不靜默無操作）`,
      JSON.stringify(afterUp) === JSON.stringify([beforeUp[1], beforeUp[0], beforeUp[2]]),
      `${JSON.stringify(beforeUp)} → ${JSON.stringify(afterUp)}`)

    // ── global-session：鍵盤導航時目標捲入可視範圍（第九次 dogfooding 的第二個回饋）
    //
    // **載體選在這裡而不是 `probe:workspace`**：那支探針送不進 `Ctrl+↓`（實測 `aria-current`
    // 不動而 `scrollTop` 卻變了 —— 那是**未被 preventDefault 時瀏覽器的原生捲動**，不是產品的
    // `scrollIntoView`）。這支的鍵盤驅動則已由前面上百條斷言證明有效。
    //
    // **rail 溢出以壓矮 viewport 達成**，不以「多塞十幾個 folder」—— 後者要改 fixture，而
    // fixture 是全域的，前面每一條絕對斷言都會跟著壞。
    await app.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 300,
      deviceScaleFactor: 0,
      mobile: false,
    })
    await sleep(600)

    const RAIL_SCROLLER = `(() => {
      const ul = document.querySelector('aside[aria-label="${copy('rail.label')}"] > ul')
      if (!ul) return null
      return { scrollHeight: ul.scrollHeight, clientHeight: ul.clientHeight, scrollTop: Math.round(ul.scrollTop) }
    })()`

    /** 選中的那一列是否**完整**落在捲動容器內 —— 這是本要求的不變式。 */
    const SELECTED_FULLY_VISIBLE = `(() => {
      const ul = document.querySelector('aside[aria-label="${copy('rail.label')}"] > ul')
      const rows = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > div[role="button"]')]
      const row = rows.find((r) => r.getAttribute('aria-current') === 'true')
      if (!ul || !row) return null
      const a = ul.getBoundingClientRect()
      const b = row.getBoundingClientRect()
      return {
        label: row.getAttribute('aria-label'),
        visible: b.top >= a.top - 0.5 && b.bottom <= a.bottom + 0.5,
        scrollTop: Math.round(ul.scrollTop),
      }
    })()`

    const scroller = await pollUntil(app.client, RAIL_SCROLLER, (v) => v !== null, 8000)
    check(results, `${label}：壓矮 viewport 後 rail 確實溢出（否則整段沒有鑑別力）`,
      scroller !== null && scroller.scrollHeight > scroller.clientHeight + 10,
      JSON.stringify(scroller))

    // 走到最後一個 repo —— 在這個高度下它必然落在初始視野之外。
    await app.client.evaluate(SELECT_FOLDER('repo-a'))
    await sleep(300)
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await sleep(200)
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await sleep(600)

    const scrolled = await app.client.evaluate(SELECTED_FULLY_VISIBLE)
    check(results, `${label}：前提 —— Ctrl+↓ 確實把選中的項目帶離了初始視野`,
      scrolled !== null && scrolled.scrollTop > 0, JSON.stringify(scrolled))
    check(results, `${label}：Ctrl+↓ 切換後，選中的項目完整落在 rail 的可視範圍內`,
      scrolled !== null && scrolled.visible === true, JSON.stringify(scrolled))

    // 往回走同樣要捲。**先把容器強制捲到底才有鑑別力** —— 少了這一步，對照組（拿掉
    // `scrollIntoView`）的 `scrollTop` 恆為 0，於是頂端附近的項目本來就完整可見，那條斷言
    // 兩種實作都會過（獨立稽核抓到的 m9）。強制捲動是直接指派 `scrollTop`，不送滑鼠事件 ——
    // 於是它不會誤觸下面那條「以滑鼠操作時不捲」的例外。
    const FORCE_RAIL_BOTTOM = `(() => {
      const ul = document.querySelector('aside[aria-label="${copy('rail.label')}"] > ul')
      if (!ul) return null
      ul.scrollTop = ul.scrollHeight
      return Math.round(ul.scrollTop)
    })()`

    const forcedBottom = await app.client.evaluate(FORCE_RAIL_BOTTOM)
    check(results, `${label}：前提 —— rail 捲得到底（往回捲那條的鑑別力來自這裡）`,
      typeof forcedBottom === 'number' && forcedBottom > 0, JSON.stringify(forcedBottom))

    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    await sleep(200)
    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    await sleep(600)
    const back = await app.client.evaluate(SELECTED_FULLY_VISIBLE)
    check(results, `${label}：Ctrl+↑ 往回切換後，選中的項目仍完整落在可視範圍內`,
      back !== null && back.visible === true, JSON.stringify(back))
    check(results, `${label}：Ctrl+↑ 往回切換確實把容器捲了回去（對照組：無 scrollIntoView 時停在底部）`,
      back !== null && back.scrollTop < forcedBottom,
      `forced=${forcedBottom} → ${JSON.stringify(back)}`)

    // ── 例外：以滑鼠直接點擊時**不**捲動
    //
    // `block: 'nearest'` 只保證「**完全**可見就不捲」，部分可見的它會捲最小的量把它補齊 ——
    // 於是點下緣那半截的列時，那一列會在游標底下跳走，下一次點擊得重新瞄準。這一段先把容器
    // 造一個半截的列，再送**真滑鼠事件**點它（合成事件驅動不了這條路徑）。
    //
    // **不能只是「捲到底再找找看」**（實測：那樣找到的是 `null`）—— 捲到底時被裁掉的是
    // session **子列**，而標題列（`div[role="button"]`，也就是選取的單位）恰好整排都完整可見。
    // 因此改為**主動算**：把捲動位置設到讓某一列剛好被視窗邊緣切一半，先試上緣、再試下緣。
    // 直接指派 `scrollTop` 不送滑鼠事件，於是它自己不會誤觸這條例外。
    const CUT_A_RAIL_ROW = `(() => {
      const ul = document.querySelector('aside[aria-label="${copy('rail.label')}"] > ul')
      if (!ul) return null
      const rows = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > div[role="button"]')]
      const max = ul.scrollHeight - ul.clientHeight
      for (const row of rows) {
        if (row.getAttribute('aria-current') === 'true') continue
        const height = row.getBoundingClientRect().height
        const contentTop =
          row.getBoundingClientRect().top - ul.getBoundingClientRect().top + ul.scrollTop
        for (const want of [contentTop + height / 2, contentTop + height / 2 - ul.clientHeight]) {
          const target = Math.round(want)
          if (target < 0 || target > max) continue
          ul.scrollTop = target
          const a = ul.getBoundingClientRect()
          const b = row.getBoundingClientRect()
          const top = Math.max(a.top, b.top)
          const bottom = Math.min(a.bottom, b.bottom)
          const cut = b.top < a.top - 0.5 || b.bottom > a.bottom + 0.5
          if (bottom - top >= 8 && cut) {
            return {
              label: row.getAttribute('aria-label'),
              x: Math.round(b.left + b.width * 0.35),
              y: Math.round((top + bottom) / 2),
              scrollTop: Math.round(ul.scrollTop),
            }
          }
        }
      }
      return null
    })()`

    const partial = await app.client.evaluate(CUT_A_RAIL_ROW)
    check(results, `${label}：前提 —— 造得出一個「部分可見且未選中」的 rail 列`,
      partial !== null, JSON.stringify(partial))

    if (partial) {
      await realMouse(app.client, partial.x, partial.y, 'left')
      await sleep(700)
      const afterClick = await app.client.evaluate(SELECTED_FULLY_VISIBLE)
      check(results, `${label}：前提 —— 那一下點擊確實選中了它（否則下一條沒有意義）`,
        afterClick !== null && afterClick.label === partial.label,
        `${JSON.stringify(partial.label)} → ${JSON.stringify(afterClick)}`)
      check(results, `${label}：以滑鼠選取部分可見的項目時 rail 不捲動（它不在游標底下跳走）`,
        afterClick !== null && afterClick.scrollTop === partial.scrollTop,
        `scrollTop ${partial.scrollTop} → ${afterClick && afterClick.scrollTop}`)
    }

    await app.client.send('Emulation.clearDeviceMetricsOverride', {})
    await sleep(300)

    // ── 分頁列的橫向捲動 —— 第二條 dogfood 回饋的**另一半**，此前零自動化覆蓋
    //
    // 同一顆 `Ctrl+Tab` 要捲兩個容器：rail（縱向，上面那幾條）與分頁列（橫向，這裡）。
    // **壓窄 viewport 讓分頁列溢出**，不去多開 session —— 後者要動 fixture，而 fixture 是
    // 全域的，前面每一條絕對斷言都會跟著壞。
    await app.client.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 700,
      deviceScaleFactor: 0,
      mobile: false,
    })
    await sleep(600)
    await app.client.evaluate(SELECT_FOLDER('repo-a'))
    await sleep(400)

    const TAB_SCROLLER = `(() => {
      const el = document.querySelector('[role="tablist"][aria-label="${copy('sessions.tabs')}"]')
      if (!el) return null
      const tabs = [...el.querySelectorAll('[role="tab"]')]
      const index = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')
      const a = el.getBoundingClientRect()
      const b = index === -1 ? null : tabs[index].getBoundingClientRect()
      return {
        count: tabs.length,
        index,
        scrollWidth: Math.round(el.scrollWidth),
        clientWidth: Math.round(el.clientWidth),
        overflows: el.scrollWidth > el.clientWidth + 4,
        scrollLeft: Math.round(el.scrollLeft),
        visible: b === null ? null : b.left >= a.left - 0.5 && b.right <= a.right + 0.5,
      }
    })()`

    const FORCE_TABS_LEFT = `(() => {
      const el = document.querySelector('[role="tablist"][aria-label="${copy('sessions.tabs')}"]')
      if (!el) return null
      el.scrollLeft = 0
      return Math.round(el.scrollLeft)
    })()`

    // **壓窄視窗未必就夠**（實測 640px 下 3 個分頁仍塞得下）—— 不夠就補幾個 session。
    // 補的路徑走**鍵盤**（`Ctrl+T` → ↓ → Enter）而不是點「+」：窄視窗下那顆按鈕可能已被推出
    // 畫面，而鍵盤路徑與寬度無關。這一段排在 runMode 的最末，多出來的 session 不污染任何人。
    let tabs = await pollUntil(app.client, TAB_SCROLLER, (v) => v !== null, 8000)
    for (let i = 0; i < 4 && tabs !== null && !tabs.overflows; i += 1) {
      await pressKey(app.client, 't', ['ctrl'])
      await sleep(500)
      await pressKey(app.client, 'ArrowDown')
      await pressKey(app.client, 'Enter')
      await sleep(1500)
      tabs = await app.client.evaluate(TAB_SCROLLER)
    }

    check(results, `${label}：前提 —— 分頁列確實溢出（否則整段沒有鑑別力）`,
      tabs !== null && tabs.overflows === true && tabs.count >= 2,
      JSON.stringify(tabs))

    if (tabs && tabs.overflows && tabs.count >= 2) {
      // 先走到第一個分頁 —— 於是「捲到最左」是一個確定的狀態，而不是碰運氣。
      for (let i = 0; i < tabs.count && tabs.index !== 0; i += 1) {
        await pressKey(app.client, 'Tab', ['ctrl'])
        await sleep(250)
        tabs = await app.client.evaluate(TAB_SCROLLER)
      }
      check(results, `${label}：前提 —— Ctrl+Tab 走得到第一個分頁`,
        tabs !== null && tabs.index === 0, JSON.stringify(tabs))

      // 強制捲回最左：於是**最後一個**分頁必然落在視野之外（溢出的定義就是這件事）。
      await app.client.evaluate(FORCE_TABS_LEFT)
      await sleep(300)

      // 往前循環一格 ＝ 跳到最後一個分頁。位置序可循環（`keyboard-navigation`）。
      await pressKey(app.client, 'Tab', ['ctrl', 'shift'])
      await sleep(700)
      const wrapped = await app.client.evaluate(TAB_SCROLLER)
      check(results, `${label}：前提 —— Ctrl+Shift+Tab 自第一個分頁循環到最後一個`,
        wrapped !== null && wrapped.index === wrapped.count - 1, JSON.stringify(wrapped))
      check(results, `${label}：切換至視野外的 session 時，分頁列橫向捲動使該分頁完整可見`,
        wrapped !== null && wrapped.visible === true, JSON.stringify(wrapped))
      check(results, `${label}：分頁列確實橫向捲動了（對照組：無 scrollIntoView 時 scrollLeft 停在 0）`,
        wrapped !== null && wrapped.scrollLeft > 0, JSON.stringify(wrapped))
    }

    await app.client.send('Emulation.clearDeviceMetricsOverride', {})
    await sleep(300)

    await runQuickOpen(label, app, repos)
  } finally {
    await app.destroy()
  }
}

/**
 * **零 folder 的 workspace** —— 五條 scenario 的共同載體，橫跨四個 capability：
 *
 * | capability | scenario |
 * |---|---|
 * | `global-session` | 尚無任何 folder 時仍呈現 |
 * | `keyboard-navigation` | rail 只有全域項目時為無操作 |
 * | `status-bar` | workspace 為空且無任何 session 時 |
 * | `status-bar` | workspace 為空但有全域 session 時不呈現空狀態 |
 * | `file-explorer` | 沒有可用的側欄來源 |
 *
 * **這一段的成本核心是那一次零 folder 冷啟動，五條共用它** —— 分開驗就是五次啟動，而它們
 * 的前置條件完全相同。
 *
 * **失效方向是假綠，這是本段存在的唯一理由**：種有 folder 的環境**區分不了「恆常呈現」與
 * 「有 folder 時才呈現」**。一個「rail 為空就不渲染任何東西」的實作，照樣通過 `runMode` 那條
 * 「全域項目是 rail 的第一個項目」。
 */
async function checkEmptyWorkspace(label, { port, rendererUrl }) {
  // **不呼叫 `makeFixture()`** —— 這一段要的就是「磁碟上沒有任何 repo、清單裡沒有任何 folder」。
  const profile = seedProfile([])
  const app = await launch({ port, profileDir: profile, rendererUrl })

  try {
    const GLOBAL = copy('rail.globalName')

    // ── 前提：沒有任何東西抑制快捷鍵
    //
    // **這不是背景檢查，是 D4 的承重前提**：快捷鍵在對話框或選單開啟時一律被抑制，而零 folder
    // 是罕被執行的啟動狀態。若那時有引導性的對話框，「按了沒反應」與「規格要求的無操作」在
    // 結果上完全相同 —— 下面那條無操作斷言會以假綠的形式通過。
    const suppressors = await pollUntil(app.client, SUPPRESSORS, (v) => v !== null, 10_000)
    check(results, `${label}：零 folder 啟動時沒有任何對話框或選單抑制快捷鍵`,
      suppressors === 0, `[role="dialog"], [role="menu"] 共 ${suppressors} 個`)

    // ── global-session：尚無任何 folder 時仍呈現全域項目
    //
    // **`length === 1` 是這條的全部重點。** runMode 那條「全域項目是 rail 的第一個項目」跑在
    // 種了三個 folder 的 fixture 上，它對「rail 為空就不渲染任何東西」的實作照樣是綠的。
    const items = await pollUntil(app.client, RAIL_ITEMS, (v) => v !== null, 10_000)
    check(results, `${label}：尚無任何 folder 時 rail 仍呈現全域項目，且它是唯一的項目`,
      items.length === 1 && items[0] === GLOBAL, JSON.stringify(items))

    // ── status-bar：workspace 為空且無任何 session 時呈現空狀態
    //
    // **判準是「屬於那兩句之一」，不寫死哪一句** —— 規格要的是「呈現空狀態文字」，而實作依
    // 有沒有選中項目在 `noRepo` / `noSession` 之間選。綁死其中一句，會讓一次無關的選中狀態
    // 調整把這條弄紅。
    const EMPTY_TEXTS = [copy('statusBar.noRepo'), copy('statusBar.noSession')]
    const barEmpty = await pollUntil(app.client, STATUS_BAR_TEXT, (v) => v !== null, 10_000)
    check(results, `${label}：workspace 為空且無任何 session 時，狀態列存在且呈現空狀態文字`,
      barEmpty !== null && EMPTY_TEXTS.some((t) => barEmpty.includes(t)),
      JSON.stringify(barEmpty))

    // ── keyboard-navigation：rail 只有全域項目時 Ctrl+↑↓ 為無操作
    //
    // **兩步，而順序是承重的。** 第一步是「這顆鍵在此狀態下是活的」的證據 —— 少了它，第二步
    // 在快捷鍵完全失效時（例如有東西抑制了它）**依然全綠**，因為「選中項不變」在兩種情形下
    // 都成立。上面那條抑制檢查是同一件事的另一面，兩條都留著。
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    const selectedFirst = await pollUntil(app.client, SELECTED_ITEM, (v) => v === GLOBAL, 4000)
    check(results, `${label}：尚未選中任何項目時 Ctrl+↓ 選中全域項目（前提：快捷鍵未被抑制）`,
      selectedFirst === GLOBAL, String(selectedFirst))

    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await sleep(400)
    const afterDown = await app.client.evaluate(SELECTED_ITEM)
    const mountedAfterDown = await app.client.evaluate(MOUNTED)
    check(results, `${label}：rail 只有全域項目時 Ctrl+↓ 為無操作且 app 不崩潰`,
      afterDown === GLOBAL && mountedAfterDown?.ok === true,
      `${selectedFirst} → ${afterDown}；${describeMounted(mountedAfterDown) || '掛載正常'}`)

    // 相反方向的邊界 —— 條文管的是「這兩個快捷鍵」，而 `(0 - 1 + 1) % 1` 是會出事的那一類算式。
    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    await sleep(400)
    const afterUp = await app.client.evaluate(SELECTED_ITEM)
    const mountedAfterUp = await app.client.evaluate(MOUNTED)
    check(results, `${label}：rail 只有全域項目時 Ctrl+↑ 為無操作且 app 不崩潰`,
      afterUp === GLOBAL && mountedAfterUp?.ok === true,
      `${afterDown} → ${afterUp}；${describeMounted(mountedAfterUp) || '掛載正常'}`)

    // ── file-explorer：沒有可用的側欄來源
    //
    // **「來源未選定」與「沒有 folder 可選」是兩個狀態**，而既有載體（「來源未選定時 Files
    // 不呈現任何檔案列」）跑在有 folder 的 fixture 上 —— 它驗的是前者。
    await app.client.evaluate(IDENTITY_FILES)
    const filesText = await pollUntil(app.client, FILES_PANEL_TEXT, (v) => v !== null, 6000)
    check(results, `${label}：沒有任何 folder 可作為側欄來源時，Files 身分呈現說明此狀態的提示`,
      filesText !== null && filesText.includes(copy('files.noSource')),
      JSON.stringify(filesText))

    // ── status-bar：workspace 為空但有全域 session 時不呈現空狀態
    //
    // **走 rail 上全域項目的建立入口**，不走 `createSession()`（它找的是主舞台的按鈕，而零
    // folder 時沒有選中的 repo）。也**刻意不走 `Ctrl+T`** —— 那會讓這條依賴上面剛驗過的
    // 快捷鍵，兩條斷言就不再獨立。
    const plus = await pollUntil(app.client, GLOBAL_NEW_SESSION_RECT, (v) => v !== null, 10_000)
    if (!plus) throw new Error('rail 上找不到全域項目的建立 session 入口')
    await realClick(app.client, plus)
    const shellItem = await pollUntil(
      app.client, MENU_ITEM_RECT(copy('sessions.spawnShell')), (v) => v !== null, 6000)
    if (!shellItem) throw new Error('選單中找不到 shell')
    await realClick(app.client, shellItem)

    const globalTabs = await pollUntil(app.client, TABS, (v) => v.length === 1, 15_000)
    const barWithSession = await pollUntil(
      app.client, STATUS_BAR_TEXT,
      (v) => v !== null && !EMPTY_TEXTS.some((t) => v.includes(t)), 10_000)
    check(results,
      `${label}：workspace 為空但有全域 session 時，狀態列呈現該 session 的脈絡而非空狀態`,
      globalTabs.length === 1 &&
        barWithSession !== null &&
        !EMPTY_TEXTS.some((t) => barWithSession.includes(t)) &&
        barWithSession.includes(copy('statusBar.sessions', { here: 1, total: 1 })),
      `分頁=${globalTabs.length} 狀態列=${JSON.stringify(barWithSession)}`)
  } finally {
    await app.destroy()
  }
}

/**
 * 四個段落**彼此獨立** —— 每一段各自 `makeFixture()`、`seedProfile()`、`launch()` 與收屍
 * （實際逐段確認，非假設），因此沒有一項需要宣告 `deps`。
 *
 * 此前這裡是六行寫死的呼叫，沒有段落機制 —— 於是任何一段 throw 就吃掉其後全部，而迭代時
 * 想單獨重跑一段只能整支跑（實測一輪 332 秒）。
 */
/** 逾時收屍 —— 逾時的段落不會走到自己的 `finally`。pattern 以字元類別自我豁免。 */
const killStrays = () => {
  try {
    execFileSync('pkill', ['-9', '-f', 'spekterm-keyboard-[p]rofile'], { stdio: 'ignore' })
  } catch {
    // 沒有殘留
  }
}

const SECTIONS = [
  { name: 'runMode', run: runMode, onTimeout: killStrays },
  { name: 'checkSingleFolder', run: checkSingleFolder, onTimeout: killStrays },
  { name: 'checkReordering', run: checkReordering, onTimeout: killStrays },
  { name: 'checkEmptyWorkspace', run: checkEmptyWorkspace, onTimeout: killStrays },
]

const outcome = await runSections({
  sections: SECTIONS,
  build: { port: BUILD_PORT, rendererUrl: null },
  dev: { port: DEV_PORT, start: startRendererDevServer },
  results,
  cleanup: () => {
    for (const dir of temps) {
      try {
        execFileSync('rm', ['-rf', dir])
      } catch {
        // 清不掉就算了
      }
    }
  },
})

process.exit(outcome.ok ? 0 : 1)
