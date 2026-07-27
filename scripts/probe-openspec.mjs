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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, pollUntil, waitForPageTarget } from './lib/cdp.mjs'
import { copy, prefixOf, suffixOf } from './lib/copy.mjs'
import { electronExtraArgs } from './lib/display.mjs'

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
 * 一個**真的** git repo 與兩個 linked worktree。
 *
 * **只有這一組 fixture 需要 git**：聚合掃描是靠 `git worktree list` 列舉工作目錄的，手寫
 * `.git` 檔案騙不過它。其餘 fixture 一律不 spawn git（那會讓探針依賴機器狀態）。
 *
 * 三個 change 是刻意的對照組：
 *
 * | change | 位置 | 驗什麼 |
 * |---|---|---|
 * | `main-change` | 主工作目錄，artifact 齊備 | **不**標示來源；也不呈現續寫入口 |
 * | `inside-change` | 邊界**內**的 worktree（`.claude/worktrees/`） | 標示 `feat-inside`；續寫入口停用；檔案導覽入口**有** |
 * | `outside-change` | 邊界**外**的 worktree | 標示 `feat-outside`；檔案導覽入口**沒有** |
 *
 * 兩個 worktree 的 change 都**不 commit** —— 掃描讀的是檔案系統。而「只存在於一處的 slug 本來
 * 就會勝出」，所以不必刻意造 git 分歧。
 */
function makeWorktreeFixture() {
  const base = mkTemp('spekterm-openspec-worktree-')
  const repo = join(base, 'repo-worktree')
  const inside = join(repo, '.claude/worktrees/wt-inside')
  const outside = join(base, 'wt-outside')

  const git = (args, cwd) =>
    execFileSync(
      'git',
      ['-c', 'user.email=probe@spekterm', '-c', 'user.name=probe', '-c', 'color.ui=false', ...args],
      { cwd, stdio: 'pipe' },
    )

  writeFile(join(repo, 'openspec/config.yaml'), 'schema: spec-driven\n')
  writeFile(join(repo, 'openspec/specs/auth/spec.md'), SPEC('auth'))
  changeMeta(join(repo, 'openspec/changes/main-change'), '2026-05-02')
  writeFile(join(repo, 'openspec/changes/main-change/proposal.md'), '# 主工作目錄的 change\n')
  writeFile(join(repo, 'openspec/changes/main-change/design.md'), '# design\n')
  writeFile(join(repo, 'openspec/changes/main-change/tasks.md'), TASKS)
  writeFile(join(repo, 'openspec/changes/main-change/specs/auth/spec.md'), DELTA)

  // **反面 fixture：結構與 OpenSpec 完全相同，但不在任何工作目錄的 `openspec/` 底下。**
  //
  // 路徑必須帶 `changes/` 那一層。`docs/openspec/notes.md` 這種「只差一層」的誘餌**沒有
  // 鑑別力** —— 鬆綁版判準（找第一個等於 `openspec` 的分段）對它也回 null，因為 `openspec`
  // 之後只剩一段，既非 `specs` 亦非 `changes`。已實測，見 design D4。
  //
  // 寫在 commit 之前 ⇒ worktree 裡也有一份，於是「worktree 內的 docs」那條也驗得到。
  writeFile(join(repo, 'docs/openspec/changes/decoy/proposal.md'), '# 這不是 OpenSpec artifact\n')

  git(['init', '-q', '--initial-branch=master', '.'], repo)
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'init'], repo)

  git(['worktree', 'add', '-q', '-b', 'feat-inside', '.claude/worktrees/wt-inside'], repo)
  changeMeta(join(inside, 'openspec/changes/inside-change'), '2026-05-12')
  writeFile(join(inside, 'openspec/changes/inside-change/proposal.md'), '# 邊界內 worktree 的 change\n')
  // 有 delta 才有 spec ↔ change 的邊 —— Timeline 的「依 topic 分組」需要它。
  writeFile(join(inside, 'openspec/changes/inside-change/specs/auth/spec.md'), DELTA)

  git(['worktree', 'add', '-q', '-b', 'feat-outside', outside], repo)
  changeMeta(join(outside, 'openspec/changes/outside-change'), '2026-05-22')
  writeFile(join(outside, 'openspec/changes/outside-change/proposal.md'), '# 邊界外 worktree 的 change\n')

  return { repo, inside, outside }
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
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...electronExtraArgs(), '.'],
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

const HAS_OPEN_SESSION_HERE = `Boolean(
  document.querySelector('button[aria-label="${copy('openspec.openSessionHere')}"]')
)`

const CLICK_OPEN_SESSION_HERE = `(() => {
  const btn = document.querySelector('button[aria-label="${copy('openspec.openSessionHere')}"]')
  if (!btn) return false
  btn.click()
  return true
})()`

const HAS_VIEW_IN_OPENSPEC = `Boolean(
  document.querySelector('button[aria-label="${copy('files.viewInOpenSpec')}"]')
)`

/** Files 身分：當前開啟檔案的路徑（breadcrumb 的最後一段）。 */
const OPEN_FILE_PATH = `(() => {
  const nav = document.querySelector('section[aria-label="${copy('files.label')}"] nav[aria-label="${copy('files.pathNav')}"]')
  if (!nav) return null
  const last = nav.querySelector('span[title]')
  return last ? last.getAttribute('title') : null
})()`

/**
 * Files 身分：麵包屑最後一段**呈現的文字**。
 *
 * 與 `OPEN_FILE_PATH`（讀 `title`）成對 —— 兩者刻意不同：`title` 是完整的 folder-relative
 * 路徑（它同時是本檔案其餘助手的選擇器），而呈現的文字剝掉了樹根前綴。**兩條一起驗，才證明
 * 得了「兩種座標系各自正確」**；只驗一邊的話，把顯示也留成完整路徑（或把 title 也剝掉）都會通過。
 */
const OPEN_FILE_DISPLAY = `(() => {
  const nav = document.querySelector('section[aria-label="${copy('files.label')}"] nav[aria-label="${copy('files.pathNav')}"]')
  const last = nav?.querySelector('span[title]')
  return last ? last.innerText.trim() : null
})()`

// ── Files 的工作目錄選擇器（side-panel-worktree）──────────────────────────

const WORKTREE_BUTTON = `section[aria-label="${copy('files.label')}"] button[aria-label="${copy('files.worktree.change')}"]`

/** 選擇器當前的標籤；**不呈現時為 null**（工作目錄恰有一個）。 */
const WORKTREE_PICKER = `(() => {
  const btn = document.querySelector('${WORKTREE_BUTTON}')
  return btn ? btn.innerText.trim() : null
})()`

const CLICK_WORKTREE_PICKER = `(() => {
  const btn = document.querySelector('${WORKTREE_BUTTON}')
  if (!btn || btn.disabled) return false
  btn.click()
  return true
})()`

/** 下拉的項目。停用者的 `innerText` 含說明，故比對一律用前綴。 */
const WORKTREE_MENU = `[...document.querySelectorAll('[role="menu"] button[role="menuitem"]')]
  .map((b) => ({ label: b.innerText.trim().split('\\n')[0], disabled: b.disabled }))`

const CLICK_WORKTREE_ITEM = (label) => `(() => {
  const item = [...document.querySelectorAll('[role="menu"] button[role="menuitem"]')]
    .find((b) => b.innerText.trim().startsWith(${JSON.stringify(label)}))
  if (!item || item.disabled) return false
  item.click()
  return true
})()`

const SESSION_TABS = `[...document.querySelectorAll('[role="tablist"][aria-label="${copy('sessions.tabs')}"] button[role="tab"]')]
  .map((t) => ({ label: t.innerText.trim(), selected: t.getAttribute('aria-selected') === 'true' }))`

// ── Files 身分的檔案樹（驗未存的編輯跨身分存活）──────────────────────────
//
// **必須限定在 Files 之內** —— 瀏覽視圖的兩棵樹也是 `[role="treeitem"]`。

const FILES_TREE = `section[aria-label="${copy('files.label')}"] [role="treeitem"]`

const TREE_ROWS = `[...document.querySelectorAll('${FILES_TREE}')].map((r) => r.getAttribute('title'))`

/** 某一列在不在（`title` 是完整的 folder-relative 路徑）。 */
const FILES_HAS_ROW = (relPath) => `Boolean(
  document.querySelector('${FILES_TREE}[title=${JSON.stringify(relPath)}]')
)`

/** 某一列的展開狀態：`'true'` / `'false'`（目錄）、`null`（檔案或不存在）。 */
const FILES_ROW_EXPANDED = (relPath) => `(() => {
  const row = document.querySelector('${FILES_TREE}[title=${JSON.stringify(relPath)}]')
  return row ? row.getAttribute('aria-expanded') : null
})()`

/** 點一列：目錄＝展開／收合，檔案＝開啟。 */
const FILES_CLICK_ROW = (relPath) => `(() => {
  const row = document.querySelector('${FILES_TREE}[title=${JSON.stringify(relPath)}]')
  if (!row) return false
  row.click()
  return true
})()`

/**
 * breadcrumb 上的 `files` —— 關掉當前檔案、回到樹（檢視器與樹是互斥渲染的）。
 *
 * **以 `aria-label` 指名，不能取「nav 裡的第一個 button」** —— 麵包屑中段還有一顆工作目錄
 * 選擇器（`side-panel-worktree`），而它排在這一顆之前。取第一個會點開那個下拉，然後這裡的
 * 導航靜默不發生，其後的斷言驗的是上一個狀態。
 */
const CLICK_BREADCRUMB_ROOT = `(() => {
  const btn = document.querySelector(
    'section[aria-label="${copy('files.label')}"] button[aria-label="${copy('files.backToTree')}"]',
  )
  if (!btn) return false
  btn.click()
  return true
})()`

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

/**
 * 續寫入口（`artifact-continuation`）。回傳 `null` 代表整個入口沒有呈現。
 *
 * 讀按鈕**與其相鄰的說明文字**：入口不可用時要「停用並說明原因」，只驗 `disabled` 驗不到說明。
 */
const CONTINUE_ENTRY = `(() => {
  const btn = document.querySelector('[aria-label="${copy('openspec.continueArtifact')}"]')
  if (!btn) return null
  return { disabled: btn.disabled === true, text: btn.parentElement?.textContent ?? '' }
})()`

const HAS_BACK_TO_OWN = `Boolean(document.querySelector('[aria-label="${copy('panelSource.backToOwn')}"]'))`

/** Timeline 的分組標題（`.spekui-timeline-section` 的 title；套件內部的 class，不歸字典管）。 */
const TIMELINE_SECTIONS = `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return null
  return [...dialog.querySelectorAll('.spekui-timeline-section')].map((el) => el.getAttribute('title'))
})()`

/** overlay 的關閉按鈕。 */
const CLICK_VIZ_CLOSE = `(() => {
  const btn = document.querySelector('[role="dialog"] [aria-label="${copy('viz.close')}"]')
  if (!btn) return false
  btn.click()
  return true
})()`

/** 點 overlay 裡的一顆 chip（group by topic 之類）—— 以可見文字定位。 */
const CLICK_VIZ_CHIP = (label) => `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const btn = [...(dialog?.querySelectorAll('button') ?? [])]
    .find((b) => b.textContent?.trim() === ${JSON.stringify(label)})
  if (!btn) return false
  btn.click()
  return true
})()`

/** 當前呈現的 artifact 有沒有「在 Files 中開啟」的入口（邊界外的來源翻不出 relPath ⇒ 沒有）。 */
const HAS_OPEN_IN_FILES = `Boolean(
  document.querySelector('button[aria-label$="${suffixOf('openspec.openInFiles')}"]')
)`

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

/**
 * 在瀏覽視圖點一列 change，並確認錨定**真的**切過去了。
 *
 * **點一次就斷言是在賭**：側欄會因為建立 session、掃描回來等事件重繪，`pollUntil` 看到那一列
 * 之後、點下去之前的窗口裡它可能已經被換掉。實測是一支在 build 與 dev 之間**跳動**的 flaky
 * （第二輪 dev 綠 build 紅、第三輪反過來）—— 與 `createSession` 對付選單的是同一種競態，
 * 因此用同一種解法：點完確認結果，沒生效就重來。
 *
 * 三次都沒成功才回傳當下的實際值，讓呼叫端的斷言紅得有話可說（鑑別力不因重試而消失）。
 */
/**
 * 於 Files 身分沿著路徑逐層展開，最後開啟該檔案。
 *
 * 檔案樹是 **lazy load** 的（展開一層才去列它的內容），所以每一層都要等它畫出來再點下一層 ——
 * 「量完就點」在這裡是穩定失敗，不是偶發（實測：直接點深層路徑一定選不到）。
 *
 * 回傳是否走到底。中途某一層沒出現就回 false，讓呼叫端的斷言紅得有話可說。
 */
/**
 * 把 Files 的樹根切回 folder 自身。
 *
 * **跨身分導覽會把樹根切到目標所在的工作目錄**（`side-panel-worktree` 的要求）—— 於是任何
 * 「先自 OpenSpec 跳去看某個 worktree 的檔案、再以 folder 根座標展開別的路徑」的段落，第二步
 * 會靜默落空（那些列在新的樹根下根本不在根層）。而失效方式很惡劣：`openInFileTree` 回 false，
 * 但先前開著的檔案還在畫面上，於是其後「有沒有跳回 OpenSpec 的入口」那類斷言驗的是**上一個
 * 檔案** —— 該紅的紅得莫名，該綠的綠得虛假。
 *
 * 走產品自己的路徑（選擇器選 folder 自身那一筆），不繞過 UI。沒有選擇器（工作目錄恰一個）
 * 時是 no-op。
 */
async function resetWorktreeToSelf(client, selfBranch = 'master') {
  if ((await client.evaluate(WORKTREE_PICKER)) === null) return
  await client.evaluate(CLICK_WORKTREE_PICKER)
  await client.evaluate(CLICK_WORKTREE_ITEM(selfBranch))
  await pollUntil(client, WORKTREE_PICKER, (v) => v?.includes(selfBranch) === true, 8000)
}

async function openInFileTree(client, relPath, rootPrefix = '') {
  // **檔案樹與檢視器互斥渲染**（`openPath === null ? <FileTree/> : <FileViewer/>`）——
  // 開著某個檔案時樹根本不在 DOM 裡，逐層展開必定一步都走不動。
  //
  // 失效方式很惡劣：導航靜默失敗，而**先前開著的那個檔案還在畫面上**，於是其後「有沒有
  // 跳回 OpenSpec 的入口」那類斷言驗的是上一個檔案 —— 該紅的紅得莫名，該綠的綠得虛假
  // （實測：spec 檔案那條是綠的，但它驗到的是還開著的 `tasks.md`）。
  //
  // 用 breadcrumb 上那顆 `files` 回到樹（產品自己的路徑）。
  //
  // **不可改用「切走身分再切回來」** —— FilesPanel 刻意在 `useState` 的初始值就套用跨身分
  // 請求（否則跳過去的那一次永遠不會開檔），於是重新掛載會把上一個 request **重播一次**，
  // 又開回同一個檔案（實測：重置後仍停在 `tasks.md`）。
  if ((await client.evaluate(OPEN_FILE_PATH)) !== null) {
    await client.evaluate(CLICK_BREADCRUMB_ROOT)
    const cleared = await pollUntil(client, OPEN_FILE_PATH, (value) => value === null, 8000)
    if (cleared !== null) return false
  }

  // **逐層展開必須自樹根開始，而樹根不一定是 folder 根**（`side-panel-worktree`）。列的 `title`
  // 恆為完整的 folder-relative 路徑，但選定某個工作目錄之後，根層的列是
  // `<工作目錄>/openspec` 而不是 `.claude` —— 從第一段開始找會在第一步就落空。
  const inner = rootPrefix ? relPath.slice(rootPrefix.length + 1) : relPath
  const segments = inner.split('/').filter(Boolean)
  let prefix = rootPrefix

  for (const segment of segments) {
    prefix = prefix ? `${prefix}/${segment}` : segment
    const appeared = await pollUntil(client, FILES_HAS_ROW(prefix), (value) => value === true, 8000)
    if (appeared !== true) return false

    // **點目錄是 toggle，不是「展開」** —— 已展開的再點一次會收合，其下每一層隨之消失，
    // 而下一圈的等待只會逾時（實測：連續導航兩條路徑時，第二條的共同前綴被第一條展開過，
    // 於是第一步就把樹關掉了）。`aria-expanded` 為 `'true'` 時跳過；檔案沒有這個屬性，
    // 恆為 null，一律點下去開啟它。
    if ((await client.evaluate(FILES_ROW_EXPANDED(prefix))) === 'true') continue
    await client.evaluate(FILES_CLICK_ROW(prefix))
  }

  return true
}

async function anchorChange(client, slug) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // **切視圖本身也要納入重試** —— 建立 session 之後畫面仍在變動，`CLICK_VIEW` 會落空；
    // 而落空的徵狀是「樹永遠不出現」，不是「點錯地方」（實測：兩個模式都紅在同一處，
    // 重試三次也救不回來 —— 因為每次重試都在同一個沒切過去的視圖裡等一棵不存在的樹）。
    await client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const rows = await pollUntil(
      client,
      CHANGE_TREE_ROWS('Active'),
      (list) => list.some((r) => r.slug === slug),
      8000,
    )
    if (!rows) continue

    await client.evaluate(ACTIVATE_TREE_ROW(slug))
    // 在樹上選一個 change 會錨定它並切回「本 change」視圖，`ANCHORED_SLUG` 讀的正是那裡的標題。
    const anchored = await pollUntil(client, ANCHORED_SLUG, (v) => v === slug, 6000)
    if (anchored === slug) return slug
  }
  return await client.evaluate(ANCHORED_SLUG)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function runMode(label, { port, rendererUrl }) {
  console.log(`\n── ${label} ──`)

  const { many, single, archivedOnly, plain } = makeFixture()
  const worktree = makeWorktreeFixture()
  const profile = seedProfile([
    ['f-many', many],
    ['f-single', single],
    ['f-archived', archivedOnly],
    ['f-plain', plain],
    ['f-worktree', worktree.repo],
    ['f-worktree-inside', worktree.inside],
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

    // ── artifact-continuation：三個條件全部成立時入口可用 ────────────────────
    //
    // 此刻：側欄來源＝session 自身的 folder、focused 是 **claude** 目標（上面那個 stub）、
    // 且正在執行。fixture 的 add-invoice 只有 proposal 與 tasks —— **還缺 design 與 specs**。
    const ownEntry = await pollUntil(
      app.client,
      CONTINUE_ENTRY,
      (v) => v !== null && v.disabled === false,
      8000,
    )
    check(results, '條件全部成立時續寫入口可用', ownEntry?.disabled === false, JSON.stringify(ownEntry))
    check(results, '入口列出尚缺的 artifact（design 與 specs）',
      ownEntry !== null && ownEntry.text.includes('design') && ownEntry.text.includes('specs'),
      ownEntry?.text)

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

    // **選單選了項目就該自己關掉。**（`workspace-layout` 的新 requirement）
    // 這正是本 change 修的那個呼叫端：關閉原本倚賴「點擊冒泡到 window 由 dismiss 順帶關掉」，
    // 而選取 folder 會讓上層在**同一次事件中**重新 render —— React 同步 flush effect，
    // dismiss 的 listener 在那次點擊冒到 window 之前就已經被換掉了。
    const menuGone = await pollUntil(
      app.client,
      `document.querySelector('[role="menu"]') === null`,
      (v) => v === true,
      3000,
    )
    check(results, '於來源下拉選取 folder 後選單關閉', menuGone === true)

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

    // ── artifact-continuation：入口只在目標 session 能承接時可用 ──────────────
    //
    // 此刻側欄來源是 repo-many，而 focused session 屬於 repo-single —— 先在這裡錨定一個
    // change，才看得到入口（沒有錨定的 change 就沒有「本 change」視圖可談）。
    await app.client.evaluate(ACTIVATE_TREE_ROW('add-oauth'))
    await pollUntil(app.client, ANCHORED_SLUG, (v) => v === 'add-oauth', 8000)
    const foreignEntry = await pollUntil(app.client, CONTINUE_ENTRY, (v) => v !== null, 8000)
    check(results, '側欄來源指向他處時，續寫入口呈現為停用',
      foreignEntry !== null && foreignEntry.disabled === true, JSON.stringify(foreignEntry))
    check(results, '停用時說明原因（而不是讓入口消失）',
      foreignEntry !== null && foreignEntry.text.includes(copy('openspec.continueBlocked.foreignSource')),
      foreignEntry?.text)

    // 「回到自身」捷徑出現，點它回到 repo-single
    check(
      results,
      '來源非自身時顯示「回到自身」捷徑',
      (await app.client.evaluate(HAS_BACK_TO_OWN)) === true,
    )
    await realClick(app.client, await stableRect(app.client, BACK_TO_OWN_RECT))
    const backHome = await pollUntil(app.client, ANCHORED_SLUG, (v) => v === 'solo-change', 8000)
    check(results, '「回到自身」把側欄帶回 session 自己的 repo', backHome === 'solo-change', String(backHome))

    // 來源已回到自身，但這個 repo 的 focused session 是 **login shell** —— 入口仍須停用
    // （shell 收到 slash command 只會回報一個找不到的命令）。這是 spec 的另一條 scenario。
    const shellEntry = await pollUntil(app.client, CONTINUE_ENTRY, (v) => v !== null, 8000)
    check(results, 'focused session 為 shell 時，續寫入口停用',
      shellEntry !== null && shellEntry.disabled === true, JSON.stringify(shellEntry))
    check(results, '停用時說明原因（shell）',
      shellEntry !== null && shellEntry.text.includes(copy('openspec.continueBlocked.notClaude')),
      shellEntry?.text)

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

    // ── worktree 聚合 ───────────────────────────────────────────────────────
    //
    // **這一段放在最後**：它切到另一個 repo 並開 overlay，會動到前面每一段所依賴的狀態。
    console.log('\nworktree 聚合')

    check(
      results,
      '選中含 worktree 的 repo',
      (await pollUntil(app.client, SELECT_FOLDER('repo-worktree'), (ok) => ok === true, 8000)) === true,
    )
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))

    const wtActive = await pollUntil(
      app.client,
      CHANGE_TREE_ROWS('Active'),
      (list) => list.length >= 3,
      12_000,
    )
    const slugs = (wtActive ?? []).map((r) => r.slug)
    check(
      results,
      'worktree 裡的 change 出現在側欄',
      slugs.includes('inside-change') && slugs.includes('outside-change'),
      slugs.join(', '),
    )

    // **這條是防假綠的關鍵**：worktree ≤ 1 時 core 會靜默退回非聚合，而上一條在那種情況下
    // 仍可能因為別的原因通過。它們確實不在主工作目錄底下 —— 那才是「聚合真的發生了」的證據。
    check(
      results,
      '那些 change 不存在於主工作目錄的 openspec/changes/ 底下',
      !existsSync(join(worktree.repo, 'openspec/changes/inside-change')) &&
        !existsSync(join(worktree.repo, 'openspec/changes/outside-change')) &&
        existsSync(join(worktree.inside, 'openspec/changes/inside-change')),
    )

    const rowOf = (slug) => (wtActive ?? []).find((r) => r.slug === slug)
    check(
      results,
      '來自 worktree 的 change 標示其分支',
      rowOf('inside-change')?.text.includes('feat-inside') === true &&
        rowOf('outside-change')?.text.includes('feat-outside') === true,
      `${rowOf('inside-change')?.text} / ${rowOf('outside-change')?.text}`,
    )
    // 成對 —— 少了這條，「標示恆常呈現」也會讓上一條通過。
    check(
      results,
      '來自主工作目錄的 change 不標示來源',
      rowOf('main-change') !== undefined &&
        !rowOf('main-change').text.includes('master') &&
        !rowOf('main-change').text.includes('feat-'),
      rowOf('main-change')?.text,
    )

    // **續寫入口的條件 4 需要前三個條件全部成立** —— 否則擋住入口的會是 `noSession`，
    // 而那條先於它回報（實測踩過：沒建 session 就斷言，讀到的說明是「Start a session…」）。
    // 因此先在這個 repo 開一個執行中的 claude session（stub）。
    await createSession(app.client, 'claude')

    // 邊界**內**的 worktree：relPath 翻得出來 ⇒ 檔案導覽入口在
    //
    // **建立 session 會把側欄視圖帶回「本 change」**（新 session 尚無錨定 ⇒ 空狀態），
    // 所以要重新切回瀏覽視圖並等樹畫出來 —— 直接點是在賭（實測：build 模式點空，
    // 其後三條斷言全紅且看起來像「續寫入口壞了」）。
    const insideAnchored = await anchorChange(app.client, 'inside-change')
    check(results, '錨定切換至 inside-change', insideAnchored === 'inside-change', String(insideAnchored))

    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabChange')))
    const insideOpen = await pollUntil(app.client, HAS_OPEN_IN_FILES, (v) => v === true, 12_000)
    check(results, '邊界內 worktree 的 artifact 可跨身分導覽', insideOpen === true)

    // 續寫入口：change 在另一個工作目錄，而 session 跑在 folder 根目錄 ⇒ 停用並說明
    const wtEntry = await pollUntil(app.client, CONTINUE_ENTRY, (v) => v !== null, 10_000)
    check(
      results,
      '來源為另一個工作目錄時續寫入口停用',
      wtEntry?.disabled === true,
      JSON.stringify(wtEntry),
    )
    check(
      results,
      '停用時說明原因',
      wtEntry !== null && wtEntry.text.includes(copy('openspec.continueBlocked.foreignWorktree')),
      wtEntry?.text,
    )

    // ── session 開在 change 的工作目錄（session-in-worktree）────────────────
    //
    // **上面那兩條在本 change 之後仍然應該是綠的**（session 跑在 folder 根、change 在 worktree
    // ⇒ 依規格必須停用）。判準從「來源 vs folder」改成了「來源 vs session 的工作目錄」，
    // 但這個情境的可觀察行為不變 —— 改寫它們就是把準心移開去閃避一條正確的守衛。
    check(
      results,
      '停用時提供「於該工作目錄開啟 session」的入口',
      (await app.client.evaluate(HAS_OPEN_SESSION_HERE)) === true,
    )

    const tabsBefore = (await app.client.evaluate(SESSION_TABS)) ?? []
    check(results, '觸發該入口', (await app.client.evaluate(CLICK_OPEN_SESSION_HERE)) === true)

    const tabsAfter = await pollUntil(
      app.client,
      SESSION_TABS,
      (list) => Array.isArray(list) && list.length === tabsBefore.length + 1,
      15_000,
    )
    check(
      results,
      '於該工作目錄建立了一個 session',
      Array.isArray(tabsAfter) && tabsAfter.length === tabsBefore.length + 1,
      `之前 ${tabsBefore.length} 個、之後 ${tabsAfter?.length} 個`,
    )

    // **新 session 必須錨定該 change** —— 否則側欄落入「尚無錨定」的空狀態，續寫入口連呈現的
    // 機會都沒有（衍生預設只在該 repo 恰有一個 active change 時成立，而這裡有三個）。
    const anchoredAfterOpen = await pollUntil(
      app.client,
      ANCHORED_SLUG,
      (value) => value === 'inside-change',
      12_000,
    )
    check(results, '新 session 錨定了該 change', anchoredAfterOpen === 'inside-change',
      String(anchoredAfterOpen))

    const enabled = await pollUntil(app.client, CONTINUE_ENTRY, (v) => v?.disabled === false, 15_000)
    check(results, 'session 開在該 change 的工作目錄後，續寫入口可用', enabled?.disabled === false,
      JSON.stringify(enabled))

    // **成對的那一半**：session 開在**另一個**工作目錄時仍然停用。
    // 少了它，一個把條件 4 直接取消的實作會通過上面那條 —— 而那正是 issue 原本建議的做法。
    const outsideAnchoredNow = await anchorChange(app.client, 'outside-change')
    check(results, '錨定切換至另一個工作目錄的 change', outsideAnchoredNow === 'outside-change',
      String(outsideAnchoredNow))
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabChange')))
    const stillBlocked = await pollUntil(app.client, CONTINUE_ENTRY, (v) => v?.disabled === true, 12_000)
    check(
      results,
      'session 開在另一個工作目錄時，續寫入口仍然停用',
      stillBlocked?.disabled === true,
      JSON.stringify(stillBlocked),
    )

    // 邊界**外**的 worktree：內容完整，但翻不出 relPath ⇒ 沒有檔案導覽入口（成對於上面那條）
    //
    // **切回瀏覽視圖之後要等樹畫出來再點** —— 直接 `ACTIVATE_TREE_ROW` 是在賭渲染已經完成
    // （實測：build 模式僥倖通過、dev 模式慢一步就點空，而後面兩條跟著紅）。
    // 把中間狀態變成獨立的斷言 —— 否則錨定失敗時，紅的會是下面那條內容斷言，指向錯的方向。
    const outsideAnchored = await anchorChange(app.client, 'outside-change')
    check(results, '錨定切換至 outside-change', outsideAnchored === 'outside-change', String(outsideAnchored))

    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabChange')))
    const outsideContent = await pollUntil(
      app.client,
      SPEC_CONTENT,
      (text) => text.includes('邊界外 worktree 的 change'),
      12_000,
    )
    check(
      results,
      '邊界外 worktree 的 change 內容完整',
      String(outsideContent).includes('邊界外 worktree 的 change'),
      String(outsideContent).slice(0, 160),
    )
    const outsideOpen = await pollUntil(app.client, HAS_OPEN_IN_FILES, (v) => v === false, 8000)
    check(results, '邊界外 worktree 的 artifact 不提供檔案導覽入口', outsideOpen === false)

    // agent 改 worktree 裡的檔案 → 側欄自己更新（監看的第二層）
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    writeFile(
      join(worktree.inside, 'openspec/changes/inside-change/tasks.md'),
      '## 1. 後端\n\n- [x] 1.1 做完了\n',
    )
    const afterEdit = await pollUntil(
      app.client,
      CHANGE_TREE_ROWS('Active'),
      (list) => list.find((r) => r.slug === 'inside-change')?.text.includes('1/1') === true,
      15_000,
    )
    check(
      results,
      'worktree 裡的變更使側欄自行更新',
      afterEdit?.find((r) => r.slug === 'inside-change')?.text.includes('1/1') === true,
      afterEdit?.find((r) => r.slug === 'inside-change')?.text,
    )

    // Timeline 的依 topic 分組 —— 聚合的 change 節點識別碼帶著 worktree key，若未正規化，
    // 分組會**靜默**退化成全部落在「(no topic)」（圖照樣畫得出來）。
    check(results, '自側欄開啟 Timeline', (await app.client.evaluate(CLICK_OPEN_VIZ('Timeline'))) === true)
    await pollUntil(app.client, TIMELINE, (value) => value !== null, 12_000)
    check(
      results,
      '開啟依 topic 分組',
      (await app.client.evaluate(CLICK_VIZ_CHIP(copy('viz.groupByTopic')))) === true,
    )
    // **輪詢條件必須是「auth 出現了」，不能是「有東西」** —— 分組所需的關係圖是另一次非同步
    // 取數，它抵達之前 lane 就是 `["(no topic)"]`，長度為 1 也滿足「有東西」，於是提早返回、
    // 讀到一個還沒成形的狀態（實測踩過）。等不到才是真的紅。
    const laneTitles = await pollUntil(
      app.client,
      TIMELINE_SECTIONS,
      (list) => Array.isArray(list) && list.includes('auth'),
      15_000,
    )
    check(
      results,
      '聚合後 Timeline 仍依 topic 分組（不是全部落在無 topic）',
      Array.isArray(laneTitles) && laneTitles.includes('auth'),
      JSON.stringify(laneTitles),
    )

    // ── 聚合 repo 的 Graph：點擊要錨定到**真的** slug ────────────────────────
    //
    // core 的聚合圖把 change 節點的識別碼命名為 `change:<worktreeKey>:<slug>`，並在節點上附
    // `source`；而我們**刻意剝掉 `source`**（它含絕對路徑）。`SpecGraph` 的剝除是**條件式地**
    // 依賴 `source` 的 —— 沒有它就把整串 `<key>:<slug>` 當成 slug 交出去，錨定到一個不存在的
    // change，並且會被寫進 `sessions.json` 存活。
    //
    // 因此主行程必須**在剝掉 `source` 之前**把識別碼還原。這條斷言就是那件事的證明：
    // **它在還原之前必定紅**，而既有那條 Graph 點擊斷言跑在單一工作目錄的 fixture 上，看不到它。
    // Timeline 的 overlay 還開著 —— 先收掉再從側欄開 Graph（用關閉按鈕，理由見下方註解）。
    await app.client.evaluate(CLICK_VIZ_CLOSE)
    const timelineClosed = await pollUntil(app.client, OVERLAY, (v) => v === null, 8000)
    check(results, '關閉 Timeline overlay', timelineClosed === null, JSON.stringify(timelineClosed))

    check(
      results,
      '自聚合 repo 的側欄開啟 Graph',
      (await app.client.evaluate(CLICK_OPEN_VIZ('Graph'))) === true,
    )
    const wtNodeRect = await pollUntil(
      app.client,
      GRAPH_NODE_RECT('change:inside-change'),
      (value) => value !== null,
      15_000,
    )
    check(
      results,
      'Graph 上以非聚合形式的識別碼找得到 worktree 的 change 節點',
      wtNodeRect !== null,
      JSON.stringify(wtNodeRect),
    )

    await sleep(1500) // simulation 收斂後還有一段 fit-to-viewport 的 transition
    const wtSettled = await app.client.evaluate(GRAPH_NODE_RECT('change:inside-change'))
    const wtTarget = wtSettled ?? wtNodeRect
    if (wtTarget) {
      await realClick(app.client, wtTarget)
    } else {
      // **找不到節點時也要把 overlay 收掉。** `realClick(null)` 會 throw，而 throw 不是紅燈 ——
      // 它讓整支探針從這裡中斷，後面每一段都不會跑（實測：對照組驗鑑別力時就是這樣斷的）。
      // 留著 overlay 也一樣糟：其後的真滑鼠事件全部點不到，`createSession` 同樣是 throw。
      await app.client.evaluate(CLICK_VIZ_CLOSE)
    }
    await pollUntil(app.client, OVERLAY, (value) => value === null, 8000)

    const anchoredFromGraph = await pollUntil(
      app.client,
      ANCHORED_SLUG,
      (value) => value === 'inside-change',
      12_000,
    )
    check(
      results,
      '於聚合 repo 的 Graph 觸發 change 後，錨定的是乾淨的 slug（不含來源識別碼）',
      anchoredFromGraph === 'inside-change',
      String(anchoredFromGraph),
    )

    // ── 反向導覽：worktree 裡的檔案跳得回 OpenSpec 身分 ──────────────────────
    //
    // **這一段驗的是一趟完整的往返**，不是兩個獨立的方向。此前 change → 檔案可用、
    // 檔案 → change 不可用，於是同一個檔案「去得了、回不來」。
    //
    // 正向那一步順便當作**導航手段**：它會在 Files 身分開啟 worktree 裡的那個檔案，
    // 省掉逐層展開檔案樹（而且它是使用者真正會走的路徑）。
    console.log('\n反向導覽（worktree 內的檔案）')

    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabChange')))
    // **把前置變成獨立的斷言** —— 少了它，下面點不到按鈕時紅的是「開啟檔案」那條，
    // 而真正壞掉的是「視圖沒切過去 / artifact 還沒畫出來」，指向錯的方向。
    const artifactReady = await pollUntil(app.client, HAS_OPEN_IN_FILES, (v) => v === true, 12_000)
    check(results, '本 change 視圖已呈現 artifact 的檔案導覽入口', artifactReady === true)

    // **needle 用 slug，不是檔名。** 預設選中的 artifact 不保證是 proposal —— 前面那條
    // 「worktree 裡的變更使側欄自行更新」剛寫進 `tasks.md`，這個 change 因此多了一個 artifact
    // （實測：以 `'proposal.md'` 當 needle 找不到按鈕）。slug 在每個 artifact 的路徑裡都有。
    check(
      results,
      '自 worktree 的 change artifact 開啟其檔案',
      (await app.client.evaluate(CLICK_OPEN_FILE('inside-change'))) === true,
    )

    const wtOpenPath = await pollUntil(
      app.client,
      OPEN_FILE_PATH,
      (value) => typeof value === 'string' && value.startsWith('.claude/'),
      8000,
    )
    check(
      results,
      '開啟的是 worktree 裡的檔案（首段不是 openspec）',
      String(wtOpenPath).startsWith('.claude/worktrees/wt-inside/openspec/changes/inside-change/'),
      String(wtOpenPath),
    )

    // **本 change 的核心斷言。** 判準若仍是「首段必須是 openspec」，這裡恆為 false。
    const wtBackEntry = await pollUntil(app.client, HAS_VIEW_IN_OPENSPEC, (v) => v === true, 8000)
    check(results, 'worktree 裡的檔案提供跳回 OpenSpec 的入口', wtBackEntry === true)

    check(
      results,
      '觸發後跳回 OpenSpec 身分',
      (await app.client.evaluate(CLICK_VIEW_IN_OPENSPEC)) === true,
    )
    const wtBackIdentity = await pollUntil(app.client, IDENTITY, (v) => v === 'openspec', 8000)
    check(results, '身分切回 OpenSpec', wtBackIdentity === 'openspec')
    const wtBackAnchor = await pollUntil(
      app.client,
      ANCHORED_SLUG,
      (value) => value === 'inside-change',
      8000,
    )
    check(
      results,
      '呈現的是原本那個 change（往返回到同一個實體）',
      wtBackAnchor === 'inside-change',
      String(wtBackAnchor),
    )

    // 反面：結構相同但不在任何工作目錄的 `openspec/` 底下 —— **成對於上面那條**。
    //
    // 少了它，一個把判準鬆綁成「路徑裡有 openspec 就算」的實作會通過上面每一條正面斷言。
    // 誘餌必須帶 `changes/` 那一層（見 fixture 的註解與 design D4 的鑑別力矩陣）。
    await app.client.evaluate(CLICK_IDENTITY('▤'))
    await pollUntil(app.client, IDENTITY, (v) => v === 'files', 8000)

    // 上面那次跨身分導覽把樹根切到了 `wt-inside`（`side-panel-worktree` 的要求）。以下三條
    // 都以 folder 根為座標，先切回來 —— 少了這一步，它們會靜默落空而其後的斷言驗到上一個檔案。
    await resetWorktreeToSelf(app.client)

    const decoyOpened = await openInFileTree(app.client, 'docs/openspec/changes/decoy/proposal.md')
    check(results, '於檔案樹開啟 docs 底下的誘餌檔案', decoyOpened === true)
    const decoyPath = await pollUntil(
      app.client,
      OPEN_FILE_PATH,
      (value) => value === 'docs/openspec/changes/decoy/proposal.md',
      8000,
    )
    check(results, '開啟的是誘餌檔案', decoyPath === 'docs/openspec/changes/decoy/proposal.md', String(decoyPath))
    check(
      results,
      'docs 底下、結構相同的檔案不提供跳回 OpenSpec 的入口',
      (await app.client.evaluate(HAS_VIEW_IN_OPENSPEC)) === false,
    )

    // 同一個誘餌，但在 worktree 之內 —— 剝掉工作目錄根之後首段是 `docs`，同樣不得命中。
    const decoyInWt = await openInFileTree(
      app.client,
      '.claude/worktrees/wt-inside/docs/openspec/changes/decoy/proposal.md',
    )
    check(results, '於檔案樹開啟 worktree 內的誘餌檔案', decoyInWt === true)
    check(
      results,
      'worktree 內 docs 底下的檔案同樣不提供入口',
      (await app.client.evaluate(HAS_VIEW_IN_OPENSPEC)) === false,
    )

    // worktree 裡的 spec 檔案 → 該 topic（design D3：導覽的目標是 topic，不是檔案）
    const wtSpecOpened = await openInFileTree(
      app.client,
      '.claude/worktrees/wt-inside/openspec/specs/auth/spec.md',
    )
    check(results, '於檔案樹開啟 worktree 內的 spec 檔案', wtSpecOpened === true)
    check(
      results,
      'worktree 內的 spec 檔案提供跳回 OpenSpec 的入口',
      (await app.client.evaluate(HAS_VIEW_IN_OPENSPEC)) === true,
    )
    await app.client.evaluate(CLICK_VIEW_IN_OPENSPEC)
    const wtSpecText = await pollUntil(
      app.client,
      SPEC_CONTENT,
      (text) => text.includes('auth Specification'),
      12_000,
    )
    check(
      results,
      '呈現的是該 topic',
      String(wtSpecText).includes('auth Specification'),
      String(wtSpecText).slice(0, 120),
    )
    // **來源標示是 D3 的承重部分，不是裝飾**：使用者手上那個檔案與這裡呈現的是兩份，
    // 而 archive 前在 worktree 裡 backfill main spec 是標準流程 ⇒ 分歧是常態。
    check(
      results,
      'spec 檢視標示其內容來自主工作目錄',
      String(wtSpecText).includes(prefixOf('openspec.specOrigin')),
      String(wtSpecText).slice(0, 200),
    )

    // 執行期間新建一個邊界內 worktree —— 工作目錄根清單必須跟著更新，否則新 worktree 裡的
    // 檔案沒有入口。清單走的是既有的 `openspec:changed` 監看（含「工作目錄清單本身」那一層），
    // **本 change 不另造監看**，這條驗的正是那個沿用是否成立。
    execFileSync(
      'git',
      [
        '-c',
        'user.email=probe@spekterm',
        '-c',
        'user.name=probe',
        '-c',
        'color.ui=false',
        'worktree',
        'add',
        '-q',
        '-b',
        'feat-late',
        '.claude/worktrees/wt-late',
      ],
      { cwd: worktree.repo, stdio: 'pipe' },
    )
    const lateDir = join(worktree.repo, '.claude/worktrees/wt-late')
    changeMeta(join(lateDir, 'openspec/changes/late-change'), '2026-06-01')
    writeFile(join(lateDir, 'openspec/changes/late-change/proposal.md'), '# 執行期間才出現的 change\n')

    // 上一步停在 spec 檢視 —— `CHANGE_TREE_ROWS` 讀的是**瀏覽**視圖的樹，不先切回去會恆讀到
    // 空陣列（而那看起來像「清單沒更新」，指向錯的方向）。
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const lateListed = await pollUntil(
      app.client,
      CHANGE_TREE_ROWS('Active'),
      (list) => list.some((r) => r.slug === 'late-change'),
      20_000,
    )
    check(
      results,
      '執行期間新建的 worktree 其 change 出現在側欄',
      Array.isArray(lateListed) && lateListed.some((r) => r.slug === 'late-change'),
      JSON.stringify(lateListed?.map((r) => r.slug)),
    )

    await app.client.evaluate(CLICK_IDENTITY('▤'))
    await pollUntil(app.client, IDENTITY, (v) => v === 'files', 8000)
    const lateOpened = await openInFileTree(
      app.client,
      '.claude/worktrees/wt-late/openspec/changes/late-change/proposal.md',
    )
    check(results, '於檔案樹開啟新 worktree 內的檔案', lateOpened === true)
    check(
      results,
      '新建的工作目錄已進入根清單（其檔案可反向導覽）',
      (await app.client.evaluate(HAS_VIEW_IN_OPENSPEC)) === true,
    )

    // **把狀態還原給後面的段落。** 這一段結束時身分停在 Files、視圖停在 spec 檢視，而下一段
    // （folder 本身是 linked worktree）要在 OpenSpec 的瀏覽視圖上點樹 —— 不還原的話它整段紅，
    // 看起來像那一段壞了（實測踩過：6 條全紅，實際上只是身分沒切回來）。
    await app.client.evaluate(CLICK_IDENTITY('◈'))
    await pollUntil(app.client, IDENTITY, (v) => v === 'openspec', 8000)
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))

    // ── folder 本身就是一個 linked worktree ──────────────────────────────────
    //
    // **這一段守的是 D7 的判準本身。** 此時該 folder 的 change 其 `isMain` 為 false（主工作
    // 目錄在別處）而 `isFolderRoot` 為 true（session 就跑在這裡）—— 兩者相反。把判準換回
    // `isMain`，續寫入口會被錯誤地停用，而那個錯誤**只有人的眼睛看得到**：DTO 層的單元測試
    // 驗的是欄位值，不是入口亮不亮。
    // 上面點 change 節點時 overlay 已自行關閉 —— 這裡只確認它真的不在了。
    // 下面的 `createSession` 送的是**真滑鼠事件**，overlay 只要還蓋著就點不到「+ session」，
    // 而 `createSession` 是 throw 而不是回報紅燈 —— 整支探針會就此中斷（實測踩過）。
    // `SELECT_FOLDER` 之類的 `evaluate` 直接點 DOM，不受遮擋，所以「前一條是綠的」完全不代表
    // overlay 已經退場。
    const overlayGone = await pollUntil(app.client, OVERLAY, (v) => v === null, 8000)
    check(results, 'overlay 已退場（真滑鼠事件的前置）', overlayGone === null, JSON.stringify(overlayGone))

    console.log('\nfolder 本身是 linked worktree')

    check(
      results,
      '選中一個本身就是 linked worktree 的 folder',
      (await pollUntil(app.client, SELECT_FOLDER('wt-inside'), (ok) => ok === true, 8000)) === true,
    )
    await createSession(app.client, 'claude')

    const selfAnchored = await anchorChange(app.client, 'inside-change')
    check(
      results,
      '錨定該 worktree 自己的 change',
      selfAnchored === 'inside-change',
      String(selfAnchored),
    )

    // 前置：它確實**不是**主工作目錄的 change —— 否則這條退化成「main 的 change 可續寫」，
    // 對 `isMain` / `isFolderRoot` 之分毫無鑑別力。
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const selfRows = await pollUntil(
      app.client,
      CHANGE_TREE_ROWS('Active'),
      (list) => list.some((r) => r.slug === 'inside-change'),
      10_000,
    )
    check(
      results,
      '該 change 帶著非 main 的來源標示（前置：它不是主工作目錄的 change）',
      selfRows?.find((r) => r.slug === 'inside-change')?.text.includes('feat-inside') === true,
      selfRows?.find((r) => r.slug === 'inside-change')?.text,
    )

    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabChange')))
    const selfEntry = await pollUntil(
      app.client,
      CONTINUE_ENTRY,
      (v) => v !== null && v.disabled === false,
      12_000,
    )
    check(
      results,
      'folder 本身是 linked worktree 時，續寫入口可用',
      selfEntry?.disabled === false,
      JSON.stringify(selfEntry),
    )

    // 順帶：spec 的讀取根是**主工作目錄**（D2b）—— 這個 folder 自己沒有 openspec/specs/。
    await app.client.evaluate(CLICK_VIEW(copy('openspec.tabBrowse')))
    const specRows = await pollUntil(app.client, SPEC_TREE_TOPICS, (list) => list.length > 0, 10_000)
    check(
      results,
      'folder 是 linked worktree 時仍列得出主工作目錄的 spec',
      specRows?.some((r) => r.topic === 'auth') === true,
      JSON.stringify(specRows?.map((r) => r.topic)),
    )
    check(
      results,
      '而且那個 spec 打得開（讀取根不是 folder 自己）',
      (await app.client.evaluate(ACTIVATE_TREE_ROW('auth'))) === true,
    )
    const mainSpecText = await pollUntil(
      app.client,
      SPEC_CONTENT,
      (text) => text.includes('auth Specification'),
      12_000,
    )
    check(
      results,
      'spec 的內容真的讀得到（讀取根不是 folder 自己）',
      String(mainSpecText).includes('auth Specification'),
      String(mainSpecText).slice(0, 120),
    )

    // ── Files 的工作目錄選擇器（side-panel-worktree）──────────────────────────
    //
    // **這一段放在最後**，因為它會 `Page.reload`（驗持久化）—— 那會把前面每一段建立的 UI 狀態
    // 洗掉。它也不必還原狀態，後面沒有段落了。
    console.log('\nFiles 的工作目錄選擇器')

    check(
      results,
      '切回含三個工作目錄的 repo',
      (await pollUntil(app.client, SELECT_FOLDER('repo-worktree'), (ok) => ok === true, 8000)) === true,
    )
    // **前置由這一段自己建立，不假設前面每一段都把狀態還原了。** 新 session 的工作目錄必為
    // 預設（folder 自身）—— 於是下面那條「預設以 folder 自身為根」驗的是真的預設值，而不是
    // 「前面剛好沒人改過」。
    await createSession(app.client, 'shell')

    await app.client.evaluate(CLICK_IDENTITY('▤'))
    check(
      results,
      '切至 Files 身分',
      (await pollUntil(app.client, IDENTITY, (v) => v === 'files', 8000)) === 'files',
    )

    const picker = await pollUntil(app.client, WORKTREE_PICKER, (v) => v !== null, 12_000)
    check(
      results,
      '工作目錄多於一個時呈現選擇器，且標示當前為 folder 自身的分支',
      picker !== null && picker.includes('master'),
      String(picker),
    )

    // **前置兼反向斷言的對照組**：預設以 folder 自身為根。
    //
    // 判準是**根的直接子項目**，不是「某個 title 存不存在」—— worktree 目錄本來就位於 folder
    // 邊界內，`.claude/worktrees/wt-inside/openspec` 這個 title 在**未切根**的樹上展開三層之後
    // 一樣看得到。兩者真正的差別是「不必展開就在根層」。
    const rootRowsSelf = await pollUntil(
      app.client,
      TREE_ROWS,
      (list) => list.includes('openspec'),
      12_000,
    )
    check(
      results,
      '預設以 folder 自身為根（根層是 folder 自己的項目）',
      rootRowsSelf?.includes('openspec') === true &&
        rootRowsSelf?.includes('.claude/worktrees/wt-inside/openspec') === false,
      JSON.stringify(rootRowsSelf),
    )

    check(results, '開啟工作目錄選擇器', (await app.client.evaluate(CLICK_WORKTREE_PICKER)) === true)
    const wtItems = await pollUntil(app.client, WORKTREE_MENU, (list) => list.length >= 3, 8000)
    check(
      results,
      '三個工作目錄都列出（含邊界外者）',
      (wtItems ?? []).some((i) => i.label.startsWith('master')) &&
        (wtItems ?? []).some((i) => i.label.startsWith('feat-inside')) &&
        (wtItems ?? []).some((i) => i.label.startsWith('feat-outside')),
      JSON.stringify(wtItems),
    )
    // **成對**：只驗「邊界外的停用」的話，一個「整個選單都壞掉／全部停用」的實作也會通過。
    check(
      results,
      '邊界外的工作目錄呈現但停用',
      (wtItems ?? []).find((i) => i.label.startsWith('feat-outside'))?.disabled === true,
      JSON.stringify(wtItems?.find((i) => i.label.startsWith('feat-outside'))),
    )
    check(
      results,
      '而邊界內的可選取（成對的對照組）',
      (wtItems ?? []).find((i) => i.label.startsWith('feat-inside'))?.disabled === false,
      JSON.stringify(wtItems?.find((i) => i.label.startsWith('feat-inside'))),
    )

    check(
      results,
      '選取邊界內的工作目錄',
      (await app.client.evaluate(CLICK_WORKTREE_ITEM('feat-inside'))) === true,
    )

    const rootRowsWt = await pollUntil(
      app.client,
      TREE_ROWS,
      (list) => list.includes('.claude/worktrees/wt-inside/openspec'),
      12_000,
    )
    check(
      results,
      '樹根換成該工作目錄（根層是它的項目）',
      rootRowsWt?.includes('.claude/worktrees/wt-inside/openspec') === true,
      JSON.stringify(rootRowsWt),
    )
    // **這條是防假綠的關鍵**：切根若沒生效，上一條在展開之後也會成立。folder 自身的根層項目
    // 消失，才是「換了一棵樹」而非「多展開了幾層」的證據。
    check(
      results,
      '且不再呈現 folder 自身的根層項目',
      rootRowsWt?.includes('openspec') === false && rootRowsWt?.includes('docs') === false,
      JSON.stringify(rootRowsWt),
    )

    // 開一個**只存在於該 worktree** 的檔案 —— `main-change` 兩邊都有（commit 過），拿它當
    // 目標對「切根有沒有生效」零鑑別力。
    const insideProposal = '.claude/worktrees/wt-inside/openspec/changes/inside-change/proposal.md'
    await openInFileTree(app.client, insideProposal, '.claude/worktrees/wt-inside')
    const openedInside = await pollUntil(app.client, OPEN_FILE_PATH, (v) => v === insideProposal, 12_000)
    check(
      results,
      '開得了只存在於該 worktree 的檔案',
      openedInside === insideProposal,
      String(openedInside),
    )
    // 兩種座標系各自正確：`title` 完整（它是選擇器與反向導覽的輸入），呈現的文字剝掉前綴。
    check(
      results,
      '麵包屑呈現的路徑自樹根算起（而 title 仍為完整路徑）',
      (await app.client.evaluate(OPEN_FILE_DISPLAY)) ===
        'openspec/changes/inside-change/proposal.md',
      String(await app.client.evaluate(OPEN_FILE_DISPLAY)),
    )
    check(
      results,
      '該檔案仍提供跳回 OpenSpec 身分的入口（反向導覽不因切根失效）',
      (await app.client.evaluate(HAS_VIEW_IN_OPENSPEC)) === true,
    )

    // ── 持久化：reload 後仍在該工作目錄 ──────────────────────────────────────
    //
    // **必須先選定一個非預設值再 reload。** 預設就是 folder 自身，若在預設態 reload，
    // 整個功能死掉也是綠的（CLAUDE.md：「先把狀態改成非預設值」）。
    //
    // **而 reload 之後必須切回同一個 session** —— 側欄的工作目錄是 per-session 的，focus 落在
    // 別的 session 上時讀到的是那一個的值（＝預設），於是斷言會以「沒有還原」的樣貌失敗，
    // 而真正的原因只是問錯了對象。
    const tabsBeforeReload = await app.client.evaluate(SESSION_TABS)
    const myTabIndex = (tabsBeforeReload ?? []).findIndex((tab) => tab.selected)
    check(
      results,
      '（前置）記下 reload 前 focused 的 session 分頁',
      myTabIndex >= 0,
      JSON.stringify(tabsBeforeReload),
    )

    // persist 有 500ms 的 debounce（`PERSIST_DEBOUNCE_MS`）—— reload 太快會把這次選擇丟掉，
    // 而那個失敗看起來與「持久化整個沒做」完全一樣。
    await sleep(1200)
    await app.client.send('Page.reload', {})
    await sleep(1500)
    await pollUntil(app.client, MOUNTED, (v) => v === true, 20_000)

    // **先選 folder 再判定身分** —— 沒有選中任何 folder 時側欄是空狀態，而那個 section 的
    // `aria-label` 是身分切換器的字串、不是 OpenSpec 面板的，`IDENTITY` 於是回 null。
    check(
      results,
      'reload 後重新選中該 repo',
      (await pollUntil(app.client, SELECT_FOLDER('repo-worktree'), (ok) => ok === true, 15_000)) === true,
    )
    check(
      results,
      'reload 後回到預設身分（證明頁面真的重新載入了）',
      (await pollUntil(app.client, IDENTITY, (v) => v === 'openspec', 12_000)) === 'openspec',
    )

    check(
      results,
      'reload 後切回同一個 session',
      (await pollUntil(app.client, FOCUS_SESSION_TAB(myTabIndex), (ok) => ok === true, 12_000)) === true,
    )
    await app.client.evaluate(CLICK_IDENTITY('▤'))
    await pollUntil(app.client, IDENTITY, (v) => v === 'files', 8000)

    const restoredWt = await pollUntil(app.client, WORKTREE_PICKER, (v) => v?.includes('feat-inside') === true, 15_000)
    check(
      results,
      '側欄的工作目錄跨 reload 還原',
      restoredWt?.includes('feat-inside') === true,
      String(restoredWt),
    )
    const restoredRows = await pollUntil(
      app.client,
      TREE_ROWS,
      (list) => list.includes('.claude/worktrees/wt-inside/openspec'),
      15_000,
    )
    check(
      results,
      '而且樹根確實還原到該工作目錄（不只是標籤對）',
      restoredRows?.includes('.claude/worktrees/wt-inside/openspec') === true &&
        restoredRows?.includes('openspec') === false,
      JSON.stringify(restoredRows),
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
