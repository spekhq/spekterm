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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, pollUntil, waitForPageTarget } from './lib/cdp.mjs'
import { copy, prefixOf } from './lib/copy.mjs'

const BUILD_PORT = 9234
const DEV_PORT = 9235

/** 可預測、無 profile 雜訊，且處處存在。 */
const SHELL_PATH = '/bin/sh'

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

function makeFixture() {
  const base = mkTemp('spekterm-keyboard-fixture-')
  const repos = ['repo-a', 'repo-b', 'repo-c'].map((name) => {
    const repo = join(base, name)
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'notes.txt'), `${name} 的內容\n第二行\n`)
    return [name, repo]
  })
  return repos
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

const MOUNTED = `Boolean(
  document.querySelector('aside[aria-label="${copy('rail.label')}"]') &&
  document.getElementById('root')?.children.length &&
  document.visibilityState === 'visible'
)`

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
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '.'],
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
  const mounted = await pollUntil(client, MOUNTED, (value) => value === true)

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
  if (row) return row.innerText.split('\\n')[0].trim()
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

/** 只讀「當前顯示中」的那個終端 —— 其餘 session 的終端仍掛載，只是 display:none。 */
const TERMINAL_TEXT = `(() => {
  const host = [...document.querySelectorAll('section[aria-label="${copy('stage.terminal')}"] > div')]
    .find((d) => !d.classList.contains('hidden'))
  const rows = host?.querySelector('.xterm-rows')
  return rows ? rows.innerText : ''
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
  t: { key: 't', code: 'KeyT', vk: 84 },
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

async function runMode(label, { port, rendererUrl }) {
  console.log(`\n── ${label} ──`)

  const repos = makeFixture()
  const profile = seedProfile(repos)
  const app = await launch({ port, profileDir: profile, rendererUrl })

  try {
    check(results, `${label}：app 掛載`, app.mounted === true)

    // ── 還沒選中任何 repo 時，Ctrl+T 為無操作
    //
    // 這個狀態下「+ session」按鈕根本不在 DOM 裡 —— 驗的是它不會炸，也不會憑空生出一個選單。
    await pressKey(app.client, 't', ['ctrl'])
    await sleep(500)
    check(
      results,
      `${label}：沒有選中的 repo 時，Ctrl+T 為無操作且 app 不崩潰`,
      (await app.client.evaluate(MENU_STATE)) === null &&
        (await app.client.evaluate(MOUNTED)) === true,
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
    await typeLine(app.client, 'cat -v')
    await sleep(1000)

    await pressKey(app.client, 'ArrowUp') // 對照組：不帶 Ctrl
    const controlText = await pollUntil(
      app.client,
      TERMINAL_TEXT,
      (value) => String(value).includes('^[[A'),
      8000,
    )
    check(
      results,
      `${label}：對照組 —— 未攔截的方向鍵確實抵達 pty`,
      String(controlText).includes('^[[A'),
      '（沒有這條，下一條的「沒看到垃圾」證明不了任何事）',
    )

    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    await pressKey(app.client, 'ArrowDown', ['ctrl'])
    await pressKey(app.client, 'Tab', ['ctrl'])
    await pressKey(app.client, 'Tab', ['ctrl', 'shift'])
    await sleep(1200)

    // 切回原本那個 session 才讀得到它的終端
    await realClick(app.client, await app.client.evaluate(TAB_RECT(1)))
    await sleep(400)
    const ptyText = String(await app.client.evaluate(TERMINAL_TEXT))
    const leaked = ['^[[1;5A', '^[[1;5B', '^I'].filter((seq) => ptyText.includes(seq))
    check(
      results,
      `${label}：被攔下的按鍵沒有流進 pty`,
      leaked.length === 0,
      leaked.length ? `外洩：${leaked.join(' ')}` : '',
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

    await pressKey(app.client, 'ArrowUp', ['ctrl'])
    const wrappedRepo = await pollUntil(app.client, SELECTED_FOLDER, (v) => v?.includes('repo-c'), 4000)
    check(
      results,
      `${label}：於首端往上會循環到最後一個 repo`,
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
    check(
      results,
      `${label}：spawn 選單開啟時，導航快捷鍵不生效`,
      (await app.client.evaluate(FOCUSED_TAB)) === focusedBeforeMenu &&
        (await app.client.evaluate(MENU_STATE)) !== null,
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
    await typeLine(app.client, 'cat -v')
    await sleep(1000)

    // **對照組不能用「畫面上有沒有 t」判定** —— 畫面上本來就到處是 t（連 `cat -v` 這行命令
    // 自己都有）。要比對的是「終端的內容**有沒有因為這一顆按鍵而改變**」。
    const baseText = String(await app.client.evaluate(TERMINAL_TEXT))
    await pressKey(app.client, 't') // 對照組：不帶 Ctrl
    const echoed = await pollUntil(
      app.client,
      TERMINAL_TEXT,
      (value) => String(value) !== baseText,
      6000,
    )
    check(
      results,
      `${label}：對照組 —— 未攔截的 t 確實抵達 pty`,
      String(echoed) !== baseText,
      '（沒有這條，下一條的「終端沒變化」證明不了任何事）',
    )

    const beforeCtrlT = String(await app.client.evaluate(TERMINAL_TEXT))
    await pressKey(app.client, 't', ['ctrl'])
    await sleep(1000)
    await pressKey(app.client, 'Escape') // 關掉它開出來的選單
    await pollUntil(app.client, MENU_STATE, (v) => v === null, 4000)
    const afterCtrlT = String(await app.client.evaluate(TERMINAL_TEXT))
    check(
      results,
      `${label}：被攔下的 Ctrl+T 沒有流進 pty`,
      afterCtrlT === beforeCtrlT,
      afterCtrlT === beforeCtrlT ? '' : `終端內容變了：…${afterCtrlT.trim().slice(-30)}`,
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
    check(
      results,
      `${label}：repo 沒有 session 時，Ctrl+Tab 為無操作且 app 不崩潰`,
      emptyTabs.length === 0 &&
        (await app.client.evaluate(TABS)).length === 0 &&
        (await app.client.evaluate(MOUNTED)) === true,
    )

    await createSession(app.client)
    await pollUntil(app.client, TABS, (value) => value.length === 1, 10_000)
    const soleFocused = await app.client.evaluate(FOCUSED_TAB)
    await pressKey(app.client, 'Tab', ['ctrl'])
    await sleep(400)
    const stillSole = await app.client.evaluate(FOCUSED_TAB)
    check(
      results,
      `${label}：repo 只有一個 session 時，Ctrl+Tab 為無操作`,
      stillSole === soleFocused && (await app.client.evaluate(MOUNTED)) === true,
      `${soleFocused} → ${stillSole}`,
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

    check(
      results,
      `${label}：workspace 只有一個 folder 時，切換 repo 為無操作且 app 不崩潰`,
      after === before && (await app.client.evaluate(MOUNTED)) === true,
      `${before} → ${after}`,
    )
  } finally {
    await app.destroy()
  }
}

async function main() {
  let devServer = null

  try {
    await runMode('build', { port: BUILD_PORT, rendererUrl: null })
    await checkSingleFolder('build', { port: BUILD_PORT, rendererUrl: null })

    devServer = await startRendererDevServer()
    await runMode('dev', { port: DEV_PORT, rendererUrl: devServer.url })
    await checkSingleFolder('dev', { port: DEV_PORT, rendererUrl: devServer.url })
  } finally {
    if (devServer) {
      try {
        process.kill(-devServer.child.pid, 'SIGKILL')
      } catch {
        // 已經沒了
      }
    }
    for (const dir of temps) {
      try {
        execFileSync('rm', ['-rf', dir])
      } catch {
        // 清不掉就算了
      }
    }
  }

  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} 通過`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
