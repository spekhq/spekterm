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
  const rail = document.querySelector('aside[aria-label="工作區"]')
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
const RAIL_ROWS = `[...document.querySelectorAll('aside[aria-label="工作區"] li')]
  .map((li) => {
    const remove = li.querySelector('button[aria-label^="自 workspace 移除 "]')
    if (!remove) return null
    const name = remove.getAttribute('aria-label').replace('自 workspace 移除 ', '')
    return {
      name,
      text: li.innerText,
      // rail 不再為「含有 openspec」這個常態發聲 —— 這兩個都必須恆為 false／不存在。
      hasOpenSpecButton: !!li.querySelector('button[aria-label^="OpenSpec"]'),
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
const RAIL_BUTTONS = `[...document.querySelectorAll('aside[aria-label="工作區"] button')]
  .map((b) => ({ label: b.getAttribute('aria-label'), disabled: b.disabled }))`

const LAYOUT = `(() => {
  const width = (selector) => document.querySelector(selector)?.getBoundingClientRect().width ?? -1
  const separators = [...document.querySelectorAll('[role="separator"]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  const toggle = document.querySelector('main[aria-label="主舞台"] header button[aria-expanded]')
  return {
    separators,
    rail: width('aside[aria-label="工作區"]'),
    activityBar: width('nav[aria-label="活動列"]'),
    sidePanel: width('section[aria-label="Side panel"]'),
    terminal: width('section[aria-label="Terminal"]'),
    toggleLabel: toggle?.getAttribute('aria-label') ?? null,
    toggleExpanded: toggle?.getAttribute('aria-expanded') ?? null,
  }
})()`

const ACTIVITY_BAR = `[...document.querySelectorAll('nav[aria-label="活動列"] button')].map((b) => ({
  label: b.querySelector('.sr-only')?.textContent ?? '',
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

// 不以 aria-label 選取：它會隨收合狀態改變，而狀態的更新比 DOM 寬度晚一個 frame，
// 依 label 選取會在競態下找不到按鈕，讓「展開」靜默地沒有發生。
// 以 aria-expanded 選取而非「header 的第一顆按鈕」—— 身分切換的分頁排在它前面。
const CLICK_TOGGLE = `(() => {
  const button = document.querySelector('main[aria-label="主舞台"] header button[aria-expanded]')
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
    plainRow?.text.includes('無 openspec/'),
    plainRow?.text.replace(/\n/g, ' · '))

  check(results, '路徑失效的 folder：明確標示', missingRow?.text.includes('失效'),
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
  check(results, '尚未實作的入口停用且附提示',
    activity.slice(1).every((item) => item.disabled && /尚未可用/.test(item.title)),
    activity.slice(1).map((i) => i.label).join(', '))

  await app.close()

  // ── workspace-folders：重啟後還原 ────────────────────────────────────────
  console.log('\n重啟後還原')
  app = await launch(profile)
  const afterRestart = await app.client.evaluate(RAIL_ROWS)
  check(results, '清單與順序於重啟後一致',
    afterRestart.map((r) => r.name).join(',') === 'repo-openspec,repo-plain,repo-missing',
    afterRestart.map((r) => r.name).join(', '))
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
