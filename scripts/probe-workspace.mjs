/**
 * 驗證 workspace-folders、filesystem-access 與 workspace-layout 的 spec scenario。
 *
 * 以 `--user-data-dir` 指向暫存 profile：workspace 設定隨使用者資料目錄走，因此可以
 * 反覆重啟應用程式、餵它一份損毀的設定檔，而不污染開發者真實的設定。
 *
 * 邊界的驗證一律**透過 renderer 實際呼叫 preload 暴露的 API** —— 那才是真正的攻擊面。
 * 純函式層面的窮舉（兄弟目錄前綴、symlink 逃逸）由 `npm test` 的單元測試負責。
 *
 * 用法：npm run probe:workspace
 * 結束碼 0 表示全部 scenario 通過。
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, dragMouse, pollUntil, pressKey, waitForPageTarget } from './lib/cdp.mjs'
import { copy, patternOf, suffixOf } from './lib/copy.mjs'

const DEBUG_PORT = 9223
const results = []
const temps = []

function mkTemp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

/** 在 fixture 上跑真的 git —— 見 makeFixture 中的說明。 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// ── fixture ─────────────────────────────────────────────────────────────────

/** 三種 folder 狀態 + 一個指向 workspace 之外的 symlink（供越界測試）。 */
function makeFixture() {
  const base = mkTemp('spekterm-workspace-fixture-')

  const withOpenSpec = join(base, 'repo-openspec')
  mkdirSync(join(withOpenSpec, 'openspec'), { recursive: true })
  mkdirSync(join(withOpenSpec, 'sub'), { recursive: true })
  writeFileSync(join(withOpenSpec, 'readme.md'), '# x\n')

  // **真的 git repo，不是手寫的 .git/HEAD。**
  //
  // 產品讀的是 `.git/HEAD`，所以手寫一個檔案「看起來」也能驗 —— 但那是**原地覆寫**，而真的
  // `git checkout` 是**寫 HEAD.lock 再 rename 上去**（實測 HEAD 的 inode 每次都變）。對 watcher
  // 來說這是兩種不同的事件：整個「chokidar 在 rename 之後仍然收得到 change」的論證（design D8），
  // 若只用手寫檔案驗收，就**從來沒有被真的測過**。探針自己 spawn git 是可以的 —— 「不得 spawn
  // 外部程式」是加在**產品**身上的約束（由單元測試以 child_process 攔截驗證），不是加在探針身上。
  git(withOpenSpec, ['init', '-q', '-b', 'master'])
  git(withOpenSpec, ['config', 'user.email', 'probe@spekterm.test'])
  git(withOpenSpec, ['config', 'user.name', 'probe'])
  git(withOpenSpec, ['add', '.'])
  git(withOpenSpec, ['commit', '-qm', 'init'])

  const outside = join(base, 'outside')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'secret.txt'), 'do not read\n')
  symlinkSync(outside, join(withOpenSpec, 'escape-link'))

  const plain = join(base, 'repo-plain')
  mkdirSync(plain, { recursive: true })

  // 建立後刪除：模擬「app 關閉期間 folder 被移走」
  const missing = join(base, 'repo-missing')
  mkdirSync(missing, { recursive: true })
  rmSync(missing, { recursive: true })

  return { withOpenSpec, plain, missing }
}

function seedProfile(folders) {
  const profile = mkTemp('spekterm-workspace-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify(
      {
        version: 1,
        folders: folders.map(([id, path]) => ({ id, path, addedAt: '2026-07-10T00:00:00.000Z' })),
      },
      null,
      2,
    ),
  )
  return profile
}

// ── app 啟動 ────────────────────────────────────────────────────────────────

/**
 * 「掛載完成」不等於「可以操作」。視窗以 show:false 建立、待 ready-to-show 才顯示；
 * 在頁面仍是 hidden 的期間 Chromium 會節流 rAF，而版面元件的尺寸更新走 rAF /
 * ResizeObserver —— 此時送出的滑鼠事件會被接收，版面卻不會動。
 * 因此必須等到 visible 且三個分界都就位，才開始互動。
 */
const MOUNTED = `(() => {
  const rail = document.querySelector('aside[aria-label="${copy('rail.label')}"]')
  return Boolean(
    rail &&
    document.getElementById('root')?.children.length &&
    document.visibilityState === 'visible' &&
    document.querySelectorAll('[role="separator"]').length === 3 &&
    rail.getBoundingClientRect().width > 0
  )
})()`

async function launch(profileDir) {
  const electron = spawn(
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
    [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`, '.'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, shell: process.platform === 'win32' },
  )
  let stderr = ''
  electron.stderr.on('data', (chunk) => (stderr += chunk))

  const target = await waitForPageTarget(DEBUG_PORT)
  const client = await connect(target)
  const mounted = await pollUntil(client, MOUNTED, (value) => value === true)

  return {
    client,
    mounted,
    stderr: () => stderr,
    async close() {
      client.close()
      electron.kill('SIGTERM')
      await sleep(600)
    },
  }
}

// ── renderer 內的量測 ───────────────────────────────────────────────────────

/**
 * rail 上的 folder 列。
 *
 * **以「移除」按鈕識別一列**（每個 folder 列都有，session 子列沒有）。它一度是以那顆 `◈`
 * 指示鈕識別的 —— 而 `◈` 已隨 rail-legibility-and-repo-row 移除（它的 onClick 裡只有
 * stopPropagation，是一顆按不下去的假按鈕，且不在雛型裡）。探針的斷言會隨規格過期。
 */
const RAIL_ROWS = `[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] li')]
  .map((li) => {
    const remove = li.querySelector('button[aria-label$="${suffixOf('rail.removeFolder')}"]')
    if (!remove) return null
    const name = remove.getAttribute('aria-label').match(/^${patternOf('rail.removeFolder')}$/)?.[1]
    return {
      name,
      text: li.innerText,
      // rail 不再為「含有 openspec」這個常態發聲 —— 這兩個都必須恆為 false／不存在。
      hasOpenSpecButton: !!li.querySelector('button[aria-label^="${copy('panelSwitch.openSpec')}"]'),
      hasDiamond: li.innerText.includes('◈'),
    }
  })
  .filter(Boolean)`

/**
 * rail 上每一個可點擊的控制項是否都有實際作用。
 *
 * 「不呈現不可操作的控制項」是 workspace-layout 的一條 requirement —— 一個長得像按鈕、按下去
 * 卻什麼都不發生的元素，會反覆消耗使用者的注意力去確認它是不是壞了。這裡以「所有按鈕都必須
 * 具備 aria-label，且不得是已知的純指示用途」來近似；`◈` 那顆的特徵是 disabled 或無任何行為。
 */
const RAIL_BUTTONS = `[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] button')]
  .map((b) => ({ label: b.getAttribute('aria-label'), disabled: b.disabled }))`

const LAYOUT = `(() => {
  const width = (selector) => document.querySelector(selector)?.getBoundingClientRect().width ?? -1
  const separators = [...document.querySelectorAll('[role="separator"]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  const toggle = document.querySelector('main[aria-label="${copy('stage.label')}"] header button[aria-expanded]')
  return {
    separators,
    rail: width('aside[aria-label="${copy('rail.label')}"]'),
    activityBar: width('nav[aria-label="${copy('activityBar.label')}"]'),
    sidePanel: width('section[aria-label="${copy('openspec.sidePanel')}"]'),
    terminal: width('section[aria-label="${copy('stage.terminal')}"]'),
    toggleLabel: toggle?.getAttribute('aria-label') ?? null,
    toggleExpanded: toggle?.getAttribute('aria-expanded') ?? null,
  }
})()`

// label 取自 `aria-label`（`terminal-rendering-and-preferences` 起）—— 入口的無障礙名稱由它供應，
// 先前那個 `.sr-only` span 已移除。`aria-label` 同時是探針的選擇器（自字典取字串，不硬編）。
const ACTIVITY_BAR = `[...document.querySelectorAll('nav[aria-label="${copy('activityBar.label')}"] button')].map((b) => ({
  label: b.getAttribute('aria-label') ?? '',
  disabled: b.disabled,
  current: b.getAttribute('aria-current'),
  title: b.getAttribute('title') ?? '',
}))`

/**
 * 反覆量測直到版面達到預期，或逾時後回傳最後一次結果（讓斷言照常失敗）。
 * 固定 sleep 在慢機器上會偽性失敗，在快機器上則白等。
 */
async function layoutUntil(client, predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs
  let last = await client.evaluate(LAYOUT)
  while (Date.now() < deadline && !predicate(last)) {
    await sleep(80)
    last = await client.evaluate(LAYOUT)
  }
  return last
}

/**
 * 透過真正的 preload API 呼叫 listDir，回報成功或錯誤訊息。
 *
 * fs 的失敗以結果物件回報而非拋出 —— Electron 的 IPC 序列化只保留 message，
 * 會丟掉 `code` 與 `detail`，而 UI 需要它們。
 */
const callListDir = (folderId, relPath) => `(async () => {
  const result = await window.workspace.fs.listDir(${JSON.stringify(folderId)}, ${JSON.stringify(relPath)})
  return result.ok
    ? { ok: true, entries: result.value }
    : { ok: false, message: result.code + ': ' + result.message }
})()`

/** 頂層的 repo 列（**不含 session 子列** —— 子列在 DOM 上同樣是 `li > div[role="button"]`）。 */
const FOLDER_ROW_RECT = (index) => `(() => {
  const row = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > div[role="button"]')][${index}]
  if (!row) return null
  const r = row.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})()`

/** 整個 repo 區塊（`<li>`，含展開的 session 子列）—— 拖曳的命中判定以它為準。 */
const FOLDER_BLOCK_RECT = (index) => `(() => {
  const li = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li')][${index}]
  if (!li) return null
  const r = li.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.y), height: Math.round(r.height) }
})()`

const SESSION_ROW_RECT = (index) => `(() => {
  const rows = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > ul > li > div[role="button"]')]
  const row = rows[${index}]
  if (!row) return null
  const r = row.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})()`

const SESSION_ROW_LABELS = `[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li > ul > li > div[role="button"]')]
  .map((row) => row.innerText.split('\\n')[0].trim())`

/** 當前選中的 repo —— 主舞台的 header 就是它。 */
const SELECTED_FOLDER = `(() => {
  const header = document.querySelector('main[aria-label="${copy('stage.label')}"] header')
  return header ? header.innerText.split('\\n')[0].trim() : null
})()`

/**
 * 一次**真的**按下再放開，中間不移動。
 *
 * 不能用 `.click()`：合成事件不走 mousedown → mouseup 這條路，而拖曳排序的「未位移就視為點擊」
 * 正是靠這兩顆事件之間有沒有位移來判定的。用合成 click 驗它，等於什麼都沒驗。
 */
async function realPressRelease(client, at) {
  const base = { x: at.x, y: at.y, button: 'left', clickCount: 1 }
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
}

/** 靜止時的游標 —— 可拖曳且可點擊的項目必須是 `pointer`，不是 `grab`（呈現契約）。 */
const CURSOR_OF = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  return el ? getComputedStyle(el).cursor : null
})()`

const RAIL_ROW_SELECTOR = `aside[aria-label="${copy('rail.label')}"] > ul > li > div[role="button"]`
const RAIL_SESSION_SELECTOR = `aside[aria-label="${copy('rail.label')}"] > ul > li > ul > li > div[role="button"]`

/** 自 rail 建立一個 login shell 的 session（拖曳的驗收需要一個**展開著子列**的 repo）。 */
const OPEN_SPAWN_MENU = (folderName) => `(() => {
  const button = document.querySelector('button[aria-label="${copy('rail.newSessionIn', { name: '%NAME%' })}"]'
    .replace('%NAME%', ${JSON.stringify(folderName)}))
  if (!button) return false
  button.click()
  return true
})()`

const CLICK_MENU_ITEM = (label) => `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return false
  const item = [...menu.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(label)}))
  if (!item) return false
  item.click()
  return true
})()`

// 不以 aria-label 選取：它會隨收合狀態改變，而狀態的更新比 DOM 寬度晚一個 frame，
// 依 label 選取會在競態下找不到按鈕，讓「展開」靜默地沒有發生。
// 以 aria-expanded 選取而非「header 的第一顆按鈕」—— 身分切換的分頁排在它前面。
const CLICK_TOGGLE = `(() => {
  const button = document.querySelector('main[aria-label="${copy('stage.label')}"] header button[aria-expanded]')
  if (!button) return false
  button.click()
  return true
})()`

// ── 主流程 ──────────────────────────────────────────────────────────────────

const fixture = makeFixture()
const profile = seedProfile([
  ['f-openspec', fixture.withOpenSpec],
  ['f-plain', fixture.plain],
  ['f-missing', fixture.missing],
])

let exitCode = 1
let app = null

try {
  app = await launch(profile)
  if (!check(results, '應用程式啟動且 rail 掛載', app.mounted === true, app.mounted ? '' : app.stderr().slice(0, 300))) {
    throw new Error('rail 未掛載，後續斷言無意義')
  }

  // ── workspace-folders：rail 呈現三種 folder 狀態 ──────────────────────────
  console.log('\nrail 呈現每個 folder 的名稱與身分')
  const rows = await app.client.evaluate(RAIL_ROWS)
  check(results, 'rail 為每個 folder 呈現一列', rows.length === 3, `${rows.length} 列`)
  check(results, '順序與設定檔一致',
    rows.map((r) => r.name).join(',') === 'repo-openspec,repo-plain,repo-missing',
    rows.map((r) => r.name).join(', '))

  const [openSpecRow, plainRow, missingRow] = rows

  // 「含有 openspec」是**常態**，rail 不為它發聲 —— 每一列都喊一次的訊息不傳達任何資訊。
  check(results, '含 openspec 的 folder：rail 不為此呈現任何標示',
    openSpecRow?.hasOpenSpecButton === false &&
      openSpecRow?.hasDiamond === false &&
      !openSpecRow?.text.includes('OpenSpec'),
    openSpecRow?.text.replace(/\n/g, ' · '))

  // 缺少 openspec 是**異常**，才發聲（弱訊號）。
  check(results, '不含 openspec 的 folder：以弱訊號標示',
    plainRow?.text.includes(copy('rail.noOpenspec')),
    plainRow?.text.replace(/\n/g, ' · '))

  check(results, '路徑失效的 folder：明確標示', missingRow?.text.includes(copy('rail.missingBadge')),
    missingRow?.text.replace(/\n/g, ' · '))

  // ── repo-branch：rail 呈現分支 ───────────────────────────────────────────
  check(results, 'rail 呈現 folder 的 git 分支', openSpecRow?.text.includes('master'),
    openSpecRow?.text.replace(/\n/g, ' · '))
  check(results, '非 git repo 不使該列失效（沒有分支是合法狀態）',
    plainRow?.name === 'repo-plain' && !plainRow?.text.includes('master'),
    plainRow?.text.replace(/\n/g, ' · '))

  // ── workspace-layout：rail 不呈現不可操作的控制項 ─────────────────────────
  const buttons = await app.client.evaluate(RAIL_BUTTONS)
  check(results, 'rail 上不存在 ◈ 那顆按不下去的假按鈕',
    buttons.every((b) => !b.label?.startsWith('OpenSpec')),
    buttons.map((b) => b.label).filter(Boolean).slice(0, 5).join(', '))

  const folders = await app.client.evaluate('window.workspace.folders.list()')
  check(results, 'hasOpenSpec 與 status 由主行程重算',
    folders[0].hasOpenSpec === true && folders[1].hasOpenSpec === false && folders[2].status === 'missing',
    folders.map((f) => `${f.name}:${f.status}/${f.hasOpenSpec}`).join(' '))
  check(results, '分支為衍生狀態，由主行程供應',
    folders[0].branch === 'master' && folders[1].branch === null && folders[2].branch === null,
    folders.map((f) => `${f.name}:${f.branch ?? '(無)'}`).join(' '))

  // ── repo-branch：在 app 之外切 branch，rail 自己更新 ──────────────────────
  //
  // 這是這條能力的**核心價值**：使用者就在旁邊的 terminal 裡操作這些 repo。一個切完 branch
  // 還顯示舊分支的 rail，比不顯示分支更糟 —— 它看起來像是真的。
  //
  // **用真的 `git checkout`**，不是改寫 HEAD 檔案。git 是寫 `HEAD.lock` 再 rename 上去（實測
  // HEAD 的 inode 每次都變），這對 watcher 是與原地覆寫**不同的事件** —— design D8 的整個論證
  // （chokidar 在 rename 之後仍然收得到）只有這樣才算真的被驗過。
  git(fixture.withOpenSpec, ['checkout', '-q', '-b', 'feat/x'])
  const switched = await pollUntil(
    app.client,
    `${RAIL_ROWS}[0].text`,
    (text) => typeof text === 'string' && text.includes('feat/x'),
  )
  check(results, '於 app 之外切換分支後，rail 自己更新（不需重啟）',
    typeof switched === 'string' && switched.includes('feat/x') && !switched.includes('master'),
    String(switched).replace(/\n/g, ' · '))

  // detached HEAD：rail 不得空白、不得進入錯誤狀態（同樣走真的 git）
  const sha = git(fixture.withOpenSpec, ['rev-parse', 'HEAD'])
  const shortSha = sha.slice(0, 7)
  git(fixture.withOpenSpec, ['checkout', '-q', '--detach', sha])
  const detached = await pollUntil(
    app.client,
    `${RAIL_ROWS}[0].text`,
    (text) => typeof text === 'string' && text.includes(shortSha),
  )
  check(results, 'detached HEAD 呈現短 sha，rail 不失效',
    typeof detached === 'string' && detached.includes(shortSha),
    `短 sha=${shortSha} → ${String(detached).replace(/\n/g, ' · ')}`)

  // ── repo-branch：folder 於執行期間變成 git repo ───────────────────────────
  //
  // 這條需要**第二層** watcher：實測監看一個「尚不存在」的 `.git/HEAD` 收不到任何事件
  // （連父目錄都不存在，chokidar 無從 attach）。folder 根目錄恆常存在，故以它等 `.git` 出現。
  git(fixture.plain, ['init', '-q', '-b', 'main'])
  const appeared = await pollUntil(
    app.client,
    `${RAIL_ROWS}[1].text`,
    (text) => typeof text === 'string' && text.includes('main'),
  )
  check(results, 'folder 於執行期間變成 git repo，rail 開始呈現分支',
    typeof appeared === 'string' && appeared.includes('main'),
    String(appeared).replace(/\n/g, ' · '))

  // ── filesystem-access：透過真正的 preload API ────────────────────────────
  console.log('\n檔案系統邊界（經 renderer 實際呼叫 preload API）')
  const listRoot = await app.client.evaluate(callListDir('f-openspec', '.'))
  check(results, '以相對路徑列出目錄', listRoot.ok && listRoot.entries.some((e) => e.name === 'openspec' && e.kind === 'directory'),
    listRoot.ok ? listRoot.entries.map((e) => `${e.name}:${e.kind}`).join(' ') : listRoot.message)
  check(results, '回報符號連結為 symlink 而非其指向的種類',
    listRoot.ok && listRoot.entries.find((e) => e.name === 'escape-link')?.kind === 'symlink')

  const listSub = await app.client.evaluate(callListDir('f-openspec', 'sub'))
  check(results, '可列出子目錄', listSub.ok && listSub.entries.length === 0)

  for (const [name, relPath] of [
    ['絕對路徑', '/etc'],
    ['上層參照逃逸', '../'],
    ['symlink 逃逸', 'escape-link'],
    ['symlink 逃逸（穿透到檔案）', 'escape-link/secret.txt'],
  ]) {
    const attempt = await app.client.evaluate(callListDir('f-openspec', relPath))
    check(results, `拒絕${name}`, attempt.ok === false, attempt.ok ? '竟然成功了' : '')
  }

  const unknown = await app.client.evaluate(callListDir('nope', '.'))
  check(results, '拒絕未註冊的 folderId', unknown.ok === false)

  const unavailable = await app.client.evaluate(callListDir('f-missing', '.'))
  check(results, '拒絕路徑失效的 folder', unavailable.ok === false)

  const notADir = await app.client.evaluate(callListDir('f-openspec', 'readme.md'))
  check(results, '目標是檔案時回報錯誤而非空清單', notADir.ok === false)

  // ── workspace-layout：分界、夾制、鍵盤、收合 ─────────────────────────────
  console.log('\n版面：分界可拖動、受夾制、可鍵盤操作、side panel 可收合')
  const before = await app.client.evaluate(LAYOUT)
  check(results, '三處分界皆存在且具 separator 角色', before.separators.length === 3,
    `${before.separators.length} 個 role="separator"`)

  const railSeparator = before.separators[1]
  await dragMouse(app.client, railSeparator, { x: railSeparator.x + 80, y: railSeparator.y })
  const widened = await layoutUntil(app.client, (l) => l.rail > before.rail + 60)
  check(results, '拖動分界改變兩側寬度', widened.rail > before.rail + 60,
    `rail ${Math.round(before.rail)}px → ${Math.round(widened.rail)}px`)

  await dragMouse(app.client, widened.separators[1], { x: 0, y: railSeparator.y })
  const clamped = await layoutUntil(app.client, (l) => Math.abs(l.rail - 180) < 2)
  check(results, '拖過最小寬度時被夾制而不歸零', Math.abs(clamped.rail - 180) < 2,
    `rail = ${Math.round(clamped.rail)}px（minSize 180px）`)

  const focused = await app.client.evaluate(
    `(() => { const s = document.querySelectorAll('[role="separator"]')[1]; s.focus(); return document.activeElement === s })()`,
  )
  check(results, '分界可取得鍵盤焦點', focused === true)
  for (let i = 0; i < 5; i++) await pressKey(app.client, 'ArrowRight')
  const afterKeys = await layoutUntil(app.client, (l) => l.rail > clamped.rail)
  check(results, '方向鍵可調整寬度', afterKeys.rail > clamped.rail,
    `rail ${Math.round(clamped.rail)}px → ${Math.round(afterKeys.rail)}px`)

  // 先把 side panel 拖到一個明顯的寬度，才能證明展開後「還原的是收合前的寬度」
  const inner = afterKeys.separators[2]
  const widthBeforeResize = afterKeys.sidePanel
  await dragMouse(app.client, inner, { x: inner.x - 70, y: inner.y })
  const sized = await layoutUntil(app.client, (l) => l.sidePanel > widthBeforeResize + 50)

  check(results, '點擊收合前 aria-expanded 為 true', sized.toggleExpanded === 'true')

  check(results, '收合鈕存在且可點擊', (await app.client.evaluate(CLICK_TOGGLE)) === true)
  // 寬度先到 0，aria-expanded 由 onResize → setState 更新，晚一個 frame。兩者都要等。
  const collapsed = await layoutUntil(app.client, (l) => l.sidePanel === 0 && l.toggleExpanded === 'false')
  check(results, 'side panel 收合後主舞台其餘部分佔滿',
    collapsed.sidePanel === 0 && collapsed.terminal > sized.terminal,
    `sidePanel=${Math.round(collapsed.sidePanel)}px, terminal ${Math.round(sized.terminal)} → ${Math.round(collapsed.terminal)}px`)
  check(results, '收合後 aria-expanded 為 false', collapsed.toggleExpanded === 'false')

  check(results, '展開鈕存在且可點擊', (await app.client.evaluate(CLICK_TOGGLE)) === true)
  const expanded = await layoutUntil(
    app.client,
    (l) => Math.abs(l.sidePanel - sized.sidePanel) < 2 && l.toggleExpanded === 'true',
  )
  check(results, '展開後還原收合前的寬度', Math.abs(expanded.sidePanel - sized.sidePanel) < 2,
    `${Math.round(sized.sidePanel)}px → ${Math.round(expanded.sidePanel)}px`)

  // ── workspace-layout：活動列 ─────────────────────────────────────────────
  console.log('\n活動列')
  const activity = await app.client.evaluate(ACTIVITY_BAR)
  check(results, '呈現雛型的全部入口', activity.length === 4, `${activity.length} 個`)
  check(results, 'Sessions 可用且預設選取',
    activity[0]?.disabled === false && activity[0]?.current === 'page', activity[0]?.label)
  // **尚未實作的入口自 `terminal-rendering-and-preferences` 起只剩 Handoffs 與 Search** —— Settings
  // 已實作（開啟終端字型設定介面），因此不再是停用的 placeholder（`workspace-layout` 的 MODIFIED
  // requirement）。斷言隨規格走：只檢查中間那兩個。
  const pending = activity.slice(1, 3)
  check(results, '尚未實作的入口停用且附提示',
    pending.length === 2 &&
      pending.every((item) => item.disabled && item.title.includes(suffixOf('activityBar.comingSoon'))),
    pending.map((i) => `${i.label}(disabled=${i.disabled})`).join(', '))
  check(results, 'Settings 入口為可用狀態（已實作，不再是 placeholder）',
    activity[3]?.disabled === false,
    `${activity[3]?.label}(disabled=${activity[3]?.disabled})`)

  // ── terminal-preferences：Settings 入口開啟終端字型設定介面
  //
  // 以**真按下放開**觸發（合成 `.click()` 不走 mousedown → mouseup，見 realPressRelease 的註解）。
  // 介面以 `role="dialog"` 呈現 —— 那不只是無障礙標記，導航快捷鍵正是以它的存在整體不生效。
  const SETTINGS_RECT = `(() => {
    const b = document.querySelector('nav[aria-label="${copy('activityBar.label')}"] button[aria-label="${copy('activityBar.settings')}"]')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`
  const FONT_DIALOG = `(() => {
    const d = document.querySelector('[role="dialog"][aria-label="${copy('settings.title')}"]')
    if (!d) return null
    return {
      family: !!d.querySelector('select[aria-label="${copy('settings.fontFamily')}"]'),
      size: !!d.querySelector('input[aria-label="${copy('settings.fontSize')}"]'),
      lineHeight: !!d.querySelector('input[aria-label="${copy('settings.lineHeight')}"]'),
      gpu: !!d.querySelector('input[aria-label="${copy('settings.gpuAcceleration')}"]'),
      preview: !!d.querySelector('[aria-label="${copy('settings.preview')}"]'),
      // **預覽不得含 block element／box-drawing 字元。** 終端的框線由 GPU renderer 依 cell 邊界
      // 程式化繪製、**不經字型**，而預覽是純 DOM、用的就是字型 —— 留著它們，預覽會顯示終端不會
      // 有的縫，使用者會據此去調一個並不存在的問題。預覽的職責是「這個**字型**長什麼樣」。
      previewHasBoxDrawing: /[\u2500-\u257F\u2580-\u259F]/.test(
        d.querySelector('[aria-label="${copy('settings.preview')}"]')?.textContent ?? '',
      ),
    }
  })()`

  const settingsAt = await app.client.evaluate(SETTINGS_RECT)
  if (settingsAt) await realPressRelease(app.client, settingsAt)
  const dialog = await pollUntil(app.client, FONT_DIALOG, (v) => v !== null, 4000).catch(() => null)
  check(results, '觸發 Settings 開啟終端偏好設定介面（含 family／size／行高／GPU 加速與預覽）',
    dialog?.family === true && dialog?.size === true && dialog?.lineHeight === true &&
      dialog?.gpu === true && dialog?.preview === true,
    JSON.stringify(dialog))

  check(results, '預覽的範例文字不含框線字元（那些字元在終端不經字型）',
    dialog?.previewHasBoxDrawing === false,
    dialog?.previewHasBoxDrawing ? '預覽含 box-drawing —— 它會顯示終端不會有的縫' : '（不含）')

  // 字型 family 以**下拉選單**呈現系統的等寬字，且含「系統預設」選項（dogfood：硬打字型名太難用）。
  //
  // **`count >= 2` 而不是 `>= 1`**：只有「系統預設」那一個選項時 count 就是 1 —— 若 `listMonospaceFonts`
  // 整個壞掉（回空陣列），`>= 1` 照樣會過，那就驗不到「以**系統的等寬字**為選項」這件事（verify 稽核
  // 抓到的假綠）。真實選項至少要有一個，且必須是非空字串。
  const FONT_OPTIONS = `(() => {
    const s = document.querySelector('[role="dialog"] select[aria-label="${copy('settings.fontFamily')}"]')
    if (!s) return null
    const values = [...s.options].map((o) => o.value)
    return { count: values.length, firstValue: values[0], sample: values.slice(1, 4) }
  })()`
  // **必須輪詢**：字型清單是一次非同步 IPC（主行程還要 spawn `fc-list`），對話框出現的那一刻它
  // 還沒回來 —— 只 evaluate 一次會讀到「只有系統預設」而誤判為空（實測踩過）。
  const options = await pollUntil(app.client, FONT_OPTIONS, (v) => v?.count >= 2, 6000).catch(
    () => null,
  )
  check(results, '字型 family 為下拉選單：首項為系統預設（空值），其後為系統的等寬字型',
    options?.firstValue === '' &&
      options?.count >= 2 &&
      options.sample.every((v) => typeof v === 'string' && v.length > 0),
    JSON.stringify(options))

  // ── terminal-preferences：預覽隨選取即時更新
  //
  // **只驗「預覽存在」是不夠的**（verify 稽核抓到）：spec 說的是「隨選取即時更新」。選一個真實的
  // 字型，斷言預覽 computed 的 `font-family` 真的變成它 —— 那才是使用者「套用前就看得到」的依據。
  const PREVIEW_FONT = `(() => {
    const p = document.querySelector('[role="dialog"] [aria-label="${copy('settings.preview')}"]')
    return p ? getComputedStyle(p).fontFamily : null
  })()`
  const previewBefore = await app.client.evaluate(PREVIEW_FONT)
  const picked = options?.sample?.[0]
  if (picked) {
    // 以真實的 change 事件驅動 —— 直接設 value 不會觸發 React 的 onChange。
    await app.client.evaluate(`(() => {
      const s = document.querySelector('[role="dialog"] select[aria-label="${copy('settings.fontFamily')}"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(s, ${JSON.stringify(picked)})
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(300)
  }
  const previewAfter = await app.client.evaluate(PREVIEW_FONT)
  check(results, '預覽隨選取即時更新（以選定的字型呈現）',
    Boolean(picked) && previewAfter !== previewBefore && String(previewAfter).includes(picked),
    `選 ${picked}：${previewBefore} → ${previewAfter}`)

  await pressKey(app.client, 'Escape')
  await sleep(200)
  const dismissed = await app.client.evaluate(`document.querySelector('[role="dialog"]') === null`)
  check(results, 'Esc 關閉終端字型設定介面', dismissed === true)

  // ── workspace-layout：可拖曳項目的游標宣告其主要可供性 ─────────────────────
  //
  // rail 的列**點一下是有作用的**（選中這個 repo／切換 focused session），拖曳是偶爾為之 ——
  // `grab`（張開的手）宣告的是「這個東西只能被拖」，那是錯的可供性。
  console.log('\n拖曳排序與游標')

  // 先在 repo-openspec 底下開一個 session —— 拖曳的驗收**必須有一個展開著 session 子列的 repo**
  // （命中判定以整個區塊為準，而巢狀的兩種拖曳必須互不誤觸；子列收合著就測不到這件事）。
  check(results, '自 rail 開啟 spawn 選單', (await app.client.evaluate(OPEN_SPAWN_MENU('repo-openspec'))) === true)
  await pollUntil(app.client, `Boolean(document.querySelector('[role="menu"]'))`, (v) => v === true, 4000)
  await app.client.evaluate(CLICK_MENU_ITEM(copy('sessions.spawnShell')))
  await pollUntil(app.client, SESSION_ROW_LABELS, (v) => v.length === 1, 10_000)

  check(results, '自 rail 開啟 spawn 選單', (await app.client.evaluate(OPEN_SPAWN_MENU('repo-openspec'))) === true)
  await pollUntil(app.client, `Boolean(document.querySelector('[role="menu"]'))`, (v) => v === true, 4000)
  await app.client.evaluate(CLICK_MENU_ITEM(copy('sessions.spawnShell')))
  const sessionRows = await pollUntil(app.client, SESSION_ROW_LABELS, (v) => v.length === 2, 10_000)
  check(results, 'repo-openspec 底下有兩個 session 子列', sessionRows.length === 2, JSON.stringify(sessionRows))

  check(results, 'repo 列靜止時的游標為 pointer（不是 grab）',
    (await app.client.evaluate(CURSOR_OF(RAIL_ROW_SELECTOR))) === 'pointer',
    String(await app.client.evaluate(CURSOR_OF(RAIL_ROW_SELECTOR))))
  check(results, 'session 子列靜止時的游標為 pointer（不是 grab）',
    (await app.client.evaluate(CURSOR_OF(RAIL_SESSION_SELECTOR))) === 'pointer',
    String(await app.client.evaluate(CURSOR_OF(RAIL_SESSION_SELECTOR))))

  // ── workspace-layout：未位移的按下視為點擊（repo 列現在也掛著 onMouseDown）
  //
  // 這條守的是「加了拖曳之後，點擊還在不在」。**必須送真的 mousedown → mouseup**：合成的
  // `.click()` 不走那條路，用它驗等於什麼都沒驗。
  const orderBeforeClick = (await app.client.evaluate(RAIL_ROWS)).map((r) => r.name).join(',')
  await realPressRelease(app.client, await app.client.evaluate(FOLDER_ROW_RECT(0)))
  await sleep(300)
  const selectedByClick = await app.client.evaluate(SELECTED_FOLDER)
  check(results, '於 repo 列按下再放開（未位移）＝點擊，選中該 repo 且順序不變',
    selectedByClick?.includes('repo-openspec') &&
      (await app.client.evaluate(RAIL_ROWS)).map((r) => r.name).join(',') === orderBeforeClick,
    `選中=${selectedByClick} 順序=${(await app.client.evaluate(RAIL_ROWS)).map((r) => r.name).join(', ')}`)

  // ── workspace-layout：拖曳 repo 改變 rail 的順序
  //
  // 起點是 repo-openspec 的**標題列**（拖曳的起點只掛在那裡），落點以**整個區塊**判定。
  //
  // **落點的期望值一律以「指示線畫在哪裡」為準，不以實作的內部索引為準。** 這裡曾經反過來 ——
  // 探針把準心移到區塊頂端 3px 去遷就一個 off-by-one（往下拖時東西會落在指示線的下一格，拖到
  // 第二個 repo 的下半部就飛到清單末端），於是驗收永遠是綠的，而使用者的拖曳是錯的。
  const railNames = async () => (await app.client.evaluate(RAIL_ROWS)).map((r) => r.name).join(',')
  const dragBlockToY = async (index, y) => {
    const from = await app.client.evaluate(FOLDER_ROW_RECT(index))
    await dragMouse(app.client, from, { x: from.x, y })
    await sleep(400)
  }

  // (a) 拖到 plain 的**上半** ＝ 指示線在 plain 之前 ＝ openspec 現在的位置 → 放開是無操作。
  const plainBlockA = await app.client.evaluate(FOLDER_BLOCK_RECT(1))
  await dragBlockToY(0, plainBlockA.top + 3)
  check(results, '拖到下一個 repo 的上半（＝插在它之前）＝ 原地不動',
    (await railNames()) === 'repo-openspec,repo-plain,repo-missing',
    await railNames())

  // (b) 拖到 plain 的**下半** ＝ 指示線在 plain 之後 → openspec 落到 plain 與 missing 之間。
  //     **這條才是那個 off-by-one 的照妖鏡**：修正前它會越過 missing、飛到清單末端。
  const plainBlockB = await app.client.evaluate(FOLDER_BLOCK_RECT(1))
  await dragBlockToY(0, plainBlockB.top + plainBlockB.height - 3)
  const afterDrag = await pollUntil(app.client, RAIL_ROWS, (rows) => rows[0]?.name === 'repo-plain', 4000)
  check(results, '拖曳 repo 改變 rail 的順序，且落點與指示線一致（不多跳一格）',
    afterDrag.map((r) => r.name).join(',') === 'repo-plain,repo-openspec,repo-missing',
    `${afterDrag.map((r) => r.name).join(', ')}（多跳一格的話會是 repo-plain, repo-missing, repo-openspec）`)

  // (c) 拖到 rail 的**最下方** → 落到清單末端（末端必須拖得到）。
  const missingBlock = await app.client.evaluate(FOLDER_BLOCK_RECT(2))
  await dragBlockToY(1, missingBlock.top + missingBlock.height - 3)
  check(results, '拖到最下方 → 落到清單末端',
    (await railNames()) === 'repo-plain,repo-missing,repo-openspec',
    await railNames())

  // (d) 拖回中間，順便把順序帶回 (b) 的結果 —— 下面的重啟斷言以它為期望值。
  const missingBlockD = await app.client.evaluate(FOLDER_BLOCK_RECT(1))
  await dragBlockToY(2, missingBlockD.top + 3)
  check(results, '往上拖：落在指示線之處',
    (await railNames()) === 'repo-plain,repo-openspec,repo-missing',
    await railNames())

  // 選中的是**那個 repo**，不是那個位置 —— 它移動之後，主舞台呈現的仍該是它。
  check(results, '被移動的 repo 於新位置仍為選中',
    (await app.client.evaluate(SELECTED_FOLDER))?.includes('repo-openspec'),
    String(await app.client.evaluate(SELECTED_FOLDER)))

  check(results, '展開中的 repo 連同其 session 子列一起移動',
    (await app.client.evaluate(SESSION_ROW_LABELS)).length === 2 &&
      (await app.client.evaluate(`[...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] > ul > li')][1].querySelectorAll('ul li').length`)) === 2,
    'session 子列必須跟著它所屬的 repo 走')

  // ── 於 session 子列上拖曳，**只移動 session，repo 的順序不動**
  //
  // 兩種拖曳在 DOM 上是巢狀的。起點若沒有互斥（repo 的 onMouseDown 掛在整個 `<li>` 上），
  // 一次拖曳會**同時移動 session 與 repo** —— 而 fixture 若沒有展開的子列，這個 bug 會躲過
  // 整輪全綠的驗收。
  const railOrderBeforeSessionDrag = (await app.client.evaluate(RAIL_ROWS)).map((r) => r.name).join(',')
  const sessionsBefore = await app.client.evaluate(SESSION_ROW_LABELS)
  const sessionFrom = await app.client.evaluate(SESSION_ROW_RECT(1))
  const sessionTo = await app.client.evaluate(SESSION_ROW_RECT(0))
  await dragMouse(app.client, sessionFrom, { x: sessionTo.x, y: sessionTo.y - 4 })
  const sessionsAfter = await pollUntil(
    app.client,
    SESSION_ROW_LABELS,
    (v) => v[0] === sessionsBefore[1],
    4000,
  )
  check(results, '於 session 子列上拖曳只移動 session',
    JSON.stringify(sessionsAfter) === JSON.stringify([...sessionsBefore].reverse()),
    `${JSON.stringify(sessionsBefore)} → ${JSON.stringify(sessionsAfter)}`)
  check(results, '於 session 子列上拖曳時，repo 的順序不變',
    (await app.client.evaluate(RAIL_ROWS)).map((r) => r.name).join(',') === railOrderBeforeSessionDrag,
    (await app.client.evaluate(RAIL_ROWS)).map((r) => r.name).join(', '))

  // ── terminal-preferences：偏好經主行程清理／夾制後回傳，並落盤 ───────────────
  //
  // 送一個**超出範圍**的 size 與一個**含雙引號**的 family —— 主行程 SHALL 夾制／清理，SHALL NOT
  // 原樣寫入（雙引號會破壞 xterm 的 CSS font-family 字串）。回傳值就是套用後的偏好。
  const applied = await app.client.evaluate(
    `window.workspace.settings.setTerminalFont('Bad"Font', 999, 1.2)`,
  )
  check(results, '寫入偏好時，主行程夾制 size、清理 family、保留合法行高',
    applied?.fontFamily === 'BadFont' && applied?.fontSize === 32 && applied?.lineHeight === 1.2,
    JSON.stringify(applied))

  // 定成一組合法的值，供下面的重啟斷言使用。
  await app.client.evaluate(`window.workspace.settings.setTerminalFont('Fira Code', 15, 1.1)`)

  await app.close()

  // ── workspace-folders：重啟後還原**使用者排定的順序** ─────────────────────
  //
  // 這條同時守住兩件事：清單跨重啟還原，且順序是**使用者排出來的**（不是加入的先後）——
  // 上面那次拖曳把 repo-plain 換到了第一個。
  console.log('\n重啟後還原')
  app = await launch(profile)
  const afterRestart = await app.client.evaluate(RAIL_ROWS)
  check(results, '清單與使用者排定的順序於重啟後一致',
    afterRestart.map((r) => r.name).join(',') === 'repo-plain,repo-openspec,repo-missing',
    afterRestart.map((r) => r.name).join(', '))

  // ── terminal-preferences：字型偏好跨重啟還原 ──────────────────────────────
  const prefsAfterRestart = await app.client.evaluate('window.workspace.settings.get()')
  check(results, '終端字型偏好於重啟後還原',
    prefsAfterRestart?.fontFamily === 'Fira Code' &&
      prefsAfterRestart?.fontSize === 15 &&
      prefsAfterRestart?.lineHeight === 1.1,
    JSON.stringify(prefsAfterRestart))
  await app.close()

  // ── terminal-preferences：偏好設定檔損毀不得阻止啟動 ──────────────────────
  //
  // 與 workspace.json 同一條紀律：無法信任的內容改名保留、以**預設**偏好啟動，絕不讓 app 開不起來。
  const badPrefsProfile = mkTemp('spekterm-badprefs-')
  writeFileSync(join(badPrefsProfile, 'preferences.json'), '{ not json at all')
  app = await launch(badPrefsProfile)
  check(results, '偏好設定檔損毀時應用程式仍正常啟動', app.mounted === true)
  const defaultPrefs = await app.client.evaluate('window.workspace.settings.get()')
  check(results, '損毀的偏好以預設啟動（空偏好）',
    defaultPrefs && Object.keys(defaultPrefs).length === 0, JSON.stringify(defaultPrefs))
  const keptPrefs = readdirSync(badPrefsProfile).filter((n) => n.includes('preferences.json.corrupt-'))
  check(results, '損毀的偏好原檔改名保留而非刪除', keptPrefs.length === 1, keptPrefs[0] ?? '(無)')
  await app.close()

  // ── workspace-folders：設定檔損毀 ────────────────────────────────────────
  console.log('\n設定檔損毀降級')
  const corruptProfile = mkTemp('spekterm-corrupt-')
  writeFileSync(join(corruptProfile, 'workspace.json'), '{ this is not json')
  app = await launch(corruptProfile)
  check(results, '損毀時應用程式仍正常啟動', app.mounted === true)
  const emptyFolders = await app.client.evaluate('window.workspace.folders.list()')
  check(results, '以空 workspace 啟動', Array.isArray(emptyFolders) && emptyFolders.length === 0)
  const kept = readdirSync(corruptProfile).filter((name) => name.includes('workspace.json.corrupt-'))
  check(results, '原檔改名保留而非刪除', kept.length === 1, kept[0] ?? '(無)')
  await app.close()
  app = null

  exitCode = results.every(Boolean) ? 0 : 1
} catch (error) {
  console.error(`\nprobe 失敗：${error.message}`)
  if (app) console.error(app.stderr().slice(0, 600))
} finally {
  if (app) await app.close()
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${exitCode === 0 ? '全部通過' : '有檢查未通過'}（${results.filter(Boolean).length}/${results.length}）`)
process.exit(exitCode)
