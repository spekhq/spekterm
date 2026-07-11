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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, dragMouse, pollUntil, waitForPageTarget } from './lib/cdp.mjs'

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
  const base = mkTemp('spek-term-fixture-')
  const repo = join(base, 'repo-a')
  mkdirSync(join(repo, 'openspec'), { recursive: true })
  writeFileSync(join(repo, 'README.md'), '# repo-a\n')
  return { repo }
}

function seedProfile(folders) {
  const profile = mkTemp('spek-term-profile-')
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
  document.querySelector('aside[aria-label="工作區"]') &&
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

async function launch({ port, profileDir, rendererUrl, marker }) {
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
  const rows = [...document.querySelectorAll('aside[aria-label="工作區"] li > div[role="button"]')]
  const row = rows.find((r) => r.innerText.includes(${JSON.stringify(name)}))
  if (!row) return false
  row.click()
  return true
})()`

const TABS = `[...document.querySelectorAll('[aria-label="Session 分頁"] [role="tab"]')].map((tab) => ({
  label: tab.innerText.replace(/\\s+/g, ' ').trim(),
  selected: tab.getAttribute('aria-selected') === 'true',
  exited: tab.innerText.includes('已結束'),
}))`

/** rail 的 session 子列（第 n 個，自 0 起）。 */
const RAIL_SESSION_RECT = (index) => `(() => {
  const rows = [...document.querySelectorAll('aside[aria-label="工作區"] ul[aria-label$="的 session"] li > div[role="button"]')]
  const row = rows[${index}]
  if (!row) return null
  const r = row.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/** rail 上展開／收合 session 子列的 caret。 */
const RAIL_CARET_RECT = `(() => {
  const btn = document.querySelector('aside[aria-label="工作區"] button[aria-label$="的 session"]')
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const RAIL_SESSION_COUNT = `document.querySelectorAll('aside[aria-label="工作區"] ul[aria-label$="的 session"] li').length`

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
  const host = [...document.querySelectorAll('section[aria-label="Terminal"] > div')]
    .find((d) => !d.classList.contains('hidden'))
  const rows = host?.querySelector('.xterm-rows')
  return rows ? rows.innerText : ''
})()`

const TERMINAL_RECT = RECT_OF('section[aria-label="Terminal"]')
const NEW_SESSION_RECT = RECT_OF('[aria-label="新增 session"]')
const SEPARATOR_RECT = RECT_OF('main[aria-label="主舞台"] [role="separator"]')

const CLOSE_FIRST_TAB = `(() => {
  const btn = document.querySelector('[aria-label^="關閉 session"]')
  if (!btn) return false
  btn.click()
  return true
})()`

const RAIL_SESSION_ROWS = `[...document.querySelectorAll('aside[aria-label="工作區"] ul[aria-label$="的 session"] li')]
  .map((li) => li.innerText.replace(/\\s+/g, ' ').trim())`

// ── 輸入 ────────────────────────────────────────────────────────────────────

const center = (rect) => ({
  x: Math.round(rect.x + rect.width / 2),
  y: Math.round(rect.y + rect.height / 2),
})

/** 真滑鼠事件。合成的 MouseEvent 不走完整序列，測不出 overlay 的自我關閉與定位問題。 */
async function realClick(client, rect) {
  const at = center(rect)
  const base = { ...at, button: 'left', buttons: 1, clickCount: 1 }
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none', buttons: 0 })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
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
  const app = await launch({ port, profileDir: profile, rendererUrl, marker })

  try {
    check(results, `${label}：app 掛載`, app.mounted === true)

    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)

    // 尚無 session 時的空狀態與建立入口
    const emptyTabs = await app.client.evaluate(TABS)
    check(results, `${label}：初始沒有任何 session 分頁`, emptyTabs.length === 0)

    // ── 開一個 login shell session（真事件：按鈕 → 選單 → 選單項）
    const menu = await openSessionViaMenu(app.client, '進 login shell')
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
    await openSessionViaMenu(app.client, '進 login shell')
    const tabs2 = await pollUntil(app.client, TABS, (value) => value.length === 2, 8000)
    check(results, `${label}：可多開 session`, tabs2.length === 2, JSON.stringify(tabs2))

    const pids2 = await waitForPtyCount(marker, 2)
    check(results, `${label}：兩個 pty 行程並存`, pids2.length === 2, `pids=${pids2.join(',')}`)

    // ── 切回第一個 session：先前的輸出仍在（scrollback 未因切換而遺失）
    const firstTabRect = await app.client.evaluate(`(() => {
      const tab = document.querySelector('[aria-label="Session 分頁"] [role="tab"]')
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

    // ── claude 模式：能被建立；環境沒有 claude 時應呈現為已結束，而非崩潰
    await openSessionViaMenu(app.client, '跑 claude')
    const tabsClaude = await pollUntil(
      app.client,
      TABS,
      (value) => value.some((tab) => tab.label.includes('claude')),
      8000,
    )
    check(
      results,
      `${label}：claude 模式可建立 session（不論環境是否有 claude）`,
      tabsClaude.some((tab) => tab.label.includes('claude')),
      JSON.stringify(tabsClaude),
    )
    check(results, `${label}：建立 claude session 後 app 仍運作`, (await app.client.evaluate(MOUNTED)) === true)

    // ── reload：舊 pty 必須全數釋放（design D2）
    // 這是最容易漏的一條：reload 不銷毀 webContents，只掛 'destroyed' 的清理不會觸發，
    // 舊 pty 會變孤兒，且新頁面的 xterm 再也收不到它們的輸出。
    await app.client.send('Page.reload', {})
    await pollUntil(app.client, MOUNTED, (value) => value === true, 20_000)
    const pidsAfterReload = await waitForPtyCount(marker, 0)
    check(
      results,
      `${label}：重新載入釋放先前的所有 pty（不留孤兒）`,
      pidsAfterReload.length === 0,
      `殘留 pids=${pidsAfterReload.join(',') || '無'}`,
    )

    const tabsAfterReload = await app.client.evaluate(TABS)
    check(
      results,
      `${label}：重新載入後分頁列回到空狀態`,
      Array.isArray(tabsAfterReload) && tabsAfterReload.length === 0,
    )

    // ── 關閉視窗：所有 pty 必須被清掉（真的關窗，再回查行程表）
    await pollUntil(app.client, SELECT_FOLDER('repo-a'), (value) => value === true, 10_000)
    await sleep(300)
    await openSessionViaMenu(app.client, '進 login shell')
    await pollUntil(app.client, TABS, (value) => value.length === 1, 8000)
    const pidsBeforeQuit = await waitForPtyCount(marker, 1)
    check(
      results,
      `${label}：重新載入後仍可建立新 session`,
      pidsBeforeQuit.length === 1,
      `pids=${pidsBeforeQuit.join(',')}`,
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

async function main() {
  let devServer = null
  try {
    await runMode('build', { port: BUILD_PORT, rendererUrl: null })

    devServer = await startRendererDevServer()
    await runMode('dev', { port: DEV_PORT, rendererUrl: devServer.url })
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
