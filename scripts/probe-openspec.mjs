/**
 * 驗證 openspec-data-access 與 openspec-panel，以及 workspace-layout 與 terminal-sessions
 * 在本 change 新增的 requirement。
 *
 * 兩種模式各跑一次：`electron .`（正式建置）與 `electron-vite dev`（開發模式）。
 *
 * 幾條驗收的形式值得說明：
 *
 * - **「agent 改檔 → 側欄更新」是這個側欄存在的理由**，因此探針在 app 執行中直接改動 fixture
 *   的 `tasks.md`，斷言進度自己變了 —— 不重新整理、不重啟、不點任何東西。
 * - **錨定不由系統猜**（design D3）：一個恰有一個 active change 的 repo 會自動錨定，
 *   一個有兩個的則**不錨定**。後者才是真正的斷言 —— 它證明我們沒有在多個候選之間亂猜。
 * - **BDD 的上色以 computed color 判定**，不看 class 名 —— class 是實作細節，顏色才是使用者
 *   看到的東西。
 *
 * 用法：npm run probe:openspec
 * 結束碼 0 表示全部 scenario 通過。
 */
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, pollUntil, waitForPageTarget } from './lib/cdp.mjs'
import { copy, suffixOf } from './lib/copy.mjs'

const BUILD_PORT = 9228
const DEV_PORT = 9229

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

// ── fixture ─────────────────────────────────────────────────────────────────

const SPEC = (topic) => `# ${topic} Specification

## Purpose

${topic} 的用途。

## Requirements

### Requirement: ${topic} 可運作

系統 SHALL 讓 ${topic} 運作。

#### Scenario: 正常情況

- **WHEN** 使用者操作
- **THEN** 系統回應
`

const DELTA = `## ADDED Requirements

### Requirement: 核心可運作

系統 SHALL 運作。

#### Scenario: 正常情況

- **WHEN** 使用者操作
- **THEN** 系統回應

## MODIFIED Requirements

### Requirement: 既有的行為改了

系統 SHALL 改以新方式運作。

#### Scenario: 改動後

- **WHEN** 條件成立
- **THEN** 新行為發生
`

/** 1/3 完成。探針稍後會把 1.2 勾掉，斷言進度自己變成 2/3。 */
const TASKS = `## 1. 後端

- [x] 1.1 建立 endpoint
- [ ] 1.2 接上 provider

## 2. 前端

- [ ] 2.1 加按鈕
`

const TASKS_DONE = TASKS.replace('- [ ] 1.2', '- [x] 1.2')
/** 全部勾完 —— reload 之後再改一次，證明新 renderer 的訂閱是活的。 */
const TASKS_ALL_DONE = TASKS_DONE.replace('- [ ] 2.1', '- [x] 2.1')

function writeFile(path, content) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

/**
 * change 的 `.openspec.yaml`。
 *
 * **`created` 是 Timeline 的必要欄位** —— core 的 `createdDate` 只從這裡來。沒有它，change 就
 * 放不上時間軸（會被歸到「沒有建立日期」那一區），Gantt 上一條 bar 都不會有。
 */
function changeMeta(dir, created) {
  writeFile(join(dir, '.openspec.yaml'), `schema: spec-driven\ncreated: ${created}\n`)
}

function makeFixture() {
  const base = mkTemp('spekterm-openspec-fixture-')

  // 兩個 active change —— 建立 session 時**不該**自動錨定（多個候選之間不猜）。
  const many = join(base, 'repo-many')
  writeFile(join(many, 'openspec/config.yaml'), 'schema: spec-driven\n')
  writeFile(join(many, 'openspec/specs/auth/spec.md'), SPEC('auth'))
  writeFile(join(many, 'openspec/specs/billing/spec.md'), SPEC('billing'))
  changeMeta(join(many, 'openspec/changes/add-oauth'), '2026-05-01')
  writeFile(join(many, 'openspec/changes/add-oauth/proposal.md'), '# 加入 OAuth\n\n## Why\n\n因為需要。\n')
  writeFile(join(many, 'openspec/changes/add-oauth/tasks.md'), TASKS)
  writeFile(join(many, 'openspec/changes/add-oauth/specs/auth/spec.md'), DELTA)
  changeMeta(join(many, 'openspec/changes/add-invoice'), '2026-06-10')
  writeFile(join(many, 'openspec/changes/add-invoice/proposal.md'), '# 加入發票\n\n## Why\n\n因為需要。\n')
  writeFile(join(many, 'openspec/changes/add-invoice/tasks.md'), '## 1. 後端\n\n- [ ] 1.1 開工\n')
  changeMeta(join(many, 'openspec/changes/archive/2026-01-01-legacy-login'), '2025-12-01')
  writeFile(
    join(many, 'openspec/changes/archive/2026-01-01-legacy-login/proposal.md'),
    '# 舊的登入\n\n## Why\n\n歷史。\n',
  )

  // 恰一個 active change —— 建立 session 時應自動錨定它。
  const single = join(base, 'repo-single')
  // 驗「未存的編輯跨身分存活」要有東西可編輯。**刻意不用 .md** —— markdown 預設以預覽模式
  // 呈現（Phase 3 的 [預覽 │ 原始碼] 切換），畫面上根本沒有編輯器可以打字。
  writeFile(join(single, 'notes.txt'), 'plain text\nsecond line\n')
  writeFile(join(single, 'openspec/config.yaml'), 'schema: spec-driven\n')
  writeFile(join(single, 'openspec/specs/core/spec.md'), SPEC('core'))
  changeMeta(join(single, 'openspec/changes/solo-change'), '2026-05-20')
  writeFile(join(single, 'openspec/changes/solo-change/proposal.md'), '# 唯一的 change\n\n## Why\n\n因為需要。\n')
  writeFile(join(single, 'openspec/changes/solo-change/tasks.md'), TASKS)
  writeFile(join(single, 'openspec/changes/solo-change/specs/core/spec.md'), DELTA)

  // 有 openspec/、但**一個 active change 都沒有**（只有 archived）。
  // 這個 repo 才問得出「降級的層級對不對」：OpenSpec 身分仍應可用、Specs／Changes／Graph 三個
  // 視圖仍應有內容，只有「本 change」視圖是空狀態（design D2）。
  const archivedOnly = join(base, 'repo-archived-only')
  writeFile(join(archivedOnly, 'openspec/config.yaml'), 'schema: spec-driven\n')
  writeFile(join(archivedOnly, 'openspec/specs/legacy/spec.md'), SPEC('legacy'))
  changeMeta(join(archivedOnly, 'openspec/changes/archive/2026-01-01-done-change'), '2025-11-15')
  writeFile(
    join(archivedOnly, 'openspec/changes/archive/2026-01-01-done-change/proposal.md'),
    '# 做完的 change\n\n## Why\n\n歷史。\n',
  )
  writeFile(
    join(archivedOnly, 'openspec/changes/archive/2026-01-01-done-change/specs/legacy/spec.md'),
    DELTA,
  )

  const plain = join(base, 'repo-plain')
  mkdirSync(plain, { recursive: true })

  return { many, single, archivedOnly, plain }
}

/**
 * 一支 stub `claude`，供「錨定不隨 pty 的輸出改變」那組驗收使用。
 *
 * 那組驗收的**成對斷言**要求「標題真的變了（證明測試不是空轉），而錨定沒有跟著變」。
 * 本 change 之後 login shell **不再採用** pty 宣告的標題 —— 於是那個「標題真的變了」的前提在
 * shell session 上永遠不成立，整條測試會空轉（守衛因此轉紅，正是它該做的事）。載體必須換成
 * **claude 目標**的 session。
 *
 * 手法與 `probe-terminal.mjs` 的 `makeStubClaude` 相同：產品的 claude 模式是
 * `$SHELL -l -c claude`（從 PATH 解析），pty 又整份繼承 Electron 的 env。**HOME 也要換掉** ——
 * 否則 `~/.profile` 的 `PATH="$HOME/.local/bin:$PATH"` 會把本機真正的 claude 搶回前面。
 * stub 直接 `exec /bin/sh -i`（不看 `$SHELL`）：`sh` 不會自己送 OSC 標題，標籤因此是確定的。
 */
function makeStubClaude() {
  const home = mkTemp('spekterm-openspec-stubhome-')
  const bin = join(home, '.local', 'bin')
  mkdirSync(bin, { recursive: true })

  const claude = join(bin, 'claude')
  writeFileSync(claude, '#!/bin/sh\nexec /bin/sh -i\n')
  chmodSync(claude, 0o755)

  return { home, bin }
}

function seedProfile(folders) {
  const profile = mkTemp('spekterm-openspec-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: folders.map(([id, path]) => ({ id, path, addedAt: '2026-07-11T00:00:00.000Z' })),
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

async function launch({ port, profileDir, rendererUrl, stub }) {
  const child = spawn(
    'electron',
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '.'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // 釘死 shell：可預測、無 profile 雜訊，且**不會自己送 OSC 標題**（zsh 會，那會讓
        // claude session 的標籤變成 `使用者@主機:/路徑`，測試就不確定了）。
        SHELL: '/bin/sh',
        // claude 模式從 PATH 解析 `claude` —— 前置 stub 的目錄，並換掉 HOME（見 makeStubClaude）。
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
    async close() {
      client.close()
      child.kill('SIGTERM')
      await sleep(400)
      // wrapper 殺不到它 spawn 的真 electron —— 以獨一無二的 profile 路徑連根拔除整棵樹。
      try {
        execFileSync('pkill', ['-9', '-f', profileDir], { stdio: 'ignore' })
      } catch {
        // 找不到符合的行程時 pkill 回非零碼，那正是我們要的結果。
      }
      await sleep(200)
    },
  }
}

// ── renderer 內的量測（一律以 role / aria-label 選取，不掛 data-*）───────────

const SELECT_FOLDER = (name) => `(() => {
  const row = [...document.querySelectorAll('aside[aria-label="${copy('rail.label')}"] div[role="button"]')]
    .find((el) => el.innerText.includes(${JSON.stringify(name)}))
  if (!row) return false
  row.click()
  return true
})()`

const IDENTITY = `(() => {
  if (document.querySelector('section[aria-label="${copy('files.label')}"]')) return 'files'
  if (document.querySelector('section[aria-label="${copy('openspec.label')}"]')) return 'openspec'
  return null
})()`

// 這個 app 現在有四個 tablist（身分切換／OpenSpec 視圖／change artifact／session 分頁）。
// **每一個選擇器都必須連 aria-label 一起指名**，否則會抓成一團。
const SWITCH = `[role="tablist"][aria-label="${copy('panelSwitch.label')}"]`

const CLICK_IDENTITY = (icon) => `(() => {
  const tab = [...document.querySelectorAll('${SWITCH} button[role="tab"]')]
    .find((el) => el.innerText.trim().startsWith(${JSON.stringify(icon)}))
  if (!tab) return false
  tab.click()
  return true
})()`

const VIEW_TABS = `[...document.querySelectorAll('[role="tablist"][aria-label="${copy('openspec.views')}"] button[role="tab"]')]
  .map((tab) => ({ label: tab.innerText.trim(), selected: tab.getAttribute('aria-selected') === 'true' }))`

const CLICK_VIEW = (label) => `(() => {
  const tab = [...document.querySelectorAll('[role="tablist"][aria-label="${copy('openspec.views')}"] button[role="tab"]')]
    .find((el) => el.innerText.trim() === ${JSON.stringify(label)})
  if (!tab) return false
  tab.click()
  return true
})()`

/** 側欄同時只顯示一個視圖 —— 以各視圖的標誌性 landmark 判定。 */
const VISIBLE_VIEWS = `[
  document.querySelector('[role="tablist"][aria-label="${copy('openspec.changeArtifact')}"]') ? 'change' : null,
  document.querySelector('section[aria-label="${copy('openspec.specs')}"]') ? 'browse' : null,
].filter(Boolean)`

/** 「本 change」視圖顯示的 slug（空狀態時為 null）。 */
const ANCHORED_SLUG = `(() => {
  const h = document.querySelector('section[aria-label="${copy('openspec.label')}"] h2')
  return h ? h.innerText.trim() : null
})()`

const CHANGE_EMPTY_TEXT = `(() => {
  const panel = document.querySelector('section[aria-label="${copy('openspec.label')}"]')
  if (!panel) return null
  if (panel.querySelector('[role="tablist"][aria-label="${copy('openspec.changeArtifact')}"]')) return null
  return panel.innerText.includes('${copy('openspec.noAnchoredChange')}') ? panel.innerText.trim() : null
})()`

// ── 本 change：artifact 分頁 ────────────────────────────────────────────────

const ARTIFACT_TABS = `[...document.querySelectorAll('[role="tablist"][aria-label="${copy('openspec.changeArtifact')}"] button[role="tab"]')]
  .map((t) => ({ label: t.innerText.trim(), selected: t.getAttribute('aria-selected') === 'true' }))`

const CLICK_ARTIFACT = (label) => `(() => {
  const tab = [...document.querySelectorAll('[role="tablist"][aria-label="${copy('openspec.changeArtifact')}"] button[role="tab"]')]
    .find((t) => t.innerText.trim().toLowerCase() === ${JSON.stringify(label)}.toLowerCase())
  if (!tab) return false
  tab.click()
  return true
})()`

const PANEL_TEXT = `document.querySelector('section[aria-label="${copy('openspec.label')}"]')?.innerText ?? ''`

const PROGRESS = `(() => {
  const bar = document.querySelector('section[aria-label="${copy('openspec.label')}"] [role="progressbar"][aria-label="${copy('openspec.taskProgress')}"]')
  if (!bar) return null
  return { now: Number(bar.getAttribute('aria-valuenow')), max: Number(bar.getAttribute('aria-valuemax')) }
})()`

const TASK_SECTIONS = `[...document.querySelectorAll('section[aria-label="${copy('openspec.tasks')}"] h4')].map((h) => h.innerText.trim())`

/** 已完成的項目要與未完成者在視覺上可區分 —— 看 computed style，不看 class。 */
const TASK_ITEMS = `[...document.querySelectorAll('section[aria-label="${copy('openspec.tasks')}"] li')].map((li) => ({
  text: li.innerText.replace(/\\s+/g, ' ').trim(),
  struck: getComputedStyle(li).textDecorationLine.includes('line-through'),
}))`

const DELTA_BADGES = `[...document.querySelectorAll('section[aria-label="${copy('openspec.specDeltas')}"] span')]
  .map((s) => s.innerText.trim())
  .filter((t) => ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'].includes(t))`

/** BDD 關鍵字的顏色。WHEN 是 blue、THEN 是 green —— 兩者必須不同，且都不是內文的顏色。 */
const BDD_COLORS = `(() => {
  const strongs = [...document.querySelectorAll('section[aria-label="${copy('openspec.specDeltas')}"] strong')]
  const pick = (word) => {
    const el = strongs.find((s) => s.innerText.trim() === word)
    return el ? getComputedStyle(el).color : null
  }
  const body = document.querySelector('section[aria-label="${copy('openspec.specDeltas')}"] p')
  return { when: pick('WHEN'), then: pick('THEN'), body: body ? getComputedStyle(body).color : null }
})()`

// ── 瀏覽：兩棵樹 ───────────────────────────────────────────────────────────
//
// 樹上的一列是 `[role="treeitem"]`，`aria-level` 表示層級（頂層區段不是 treeitem）。
// Specs：topic 在 level 2、heading 在 level 3/4。Changes：群組在 level 2、change 在 level 3。

const SPEC_TREE_TOPICS = `[...document.querySelectorAll('section[aria-label="${copy('openspec.specs')}"] [role="treeitem"][aria-level="2"]')]
  .map((r) => ({ topic: r.getAttribute('title'), text: r.innerText.replace(/\\s+/g, ' ').trim(), expanded: r.getAttribute('aria-expanded') }))`

const SPEC_TREE_HEADINGS = `[...document.querySelectorAll('section[aria-label="${copy('openspec.specs')}"] [role="treeitem"][aria-level="3"], section[aria-label="${copy('openspec.specs')}"] [role="treeitem"][aria-level="4"]')]
  .map((r) => r.getAttribute('title'))`

/** 樹上一列有兩顆 button：展開鈕與「開啟」鈕。**點箭頭只展開，不換內容** —— 兩者不可混用。 */
const EXPAND_TREE_ROW = (title) => `(() => {
  const row = [...document.querySelectorAll('section[aria-label="${copy('openspec.label')}"] [role="treeitem"]')]
    .find((r) => r.getAttribute('title') === ${JSON.stringify(title)})
  if (!row) return false
  const toggle = row.querySelector('button[aria-label="${copy('openspec.expand')}"], button[aria-label="${copy('openspec.collapse')}"]')
  if (!toggle) return false
  toggle.click()
  return true
})()`

const ACTIVATE_TREE_ROW = (title) => `(() => {
  const row = [...document.querySelectorAll('section[aria-label="${copy('openspec.label')}"] [role="treeitem"]')]
    .find((r) => r.getAttribute('title') === ${JSON.stringify(title)})
  if (!row) return false
  const buttons = [...row.querySelectorAll('button')]
  const activate = buttons[buttons.length - 1]
  if (!activate) return false
  activate.click()
  return true
})()`

const CHANGE_TREE_ROWS = (group) => `[...document.querySelectorAll('section[aria-label="${group} changes"] [role="treeitem"][aria-level="3"]')]
  .map((r) => ({
    slug: r.getAttribute('title'),
    anchored: r.getAttribute('aria-selected') === 'true',
    text: r.innerText.replace(/\\s+/g, ' ').trim(),
  }))`

const SPEC_CONTENT = `document.querySelector('section[aria-label="${copy('openspec.label')}"]')?.innerText ?? ''`

// ── Graph / Timeline 的全視窗 overlay ──────────────────────────────────────

const CLICK_OPEN_VIZ = (kind) => `(() => {
  const btn = document.querySelector('button[aria-label="${copy(
    kind === 'Graph' ? 'openspec.openGraph' : 'openspec.openTimeline',
  )}"]')
  if (!btn) return false
  btn.click()
  return true
})()`

/** overlay 存在嗎？它是什麼？以及它是否真的**蓋滿視窗**（design D12 的重點）。 */
const OVERLAY = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
  if (!dialog) return null
  const r = dialog.getBoundingClientRect()
  return {
    label: dialog.getAttribute('aria-label'),
    coversViewport:
      Math.round(r.width) >= window.innerWidth && Math.round(r.height) >= window.innerHeight,
    width: Math.round(r.width),
    height: Math.round(r.height),
  }
})()`

/** 當前選中的 repo —— 主舞台的 header 第一行就是它。 */
const SELECTED_FOLDER = `(() => {
  const header = document.querySelector('main[aria-label="${copy('stage.label')}"] header')
  return header ? header.innerText.split('\\n')[0].trim() : null
})()`

/** 力導向圖的節點：spec 是 circle、change 是 rect。 */
const GRAPH_NODES = `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const svg = dialog?.querySelector('svg')
  if (!svg) return null
  return {
    circles: svg.querySelectorAll('.nodes circle').length,
    rects: svg.querySelectorAll('.nodes rect').length,
    edges: svg.querySelectorAll('.links line').length,
    labels: [...svg.querySelectorAll('.nodes text')].map((t) => t.textContent),
  }
})()`

/**
 * 力導向圖是動的 —— 要點某個節點得先讓它停下來，再量它當下的位置。
 *
 * **量的是圓／方本身，不是整個 `<g>`** —— `<g>` 的 bounding box 含底下的文字標籤，中心點會落在
 * 圖形與文字之間的空白處，點下去什麼也不會發生（實測踩到）。
 */
const GRAPH_NODE_RECT = (nodeId) => `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  // 以 d3 綁在元素上的 __data__.id 定位，**不要用節點的文字標籤** —— core 的
  // GraphNode.label 對 change 是 humanize 過的描述（"solo change"），不是 slug（"solo-change"）。
  const g = [...(dialog?.querySelectorAll('.nodes > g') ?? [])]
    .find((n) => n.__data__?.id === ${JSON.stringify(nodeId)})
  const shape = g?.querySelector('circle, rect')
  if (!shape) return null
  const r = shape.getBoundingClientRect()
  if (r.width === 0) return null
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const TIMELINE = `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  // 這個 aria-label 來自 **@spekjs/ui 套件內部**，不是我們的文案 —— 不歸字典管，硬編是對的。
  const svg = dialog?.querySelector('svg[aria-label="Change lifecycle timeline"]')
  if (!svg) return null
  const labels = [...dialog.querySelectorAll('.spekui-timeline-label')].map((b) =>
    b.innerText.replace(/\\s+/g, ' ').trim(),
  )
  return {
    // bar（含 active 的箭頭三角形與透明 hit area）與 today 虛線都在這張 svg 裡
    bars: svg.querySelectorAll('rect').length,
    arrows: svg.querySelectorAll('polygon').length,
    labels,
  }
})()`

const TIMELINE_LABEL_RECT = (slug) => `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const btn = [...(dialog?.querySelectorAll('.spekui-timeline-label') ?? [])]
    .find((b) => b.innerText.includes(${JSON.stringify(slug)}))
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

/** 顏色契約有沒有接上 —— 套件的變數必須解析到**我們的**主題色，而不是它自己的預設值。 */
const SPEK_THEME_VARS = `(() => {
  const styles = getComputedStyle(document.documentElement)
  const read = (name) => styles.getPropertyValue(name).trim()
  return {
    accent: read('--spek-accent'),
    border: read('--spek-border'),
    ours: read('--color-accent'),
  }
})()`

// ── 交叉導覽 ───────────────────────────────────────────────────────────────

const CLICK_OPEN_FILE = (needle) => `(() => {
  const btn = [...document.querySelectorAll('button[aria-label$="${suffixOf('openspec.openInFiles')}"]')]
    .find((b) => (b.getAttribute('aria-label') ?? '').includes(${JSON.stringify(needle)}))
  if (!btn) return false
  btn.click()
  return true
})()`

const CLICK_VIEW_IN_OPENSPEC = `(() => {
  const btn = document.querySelector('button[aria-label="${copy('files.viewInOpenSpec')}"]')
  if (!btn) return false
  btn.click()
  return true
})()`

/** Files 身分：當前開啟檔案的路徑（breadcrumb 的最後一段）。 */
const OPEN_FILE_PATH = `(() => {
  const nav = document.querySelector('section[aria-label="${copy('files.label')}"] nav[aria-label="${copy('files.pathNav')}"]')
  if (!nav) return null
  const last = nav.querySelector('span[title]')
  return last ? last.getAttribute('title') : null
})()`

const SESSION_TABS = `[...document.querySelectorAll('[role="tablist"][aria-label="${copy('sessions.tabs')}"] button[role="tab"]')]
  .map((t) => ({ label: t.innerText.trim(), selected: t.getAttribute('aria-selected') === 'true' }))`

// ── Files 身分的檔案樹（驗未存的編輯跨身分存活）──────────────────────────
//
// **必須限定在 Files 之內** —— 瀏覽視圖的兩棵樹也是 `[role="treeitem"]`。

const FILES_TREE = `section[aria-label="${copy('files.label')}"] [role="treeitem"]`

const TREE_ROWS = `[...document.querySelectorAll('${FILES_TREE}')].map((r) => r.getAttribute('title'))`

const CLICK_ROW = (relPath) => `(() => {
  const row = [...document.querySelectorAll('${FILES_TREE}')]
    .find((r) => r.getAttribute('title') === ${JSON.stringify(relPath)})
  if (!row) return false
  row.click()
  return true
})()`

const ROW_IS_DIRTY = (relPath) => `(() => {
  const row = [...document.querySelectorAll('${FILES_TREE}')]
    .find((r) => r.getAttribute('title') === ${JSON.stringify(relPath)})
  return row ? Boolean(row.querySelector('[aria-label="${copy('files.unsaved')}"]')) : null
})()`

const EDITOR_TEXT = `document.querySelector('.monaco-editor .view-lines')?.innerText.replace(/\\u00a0/g, ' ') ?? null`

const FOCUS_EDITOR = `(() => {
  const textarea = document.querySelector('.monaco-editor textarea')
  if (!textarea) return false
  textarea.focus()
  return document.activeElement === textarea
})()`

const TERMINAL_RECT = `(() => {
  const el = document.querySelector('section[aria-label="${copy('stage.terminal')}"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const NEW_SESSION_RECT = `(() => {
  const el = document.querySelector('[aria-label="${copy('sessions.new')}"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const MENU_ITEM_RECT = (label) => `(() => {
  const menu = document.querySelector('[role="menu"]')
  if (!menu) return null
  const item = [...menu.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(label)}))
  if (!item) return null
  const r = item.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

// ── 側欄來源指示器（side-panel-source）──────────────────────────────────────

const PANEL_SOURCE_RECT = `(() => {
  const el = document.querySelector('[aria-label="${copy('panelSource.change')}"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const PANEL_SOURCE_LABEL = `(() => {
  const el = document.querySelector('[aria-label="${copy('panelSource.change')}"]')
  return el ? el.innerText.trim() : null
})()`

const BACK_TO_OWN_RECT = `(() => {
  const el = document.querySelector('[aria-label="${copy('panelSource.backToOwn')}"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`

const HAS_BACK_TO_OWN = `Boolean(document.querySelector('[aria-label="${copy('panelSource.backToOwn')}"]'))`

const FOCUS_SESSION_TAB = (index) => `(() => {
  const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="${copy('sessions.tabs')}"] button[role="tab"]')]
  const tab = tabs[${index}]
  if (!tab) return false
  tab.click()
  return true
})()`

// ── 輸入 ────────────────────────────────────────────────────────────────────

const center = (rect) => ({
  x: Math.round(rect.x + rect.width / 2),
  y: Math.round(rect.y + rect.height / 2),
})

/** 送真的滑鼠事件，不用 element.dispatchEvent(new MouseEvent(...))。 */
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

/**
 * 量到一個**位置已經穩定**的矩形再回傳（連續 `samples` 次量到同一個位置才算數）。
 *
 * **量完就點會點空。** 分頁列是會動的：pty 宣告的 OSC 標題比 session 本身晚到很多 —— shell
 * 要載完 rc、畫出第一個 prompt 才會送出 `ESC ] 0 ; ... BEL`，實測是一秒以上。標題一到，分頁
 * 的標籤就從 `shell 1` 變成 `kewang@host:/長長的/路徑`，寬度暴增，把它右邊的「+ session」
 * 整個往右推（實測跳了 150px）。探針量到的座標於是過期，點擊落在變寬後的分頁標籤上 ——
 * click 的 target 是那個 `SPAN` 而不是按鈕，選單自然開不起來，**症狀看起來卻像「產品的選單
 * 壞了」**。
 *
 * 取樣窗口必須跨過那個延遲：只連量兩次、間隔 150ms，會落在標題抵達前的**假平靜期**裡。
 *
 * 這與「先訂閱、再列目錄」同源：**在會變動的東西上取一次快照，就是在賭它不變。**
 */
async function stableRect(client, expression, { samples = 3, gapMs = 250, timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let previous = null
  let same = 0

  while (Date.now() < deadline) {
    const rect = await client.evaluate(expression)
    const unchanged =
      rect &&
      previous &&
      rect.x === previous.x &&
      rect.y === previous.y &&
      rect.width === previous.width

    same = unchanged ? same + 1 : 0
    previous = rect
    if (same >= samples - 1) return rect

    await sleep(gapMs)
  }

  return previous
}

async function pressEscape(client) {
  const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/**
 * `Ctrl+↓`（rail 上的下一個 repo）。
 *
 * **`rawKeyDown` 而非 `keyDown`**：帶修飾鍵而不產生文字的按鍵走的是 raw 事件；用 `keyDown`
 * 並附 `text` 會多出一個 char 事件（在終端上就是多打了一個字）。
 */
async function pressCtrlArrowDown(client) {
  const key = {
    key: 'ArrowDown',
    code: 'ArrowDown',
    windowsVirtualKeyCode: 40,
    nativeVirtualKeyCode: 40,
    modifiers: 2 /* Ctrl */,
  }
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/**
 * 送一行指令給終端。
 *
 * **Enter 必須是一次真的按鍵事件** —— 把 `\r` 併進 `Input.insertText` 的文字裡，字元會抵達 pty
 *（終端上看得到回顯），但 shell 從未執行那一行（xterm 的換行是在 keydown 上判讀的）。
 */
async function typeLine(client, text) {
  await client.send('Input.insertText', { text })
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/** 自分頁列的「+ session」建立一個 shell session。 */
async function createSession(client, target = 'shell') {
  //
  // **點完要確認選單真的開了，沒開就重量再點。** 對手是一個外部行程（pty）何時吐出標題，
  // 穩定判準只能把機率壓低、消不掉它。點空的那一下最多是點到隔壁分頁（把它 focus 起來），
  // 無害；而標題抵達後版面就不再動，重試必定收斂。
  for (let attempt = 1; attempt <= 3; attempt++) {
    const btn = await stableRect(client, NEW_SESSION_RECT)
    if (!btn) throw new Error('找不到「+ session」按鈕')
    await realClick(client, btn)

    const item = await pollUntil(client, MENU_ITEM_RECT(target), (value) => value !== null, 2000)
    if (item) {
      await realClick(client, item)
      return
    }
  }

  throw new Error(`選單中找不到 ${target}（重量再點 3 次仍未開啟）`)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function runMode(label, { port, rendererUrl }) {
  console.log(`\n── ${label} ──`)

  const { many, single, archivedOnly, plain } = makeFixture()
  const profile = seedProfile([
    ['f-many', many],
    ['f-single', single],
    ['f-archived', archivedOnly],
    ['f-plain', plain],
  ])

  const stub = makeStubClaude()
  const app = await launch({ port, profileDir: profile, rendererUrl, stub })
  check(results, 'app 掛載', app.mounted === true)

  try {
    // ── 預設身分、兩個視圖、衍生的預設錨定 ──────────────────────────────────
    console.log('\n預設身分與兩個視圖')
    // **必須輪詢。** `MOUNTED` 只等 rail 的 <aside> 出現 —— folder 列來自一次非同步的
    // `folders.list()`，晚一步才渲染。只 evaluate 一次的話，機器一忙就選不到那一列，
    // 而後面每一條斷言都會跟著紅（看起來像側欄壞了，其實只是還沒畫出來）。
    const picked = await pollUntil(app.client, SELECT_FOLDER('repo-single'), (ok) => ok === true, 8000)
    check(results, '選中含 openspec 的 folder', picked === true)
    const identity = await pollUntil(app.client, IDENTITY, (value) => value !== null, 8000)
    check(results, '預設身分為 OpenSpec', identity === 'openspec', String(identity))

    const tabs = await pollUntil(app.client, VIEW_TABS, (list) => list.length > 0, 8000)
    check(
      results,
      'OpenSpec 身分呈現「本 change」與「瀏覽」兩個視圖',
      tabs.length === 2 &&
        tabs.map((t) => t.label).join(',') ===
          [copy('openspec.tabChange'), copy('openspec.tabBrowse')].join(','),
      tabs.map((t) => t.label).join(', '),
    )
    check(
      results,
      '預設視圖為「本 change」',
      tabs.find((t) => t.selected)?.label === copy('openspec.tabChange'),
    )

    // **尚未建立任何 session** —— 恰一個 active change 時仍要看得到它（衍生的預設值，不是
    // 建立 session 時的快照）。使用者選了 repo 卻看到空白側欄，是說不過去的。
    const derived = await pollUntil(app.client, ANCHORED_SLUG, (value) => value !== null, 10_000)
    check(
      results,
      '尚未建立 session 就呈現唯一的 active change',
      derived === 'solo-change',
      String(derived),
    )

    // ── 本 change：artifact 分頁 ────────────────────────────────────────────
    console.log('\n本 change：每個 artifact 一個分頁')
    const artifacts = await pollUntil(app.client, ARTIFACT_TABS, (list) => list.length > 0, 8000)
    const names = artifacts.map((a) => a.label.toLowerCase())
    check(
      results,
      '每個 artifact 各有一個分頁',
      names.includes('proposal') && names.includes('tasks') && names.some((n) => n.includes('spec')),
      artifacts.map((a) => a.label).join(', '),
    )
    check(
      results,
      '預設停在 tasks 分頁',
      artifacts.find((a) => a.selected)?.label.toLowerCase() === 'tasks',
      artifacts.find((a) => a.selected)?.label,
    )

    const progress = await pollUntil(app.client, PROGRESS, (value) => value !== null, 8000)
    check(results, 'tasks 進度呈現完成數與總數', progress?.now === 1 && progress?.max === 3, JSON.stringify(progress))

    const sections = await app.client.evaluate(TASK_SECTIONS)
    check(results, 'tasks 依 section 分組', sections.join(',') === '1. 後端,2. 前端', sections.join(', '))

    const items = await app.client.evaluate(TASK_ITEMS)
    const done = items.filter((i) => i.struck)
    check(
      results,
      '已完成與未完成的 task 可區分',
      items.length === 3 && done.length === 1 && done[0].text.includes('建立 endpoint'),
      `${done.length}/${items.length} 有刪除線`,
    )

    // proposal 一度整個被漏掉（雛型的「本 change」只畫了 tasks 與 spec deltas）。
    check(results, '可切換至 proposal 分頁', (await app.client.evaluate(CLICK_ARTIFACT('proposal'))) === true)
    const proposalText = await pollUntil(
      app.client,
      PANEL_TEXT,
      (text) => text.includes('唯一的 change'),
      8000,
    )
    check(results, 'proposal 的內容被呈現', proposalText.includes('唯一的 change'))

    // 進度條**不進分頁** —— 讀 proposal 時仍要看得到這個 change 的狀態摘要。
    const progressOnProposal = await app.client.evaluate(PROGRESS)
    check(
      results,
      '進度不隨分頁切換而消失',
      progressOnProposal?.now === 1 && progressOnProposal?.max === 3,
      JSON.stringify(progressOnProposal),
    )

    // ── spec deltas 分頁 ───────────────────────────────────────────────────
    const specsTab = artifacts.find((a) => a.label.toLowerCase().includes('spec'))
    check(results, '可切換至 spec deltas 分頁', (await app.client.evaluate(CLICK_ARTIFACT(specsTab.label))) === true)

    const badges = await pollUntil(app.client, DELTA_BADGES, (list) => list.length > 0, 8000)
    check(
      results,
      'delta 動作以 badge 標示',
      badges.includes('ADDED') && badges.includes('MODIFIED'),
      badges.join(', '),
    )

    const bdd = await app.client.evaluate(BDD_COLORS)
    check(
      results,
      'BDD 關鍵字於視覺上可區分',
      Boolean(bdd.when) && Boolean(bdd.then) && bdd.when !== bdd.then && bdd.when !== bdd.body,
      JSON.stringify(bdd),
    )

    // ── 變更推送（這個側欄存在的理由）────────────────────────────────────────
    console.log('\nagent 改檔 → 側欄自己更新')
    writeFileSync(join(single, 'openspec/changes/solo-change/tasks.md'), TASKS_DONE)
    const updated = await pollUntil(app.client, PROGRESS, (value) => value?.now === 2, 12_000)
    check(
      results,
      '外部改動 tasks 後進度自己更新',
      updated?.now === 2 && updated?.max === 3,
      JSON.stringify(updated),
    )

    // ── 瀏覽：兩棵樹 ───────────────────────────────────────────────────────
    console.log('\n瀏覽視圖：Specs / Changes 兩棵樹')
    check(results, '可切換至瀏覽視圖', (await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))) === true)
    const views = await pollUntil(app.client, VISIBLE_VIEWS, (list) => list.includes('browse'), 8000)
    check(results, '一次只顯示一個視圖', views.length === 1, views.join(', '))

    const topics = await pollUntil(app.client, SPEC_TREE_TOPICS, (list) => list.length > 0, 8000)
    check(
      results,
      'Specs 樹列出 topic 與相關 change 數',
      topics.length === 1 && topics[0].topic === 'core' && topics[0].text.includes('1'),
      topics.map((t) => t.text).join(' | '),
    )

    check(results, '可展開一個 spec topic', (await app.client.evaluate(EXPAND_TREE_ROW('core'))) === true)
    const headings = await pollUntil(app.client, SPEC_TREE_HEADINGS, (list) => list.length > 0, 10_000)
    check(
      results,
      '展開後以子節點呈現該 spec 的 heading',
      headings.includes('Purpose') && headings.includes('Requirements'),
      headings.join(', '),
    )

    const activeRows = await pollUntil(app.client, CHANGE_TREE_ROWS('Active'), (list) => list.length > 0, 8000)
    check(
      results,
      'Changes 樹依 Active / Archived 分組並標示進度',
      activeRows.length === 1 && activeRows[0].slug === 'solo-change' && activeRows[0].text.includes('2/3'),
      activeRows.map((r) => r.text).join(' | '),
    )

    check(results, '可檢視單一 spec 的內容', (await app.client.evaluate(ACTIVATE_TREE_ROW('core'))) === true)
    const specText = await pollUntil(app.client, SPEC_CONTENT, (text) => text.includes('core 的用途'), 8000)
    check(results, 'spec 的內容被呈現', specText.includes('core 的用途'))

    // ── 交叉導覽 ───────────────────────────────────────────────────────────
    console.log('\n交叉導覽')
    check(results, '自 spec 觸發「在 Files 中開啟」', (await app.client.evaluate(CLICK_OPEN_FILE('spec.md'))) === true)
    const switched = await pollUntil(app.client, IDENTITY, (value) => value === 'files', 8000)
    check(results, '跳至 Files 身分', switched === 'files')
    const openPath = await pollUntil(app.client, OPEN_FILE_PATH, (value) => value !== null, 8000)
    check(results, '開啟的是該 spec 的 .md 檔', openPath === 'openspec/specs/core/spec.md', String(openPath))

    check(results, '自檔案觸發「在 OpenSpec 中檢視」', (await app.client.evaluate(CLICK_VIEW_IN_OPENSPEC)) === true)
    const back = await pollUntil(app.client, IDENTITY, (value) => value === 'openspec', 8000)
    check(results, '跳回 OpenSpec 身分', back === 'openspec')
    const backSpec = await pollUntil(app.client, SPEC_CONTENT, (text) => text.includes('core'), 8000)
    check(results, '呈現對應的 spec', backSpec.includes('core'))

    // ── 全視窗 overlay：Graph ───────────────────────────────────────────────
    //
    // Graph 與 Timeline 來自 @spekjs/ui（與 spek web 同一份程式碼）。這裡驗的是**宿主的接線**：
    // overlay 真的蓋滿視窗、顏色契約真的接上、選一個 change 真的錨定。
    console.log('\n全視窗 overlay：Graph')

    // **對照組：這顆 `Ctrl+↓` 在沒有 overlay 時，真的切得動 repo。**
    //
    // 下面那條「overlay 開著時導航快捷鍵不生效」是一條**否定**斷言 —— 若這支探針送出的按鍵根本
    // 沒抵達 renderer（事件型別錯、修飾鍵沒帶上、焦點不對），repo 當然不會變，它照樣全綠。
    // **先證明這顆按鍵是活的，那條斷言才有意義。**（同 probe:terminal 的「沒有對話框」與「清空
    // 名稱後標籤立即改變」那一對。）
    const folderBase = await app.client.evaluate(SELECTED_FOLDER)
    await pressCtrlArrowDown(app.client)
    const folderSwitched = await pollUntil(
      app.client,
      SELECTED_FOLDER,
      (value) => value !== folderBase,
      4000,
    )
    check(
      results,
      'Ctrl+↓ 在無 overlay 時確實切換 repo（下方抑制斷言的對照組）',
      folderSwitched !== folderBase,
      `${folderBase} → ${folderSwitched}`,
    )

    // 切回來 —— 後面的斷言都以 repo-single 為準。
    await app.client.evaluate(SELECT_FOLDER('repo-single'))
    await pollUntil(app.client, SELECTED_FOLDER, (value) => value?.includes('repo-single'), 6000)

    check(results, '自側欄開啟 Graph', (await app.client.evaluate(CLICK_OPEN_VIZ('Graph'))) === true)
    const graphOverlay = await pollUntil(app.client, OVERLAY, (value) => value !== null, 10_000)
    check(results, 'Graph 於 overlay 中呈現', graphOverlay?.label === copy('viz.graph'), JSON.stringify(graphOverlay))
    check(
      results,
      'overlay 覆蓋整個視窗',
      graphOverlay?.coversViewport === true,
      `${graphOverlay?.width}x${graphOverlay?.height}`,
    )

    const graph = await pollUntil(app.client, GRAPH_NODES, (value) => value && value.edges > 0, 12_000)
    check(
      results,
      'Graph 畫出 spec 與 change 的節點與邊',
      graph?.circles >= 1 && graph?.rects >= 1 && graph?.edges >= 1,
      `spec圓=${graph?.circles} change方=${graph?.rects} 邊=${graph?.edges}`,
    )

    // 顏色契約：套件的變數必須解析到**我們的**主題色。少了這道對應，圖畫得出來但沒有顏色。
    const themeVars = await app.client.evaluate(SPEK_THEME_VARS)
    check(
      results,
      '@spekjs/ui 的顏色契約接到我們的主題色',
      Boolean(themeVars.accent) && themeVars.accent === themeVars.ours,
      JSON.stringify(themeVars),
    )

    // ── overlay 開著時，導航快捷鍵必須讓位（session-title-authority 的 design D4）
    //
    // overlay 蓋滿整個視窗 —— 這時候按 `Ctrl+↓` 切到別的 repo，切了也看不見，而使用者關掉
    // overlay 之後會發現自己莫名其妙站在另一個 repo 上。抑制是以 `[role="dialog"]` 的存在判定
    // 的（與對話框的身分無關），overlay 帶著那個角色，因此**理應**已被涵蓋 —— 但在此之前**從未
    // 被驗證過**。
    //
    // **這條是本 change 的淨得。** 它取代了原本以「pty 標題衝突對話框」為載體的那條抑制驗收
    //（該對話框已移除）。三種載體（session 命名、files 的對話框、這個 overlay）必須各驗一次：
    // 抑制邏輯的失效模式不是判定寫錯，而是**某個對話框漏了 role="dialog"，於是靜默地不被尊重**
    // —— 只驗一種就宣稱涵蓋，等於沒驗。
    //
    // fixture 有四個 folder，因此「folder 沒變」不是一條恆真的斷言 —— 快捷鍵若真的生效了，它
    // **有地方可去**。而「這顆按鍵本身是活的」則由上面的對照組證明。
    const folderBeforeKey = await app.client.evaluate(SELECTED_FOLDER)
    await pressCtrlArrowDown(app.client)
    await sleep(500)
    const folderAfterKey = await app.client.evaluate(SELECTED_FOLDER)
    const overlayAfterKey = await app.client.evaluate(OVERLAY)
    check(
      results,
      'overlay 開啟時，導航快捷鍵不生效（overlay 仍開著、repo 未被切走）',
      folderAfterKey === folderBeforeKey && overlayAfterKey !== null,
      `repo：${folderBeforeKey} → ${folderAfterKey}；overlay=${overlayAfterKey?.label ?? 'null'}`,
    )

    // 力導向圖是動的 —— 等它停下來再量節點位置。
    const nodeRect = await pollUntil(
      app.client,
      GRAPH_NODE_RECT('change:solo-change'),
      (value) => value !== null,
      15_000,
    )
    check(results, 'Graph 上找得到該 change 的節點', nodeRect !== null, JSON.stringify(nodeRect))

    await sleep(1500) // simulation 收斂後還有一段 fit-to-viewport 的 transition
    const settled = await app.client.evaluate(GRAPH_NODE_RECT('change:solo-change'))
    await realClick(app.client, settled ?? nodeRect)
    const afterGraphClick = await pollUntil(app.client, OVERLAY, (value) => value === null, 8000)
    check(results, '於 Graph 觸發 change 節點後 overlay 關閉', afterGraphClick === null)
    //
    // **必須輪詢，不能 evaluate 一次就斷言。** 換一個 change 會把側欄的資料清掉、短暫回到
    // 「載入中…」（key 變了就不沿用上一份 —— 否則會有一瞬間顯示上一個 change，那比 loading
    // 更糟）。錨定其實已經成立（麵包屑與視圖都對了），只是 `h2` 還沒渲染出來 —— 讀一次會讀到
    // null。實測：這條會隨時序時綠時紅。
    const anchoredByGraph = await pollUntil(
      app.client,
      ANCHORED_SLUG,
      (value) => value === 'solo-change',
      8000,
    )
    check(
      results,
      '該 change 成為側欄呈現的 change',
      anchoredByGraph === 'solo-change',
      String(anchoredByGraph),
    )

    // ── 全視窗 overlay：Timeline ────────────────────────────────────────────
    console.log('\n全視窗 overlay：Timeline')
    check(results, '自側欄開啟 Timeline', (await app.client.evaluate(CLICK_OPEN_VIZ('Timeline'))) === true)
    const timelineOverlay = await pollUntil(app.client, OVERLAY, (value) => value !== null, 10_000)
    check(
      results,
      'Timeline 於 overlay 中呈現',
      timelineOverlay?.label === 'Timeline',
      JSON.stringify(timelineOverlay),
    )

    const timeline = await pollUntil(app.client, TIMELINE, (value) => value !== null, 12_000)
    check(
      results,
      'change 的生命週期以時間軸上的橫條呈現',
      timeline?.bars >= 1 && timeline?.labels.some((l) => l.includes('solo-change')),
      `bars=${timeline?.bars} arrows=${timeline?.arrows} labels=${timeline?.labels.join(',')}`,
    )
    // active 的 change 延伸到 today 並在右端畫一個三角箭頭 —— 這是 Gantt，不是關聯圖。
    check(results, 'active 的 change 以箭頭延伸至今天', timeline?.arrows >= 1, `${timeline?.arrows} 個箭頭`)

    await pressEscape(app.client)
    const closed = await pollUntil(app.client, OVERLAY, (value) => value === null, 8000)
    check(results, '以 Esc 關閉 overlay', closed === null)

    // ── 多個 active change：不猜 ────────────────────────────────────────────
    console.log('\n多個 active change：不猜')
    await app.client.evaluate(SELECT_FOLDER('repo-many'))
    await pollUntil(app.client, IDENTITY, (value) => value === 'openspec', 8000)
    await createSession(app.client)

    const emptyText = await pollUntil(app.client, CHANGE_EMPTY_TEXT, (value) => value !== null, 10_000)
    check(
      results,
      '多個 active change 時不自動錨定',
      typeof emptyText === 'string' && emptyText.includes(copy('openspec.noAnchoredChange')),
      String(emptyText).split('\n').filter(Boolean)[0],
    )
    check(
      results,
      '空狀態提供前往選擇 change 的引導',
      String(emptyText).includes(copy('openspec.goToChanges')),
    )

    // ── 於瀏覽視圖建立錨定 ──────────────────────────────────────────────────
    console.log('\n於瀏覽視圖建立錨定')
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const manyActive = await pollUntil(app.client, CHANGE_TREE_ROWS('Active'), (list) => list.length === 2, 8000)
    check(
      results,
      'Changes 樹列出兩個 active change 與進度',
      manyActive.some((r) => r.slug === 'add-oauth' && r.text.includes('1/3')),
      manyActive.map((r) => r.text).join(' | '),
    )
    // Archived 群組預設收合（archive 會愈長愈大，攤開會把 active 擠出視野）—— 先展開它。
    await app.client.evaluate(ACTIVATE_TREE_ROW('Archived'))
    const manyArchived = await pollUntil(
      app.client,
      CHANGE_TREE_ROWS('Archived'),
      (list) => list.length > 0,
      8000,
    )
    check(
      results,
      'active 與 archived 可區分',
      manyArchived.length === 1 && manyArchived[0].slug === '2026-01-01-legacy-login',
      manyArchived.map((r) => r.slug).join(', '),
    )

    check(results, '觸發一個 change 即錨定', (await app.client.evaluate(ACTIVATE_TREE_ROW('add-oauth'))) === true)
    const nowAnchored = await pollUntil(app.client, ANCHORED_SLUG, (value) => value === 'add-oauth', 8000)
    check(results, '錨定後切至本 change 視圖', nowAnchored === 'add-oauth')

    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const marked = await pollUntil(
      app.client,
      CHANGE_TREE_ROWS('Active'),
      (list) => list.some((r) => r.anchored),
      8000,
    )
    check(
      results,
      '錨定的 change 節點被標示',
      marked.find((r) => r.anchored)?.slug === 'add-oauth',
      marked.filter((r) => r.anchored).map((r) => r.slug).join(', '),
    )

    // ── 錨定為 per-session，側欄跟隨 focused session ────────────────────────
    //
    // **第二個 session 用 claude 目標**：後面「錨定不隨 pty 的輸出改變」要在它身上驗「標題
    // 真的變了、而錨定沒有跟著變」—— 而 login shell 已不再採用 pty 宣告的標題，那個前提在
    // shell session 上永遠不成立（見 `makeStubClaude`）。
    console.log('\n側欄跟隨 focused session 的錨定')
    await createSession(app.client, 'claude')
    const twoTabs = await pollUntil(app.client, SESSION_TABS, (list) => list.length === 2, 10_000)
    check(results, '該 folder 有兩個 session', twoTabs.length === 2)

    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    await pollUntil(app.client, CHANGE_TREE_ROWS('Active'), (list) => list.length > 0, 8000)
    await app.client.evaluate(ACTIVATE_TREE_ROW('add-invoice'))
    const second = await pollUntil(app.client, ANCHORED_SLUG, (value) => value === 'add-invoice', 8000)
    check(results, '第二個 session 錨定另一個 change', second === 'add-invoice')

    check(results, '切回第一個 session', (await app.client.evaluate(FOCUS_SESSION_TAB(0))) === true)
    const followed = await pollUntil(app.client, ANCHORED_SLUG, (value) => value === 'add-oauth', 8000)
    check(results, '側欄隨 focused session 呈現其錨定的 change', followed === 'add-oauth', String(followed))

    check(results, '切到第二個 session', (await app.client.evaluate(FOCUS_SESSION_TAB(1))) === true)
    const followedBack = await pollUntil(app.client, ANCHORED_SLUG, (value) => value === 'add-invoice', 8000)
    check(results, '不同 session 各自保有其錨定', followedBack === 'add-invoice', String(followedBack))

    // ── 錨定不隨 pty 的輸出改變 ─────────────────────────────────────────────
    //
    // 斷言必須**成對**：標題真的變了（證明 pty 的輸出確實被處理了，測試不是空轉），
    // 而錨定**沒有**跟著變。
    console.log('\n錨定不隨 pty 的輸出改變')
    const termRect = await pollUntil(app.client, TERMINAL_RECT, (value) => value !== null, 8000)
    await realClick(app.client, termRect)
    // 後面接 sleep 是必要的：shell 每畫一次 prompt 就會把標題設回去，不留窗口就輪詢不到。
    await typeLine(app.client, "printf '\\033]0;add-oauth\\007'; sleep 4")

    const titled = await pollUntil(
      app.client,
      SESSION_TABS,
      (list) => list.some((t) => t.label === 'add-oauth'),
      10_000,
    )
    check(
      results,
      'pty 宣告的標題確實抵達（否則此測試空轉）',
      titled.some((t) => t.label === 'add-oauth'),
      titled.map((t) => t.label).join(', '),
    )
    check(
      results,
      '錨定不隨 pty 的輸出改變',
      (await app.client.evaluate(ANCHORED_SLUG)) === 'add-invoice',
    )

    // ── 只有 archived change 的 repo：降級到正確的層級 ──────────────────────
    console.log('\n只有 archived change 的 repo')
    await app.client.evaluate(SELECT_FOLDER('repo-archived-only'))
    const archivedIdentity = await pollUntil(app.client, IDENTITY, (value) => value !== null, 8000)
    check(results, '只有 archived change 時 OpenSpec 身分仍可用', archivedIdentity === 'openspec')

    await createSession(app.client)
    const noAnchor = await pollUntil(app.client, CHANGE_EMPTY_TEXT, (value) => value !== null, 10_000)
    check(
      results,
      '沒有 active change 時無錨定',
      typeof noAnchor === 'string' && noAnchor.includes(copy('openspec.noAnchoredChange')),
      String(noAnchor).split('\n').filter(Boolean)[0],
    )

    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const legacyTopics = await pollUntil(app.client, SPEC_TREE_TOPICS, (list) => list.length > 0, 8000)
    check(
      results,
      '空狀態不影響瀏覽視圖的 Specs 樹',
      legacyTopics.some((t) => t.topic === 'legacy'),
      legacyTopics.map((t) => t.topic).join(', '),
    )
    await app.client.evaluate(ACTIVATE_TREE_ROW('Archived'))
    const onlyArchived = await pollUntil(app.client, CHANGE_TREE_ROWS('Archived'), (list) => list.length > 0, 8000)
    check(
      results,
      '空狀態不影響瀏覽視圖的 Changes 樹',
      onlyArchived.length === 1 && onlyArchived[0].slug === '2026-01-01-done-change',
      onlyArchived.map((r) => r.slug).join(', '),
    )

    // ── 交叉導覽不丟失未存的編輯 ────────────────────────────────────────────
    //
    // 切換身分是一條**新的卸載路徑**：顯示 OpenSpec 時 FilesPanel 整個不存在。
    console.log('\n未存的編輯跨身分存活')
    await app.client.evaluate(SELECT_FOLDER('repo-single'))
    await app.client.evaluate(CLICK_IDENTITY('▤'))
    await pollUntil(app.client, TREE_ROWS, (paths) => paths.includes('notes.txt'), 8000)
    await app.client.evaluate(CLICK_ROW('notes.txt'))
    await pollUntil(app.client, EDITOR_TEXT, (text) => Boolean(text), 10_000)

    await app.client.evaluate(FOCUS_EDITOR)
    await app.client.send('Input.insertText', { text: 'EDIT ' })
    const edited = await pollUntil(app.client, EDITOR_TEXT, (text) => /EDIT /.test(text ?? ''), 8000)
    check(results, '在 Files 身分中產生未存的編輯', /EDIT /.test(edited ?? ''))

    await app.client.evaluate(CLICK_IDENTITY('◈'))
    await pollUntil(app.client, IDENTITY, (value) => value === 'openspec', 8000)
    await app.client.evaluate(CLICK_IDENTITY('▤'))
    await pollUntil(app.client, IDENTITY, (value) => value === 'files', 8000)

    const stillDirty = await pollUntil(app.client, ROW_IS_DIRTY('notes.txt'), (value) => value === true, 8000)
    check(results, '切到 OpenSpec 再切回，未存的變更仍被標記', stillDirty === true)

    await app.client.evaluate(CLICK_ROW('notes.txt'))
    const restored = await pollUntil(app.client, EDITOR_TEXT, (text) => Boolean(text), 10_000)
    check(
      results,
      '重新開啟該檔，未存的編輯內容仍在',
      /EDIT /.test(restored ?? ''),
      (restored ?? '').split('\n')[0],
    )

    // ── 不含 openspec 的 folder ─────────────────────────────────────────────
    console.log('\n不含 openspec 的 folder')
    await app.client.evaluate(SELECT_FOLDER('repo-plain'))
    const plainIdentity = await pollUntil(app.client, IDENTITY, (value) => value === 'files', 8000)
    check(results, '不含 openspec 的 folder 退回 Files 身分', plainIdentity === 'files')

    // ── 重新載入不摧毀側欄的更新能力 ────────────────────────────────────────
    //
    // **必須用 CDP 的 `Page.reload`** —— 頁面裡的 `location.reload()` 是頁面發起的導航，
    // 會被 app 自己的 `will-navigate` 防護擋掉，頁面根本不會重新載入。
    // 前一段把身分切成了 Files，reload 會把它重置回預設的 OpenSpec —— 那正是「真的 reload 過了」
    // 的證據。
    console.log('\n重新載入之後，側欄仍隨檔案變更更新')
    await app.client.send('Page.reload', {})
    await sleep(1500)
    await pollUntil(app.client, MOUNTED, (value) => value === true, 20_000)

    await pollUntil(app.client, SELECT_FOLDER('repo-single'), (value) => value === true, 15_000)
    const reloadedIdentity = await pollUntil(app.client, IDENTITY, (value) => value === 'openspec', 10_000)
    check(
      results,
      '重新載入確實發生（身分回到預設的 OpenSpec）',
      reloadedIdentity === 'openspec',
      String(reloadedIdentity),
    )

    // reload 清光了 session，但衍生的預設錨定讓「本 change」照樣有東西 —— 不必再建 session。
    const afterReload = await pollUntil(app.client, PROGRESS, (value) => value?.now === 2, 15_000)
    check(
      results,
      '重新載入後仍能取得 OpenSpec 資料',
      afterReload?.now === 2 && afterReload?.max === 3,
      JSON.stringify(afterReload),
    )

    writeFileSync(join(single, 'openspec/changes/solo-change/tasks.md'), TASKS_ALL_DONE)
    const liveAfterReload = await pollUntil(app.client, PROGRESS, (value) => value?.now === 3, 12_000)
    check(
      results,
      '重新載入後，agent 改檔側欄仍自己更新（watcher 未成孤兒）',
      liveAfterReload?.now === 3,
      JSON.stringify(liveAfterReload),
    )

    // ── 側欄來源可與 rail focus 解耦（side-panel-source）─────────────────────
    //
    // agent 在一個 session 裡跨 repo 工作時（claude 自己 cd、或拿絕對路徑改別的 repo），側欄要能
    // 指到另一個 repo，而**不切走正在跑的 session**。側欄來源是 per-session（focused session 的
    // 屬性），切換來源時重置錨定（change 的 slug 隸屬於某個 repo）。
    //
    // **放在最後** —— 它會把 repo-single 的 session 來源指到別處，不宜污染前面的測試。
    console.log('\n側欄來源可與 rail focus 解耦')
    await pollUntil(app.client, SELECT_FOLDER('repo-single'), (v) => v === true, 8000)
    await pollUntil(app.client, IDENTITY, (v) => v === 'openspec', 8000)
    await createSession(app.client)

    const ownAnchor = await pollUntil(app.client, ANCHORED_SLUG, (v) => v === 'solo-change', 10_000)
    check(results, '側欄預設呈現 session 自己的 repo', ownAnchor === 'solo-change', String(ownAnchor))
    // 一次 evaluate 存起來 —— 來源列的 innerText 是 `▸\n<name>\n▾`（三個 span），兩次 evaluate
    // 可能拿到不同幀。
    const srcLabel = String(await app.client.evaluate(PANEL_SOURCE_LABEL))
    check(results, '來源列標示側欄來源為 repo-single', srcLabel.includes('repo-single'), srcLabel)
    check(
      results,
      '來源即自身時不顯示「回到自身」捷徑',
      (await app.client.evaluate(HAS_BACK_TO_OWN)) === false,
    )

    // 開來源列下拉，把側欄來源改到 repo-many
    const srcBtn = await stableRect(app.client, PANEL_SOURCE_RECT)
    check(results, '來源列有可操作的來源指示器', srcBtn !== null)
    await realClick(app.client, srcBtn)
    const manyItem = await pollUntil(app.client, MENU_ITEM_RECT('repo-many'), (v) => v !== null, 3000)
    check(results, '下拉列出其他 folder 作為候選來源', manyItem !== null)
    await realClick(app.client, manyItem)

    // repo-many 有兩個 active change → 切來源後錨定重置 → 空狀態
    const resetEmpty = await pollUntil(app.client, CHANGE_EMPTY_TEXT, (v) => v !== null, 10_000)
    check(
      results,
      '切換側欄來源後錨定被重置（repo-many 無自動錨定 → 空狀態）',
      typeof resetEmpty === 'string' && resetEmpty.includes(copy('openspec.noAnchoredChange')),
      String(resetEmpty).split('\n').filter(Boolean)[0],
    )

    // terminal 那半不受影響：分頁列仍是 repo-single 的那個 session
    const tabsIntact = await app.client.evaluate(SESSION_TABS)
    check(
      results,
      '側欄跨 repo 時 terminal 分頁不受影響',
      Array.isArray(tabsIntact) && tabsIntact.length === 1,
      JSON.stringify(tabsIntact),
    )

    // 瀏覽視圖呈現的是 repo-many 的 change
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const foreignActive = await pollUntil(app.client, CHANGE_TREE_ROWS('Active'), (l) => l.length === 2, 8000)
    check(
      results,
      '側欄改指向 repo-many：瀏覽視圖呈現它的 change',
      foreignActive.some((r) => r.slug === 'add-oauth') && foreignActive.some((r) => r.slug === 'add-invoice'),
      foreignActive.map((r) => r.slug).join(', '),
    )

    // 「回到自身」捷徑出現，點它回到 repo-single
    check(
      results,
      '來源非自身時顯示「回到自身」捷徑',
      (await app.client.evaluate(HAS_BACK_TO_OWN)) === true,
    )
    await realClick(app.client, await stableRect(app.client, BACK_TO_OWN_RECT))
    const backHome = await pollUntil(app.client, ANCHORED_SLUG, (v) => v === 'solo-change', 8000)
    check(results, '「回到自身」把側欄帶回 session 自己的 repo', backHome === 'solo-change', String(backHome))

    // 側欄來源為 per-session：第二個 session 指到 repo-many，切 session 側欄來源跟著走
    await createSession(app.client)
    await realClick(app.client, await stableRect(app.client, PANEL_SOURCE_RECT))
    await realClick(app.client, await pollUntil(app.client, MENU_ITEM_RECT('repo-many'), (v) => v !== null, 3000))
    await pollUntil(app.client, CHANGE_EMPTY_TEXT, (v) => v !== null, 10_000)

    check(results, '切回第一個 session', (await app.client.evaluate(FOCUS_SESSION_TAB(0))) === true)
    const s1 = await pollUntil(app.client, ANCHORED_SLUG, (v) => v === 'solo-change', 8000)
    check(results, '每個 session 各自保有側欄來源（session 1 仍為 repo-single）', s1 === 'solo-change', String(s1))

    check(results, '切到第二個 session', (await app.client.evaluate(FOCUS_SESSION_TAB(1))) === true)
    const s2 = await pollUntil(app.client, PANEL_SOURCE_LABEL, (v) => String(v).includes('repo-many'), 8000)
    check(results, '側欄來源跟隨 focused session（session 2 為 repo-many）', String(s2).includes('repo-many'), String(s2))

    // OpenSpec 與 Files 共用同一側欄來源：切 Files，樹是 repo-many 的（有 openspec、無 notes.txt）
    await app.client.evaluate(CLICK_IDENTITY('▤'))
    const foreignTree = await pollUntil(app.client, TREE_ROWS, (paths) => paths.includes('openspec'), 8000)
    check(
      results,
      'OpenSpec 與 Files 共用側欄來源（Files 呈現 repo-many 的樹）',
      foreignTree.includes('openspec') && !foreignTree.includes('notes.txt'),
      foreignTree.join(', '),
    )

    // ── 側欄來源跨重建還原（session-persistence）────────────────────────────
    //
    // reload 走與「關 app 重開」**同一條** persist→restore 落盤路徑（sessions.json）。此刻
    // session 1 的來源是自身 repo-single、session 2 指向 repo-many —— 重建後兩者都該原樣回來。
    await app.client.send('Page.reload', {})
    await sleep(1500)
    await pollUntil(app.client, MOUNTED, (v) => v === true, 20_000)
    await pollUntil(app.client, SELECT_FOLDER('repo-single'), (v) => v === true, 15_000)
    await pollUntil(app.client, IDENTITY, (v) => v === 'openspec', 10_000)
    const rebuiltTabs = await pollUntil(app.client, SESSION_TABS, (l) => l.length === 2, 15_000)
    check(results, '重新載入後兩個 session 原樣重建', rebuiltTabs.length === 2, JSON.stringify(rebuiltTabs))

    await app.client.evaluate(FOCUS_SESSION_TAB(1))
    const restoredForeign = await pollUntil(
      app.client,
      PANEL_SOURCE_LABEL,
      (v) => String(v).includes('repo-many'),
      10_000,
    )
    check(
      results,
      '側欄來源跨重建還原（session 2 仍指向 repo-many）',
      String(restoredForeign).includes('repo-many'),
      String(restoredForeign),
    )

    await app.client.evaluate(FOCUS_SESSION_TAB(0))
    const restoredOwn = await pollUntil(app.client, ANCHORED_SLUG, (v) => v === 'solo-change', 10_000)
    check(
      results,
      '側欄來源跨重建還原（session 1 仍指向自身 repo）',
      restoredOwn === 'solo-change',
      String(restoredOwn),
    )
  } finally {
    await app.close()
  }
}

async function main() {
  let devServer = null

  try {
    await runMode('正式建置（electron .）', { port: BUILD_PORT, rendererUrl: null })

    devServer = await startRendererDevServer()
    await runMode('開發模式（vite dev server）', { port: DEV_PORT, rendererUrl: devServer.url })
  } finally {
    if (devServer) {
      // dev server 是 group leader（detached）—— 殺整組，否則 vite 會變孤兒佔著 port。
      try {
        process.kill(-devServer.child.pid, 'SIGKILL')
      } catch {
        // 已經沒了。
      }
    }
    for (const dir of temps) rmSync(dir, { recursive: true, force: true })
  }

  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} 通過`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
