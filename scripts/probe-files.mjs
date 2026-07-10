/**
 * 驗證 file-explorer、file-viewer、workspace-layout 的身分切換，以及 workspace-app-shell
 * 重新確立的編輯器 requirement。
 *
 * 兩種模式各跑一次：`electron .`（正式建置）與 `electron-vite dev`（開發模式）。編輯器的
 * worker 在兩者的載入路徑不同（`file://` 對 `http://`），而 requirement 要求兩者皆成立。
 *
 * **worker 存活不以「看到語法高亮」判定** —— tokenization 在主執行緒完成，worker 沒載入
 * 也照樣有顏色。改為觀察一項只可能由 worker 算出的結果：Monaco 內建的 link provider
 * 呼叫 worker 的 `$computeLinks`，命中的 URL 會被畫上 `.detected-link` decoration。
 *
 * 用法：npm run probe:files
 * 結束碼 0 表示全部 scenario 通過。
 */
import { spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { check, connect, pollUntil, waitForPageTarget } from './lib/cdp.mjs'

const BUILD_PORT = 9224
const DEV_PORT = 9225
const MAX_FILE_BYTES = 2 * 1024 * 1024

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

// ── fixture ─────────────────────────────────────────────────────────────────

const README = `# 標題

外部連結：[example](https://example.com/docs)

危險連結：[xss](javascript:alert(1))

<script>window.__pwned = true</script>

| 欄 A | 欄 B |
|------|------|
| 1    | 2    |
`

function makeFixture() {
  const base = mkTemp('spek-files-fixture-')

  const repo = join(base, 'repo-openspec')
  mkdirSync(join(repo, 'openspec'), { recursive: true })
  mkdirSync(join(repo, 'sub', 'deep'), { recursive: true })

  writeFileSync(join(repo, 'README.md'), README)
  // 含 URL —— worker 的 link provider 會把它標成 .detected-link
  writeFileSync(join(repo, 'sample.ts'), '// 參考 https://example.com/spec\nexport const answer = 42\n')
  writeFileSync(join(repo, 'big.txt'), Buffer.alloc(MAX_FILE_BYTES + 1, 0x61))
  // 副檔名對不到任何語言 —— 應以純文字呈現，而非拒絕開啟
  writeFileSync(join(repo, 'notes.unknownext'), 'plain text\nsecond line\n')

  const binary = Buffer.alloc(4096, 0x61)
  binary[10] = 0
  writeFileSync(join(repo, 'binary.bin'), binary)

  writeFileSync(join(repo, 'sub', 'nested.txt'), 'nested\n')
  writeFileSync(join(repo, 'sub', 'deep', 'hidden.txt'), 'hidden\n')

  // 樹上兩個節點、磁碟上同一個目錄。少了它，watcher 的別名 bug 會躲過所有驗收。
  symlinkSync(join(repo, 'sub'), join(repo, 'link-to-sub'))

  // 指向 workspace 之外 —— 展開它必須失敗並說明原因
  const outside = join(base, 'outside')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'secret.txt'), 'do not read\n')
  symlinkSync(outside, join(repo, 'escape-link'))

  const plain = join(base, 'repo-plain')
  mkdirSync(plain, { recursive: true })

  return { repo, plain, outside }
}

function seedProfile(folders) {
  const profile = mkTemp('spek-files-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: folders.map(([id, path]) => ({ id, path, addedAt: '2026-07-10T00:00:00.000Z' })),
    }),
  )
  return profile
}

// ── app 啟動 ────────────────────────────────────────────────────────────────

const MOUNTED = `Boolean(
  document.querySelector('aside[aria-label="工作區"]') &&
  document.getElementById('root')?.children.length &&
  document.visibilityState === 'visible'
)`

// vite 的輸出帶顏色。以 fromCharCode 組出 ESC，避免在 regex 字面量裡放控制字元。
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text) => text.replace(ANSI_PATTERN, '')

/**
 * 開發模式只起 renderer 的 dev server，electron 由探針自己 spawn。
 *
 * 不用 `electron-vite dev` 直接把 electron 拉起來：它產生的 electron 是**孫行程**，
 * 殺掉 `npx` 殺不到它（實測留下殭屍行程佔著 debugging port）；而它轉發 CLI 參數的管道
 * （`ELECTRON_CLI_ARGS`）在本機實測未生效 —— `--user-data-dir` 沒進到 electron 的 argv，
 * 探針因此會讀到開發者真實的 workspace 設定。
 *
 * 自己 spawn 則兩者皆可控，且驗的仍是真正的開發模式載入路徑：主行程看到
 * `ELECTRON_RENDERER_URL` 就會 `loadURL(http://…)`，worker 走 dev server 而非 `file://`。
 */
async function startRendererDevServer() {
  const child = spawn('npx', ['electron-vite', 'dev', '--rendererOnly'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
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
      env: rendererUrl ? { ...process.env, ELECTRON_RENDERER_URL: rendererUrl } : process.env,
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
      await sleep(600)
    },
  }
}

// ── renderer 內的量測 ───────────────────────────────────────────────────────

const SELECT_FOLDER = (name) => `(() => {
  const row = [...document.querySelectorAll('aside[aria-label="工作區"] div[role="button"]')]
    .find((el) => el.innerText.includes(${JSON.stringify(name)}))
  if (!row) return false
  row.click()
  return true
})()`

const TABS = `[...document.querySelectorAll('[role="tablist"] button[role="tab"]')].map((tab) => ({
  label: tab.innerText.trim(),
  selected: tab.getAttribute('aria-selected') === 'true',
  disabled: tab.disabled,
  title: tab.getAttribute('title') ?? '',
}))`

const CLICK_TAB = (label) => `(() => {
  const tab = [...document.querySelectorAll('[role="tablist"] button[role="tab"]')]
    .find((el) => el.innerText.trim().startsWith(${JSON.stringify(label)}))
  if (!tab) return false
  tab.click()
  return true
})()`

const IDENTITY = `(() => {
  if (document.querySelector('section[aria-label="Files"]')) return 'files'
  if (document.querySelector('section[aria-label="OpenSpec"]')) return 'openspec'
  return null
})()`

const ROWS = `[...document.querySelectorAll('[role="treeitem"]')].map((row) => ({
  path: row.getAttribute('title'),
  level: Number(row.getAttribute('aria-level')),
  expanded: row.getAttribute('aria-expanded'),
  text: row.innerText.replace(/\\n/g, ' ').trim(),
}))`

const ROW_PATHS = `[...document.querySelectorAll('[role="treeitem"]')].map((r) => r.getAttribute('title'))`

const CLICK_ROW = (relPath) => `(() => {
  const row = document.querySelector('[role="treeitem"][title=${JSON.stringify(relPath)}]')
  if (!row) return false
  row.click()
  return true
})()`

const ITEM_COUNT = `(() => {
  const header = document.querySelector('section[aria-label="Files"] header')
  const match = header?.innerText.match(/(\\d+) 個項目/)
  return match ? Number(match[1]) : -1
})()`

/**
 * 失敗的列其 title 會變成錯誤訊息，因此以名稱定位而非 title。
 * 名稱在第二個 span —— 第一個是展開／收合的字符，直接比對 innerText 會被它擋掉。
 * 目錄的名稱帶結尾斜線，比對前去掉。
 */
const ROW_NAME_MATCH = (name) =>
  `(el) => (el.children[1]?.textContent ?? '').replace(/\\/$/, '') === ${JSON.stringify(name)}`

const ROW_BY_NAME = (name) => `(() => {
  const row = [...document.querySelectorAll('[role="treeitem"]')].find(${ROW_NAME_MATCH(name)})
  return row ? { text: row.innerText.replace(/\\n/g, ' ').trim(), expanded: row.getAttribute('aria-expanded') } : null
})()`

const CLICK_ROW_BY_NAME = (name) => `(() => {
  const row = [...document.querySelectorAll('[role="treeitem"]')].find(${ROW_NAME_MATCH(name)})
  if (!row) return false
  row.click()
  return true
})()`

/**
 * 點一下、等 React 把離散事件的更新 flush 完（那發生在 microtask），再讀列。
 *
 * 這是「內容來自快取」與「等 listDir 回來才呈現」的乾淨判別式：React 的更新在 microtask
 * 佇列中完成，而 IPC 的回應必須經過 macrotask —— 幾個 microtask 之後就看得到子項，
 * 就表示它不可能是這一次 IPC 的結果。
 */
const CLICK_ROW_THEN_READ = (relPath) => `(async () => {
  const row = document.querySelector('[role="treeitem"][title=${JSON.stringify(relPath)}]')
  if (!row) return null
  row.click()
  for (let i = 0; i < 3; i += 1) await Promise.resolve()
  return [...document.querySelectorAll('[role="treeitem"]')].map((r) => r.getAttribute('title'))
})()`

/** 展開後、在 listDir 回來之前收合：載入的結果不該讓內容突然出現。 */
const EXPAND_THEN_COLLAPSE = (relPath) => `(async () => {
  const find = () => document.querySelector('[role="treeitem"][title=${JSON.stringify(relPath)}]')
  const first = find()
  if (!first) return false
  first.click()
  // 等 React 掛上「已展開」的新處理常式，但不等 IPC ——後者要 macrotask
  for (let i = 0; i < 3; i += 1) await Promise.resolve()
  const second = find()
  if (!second) return false
  second.click()
  return true
})()`

// Monaco 以 &nbsp; 渲染空白，直接比對字串會被 U+00A0 騙過去
const EDITOR_TEXT = `document.querySelector('.monaco-editor .view-lines')?.innerText.replace(/\\u00a0/g, ' ') ?? null`

const EDITOR_TEXTAREA_READONLY = `(() => {
  const textarea = document.querySelector('.monaco-editor textarea')
  return textarea ? textarea.readOnly : null
})()`

const FOCUS_EDITOR = `(() => {
  const textarea = document.querySelector('.monaco-editor textarea')
  if (!textarea) return false
  textarea.focus()
  return document.activeElement === textarea
})()`

const RELOAD = `(() => { location.reload(); return true })()`

const PANEL_TEXT = `document.querySelector('section[aria-label="Side panel"]')?.innerText ?? ''`

const SIDE_PANEL_WIDTH = `document.querySelector('section[aria-label="Side panel"]')?.getBoundingClientRect().width ?? -1`

const CLICK_COLLAPSE = `(() => {
  const button = document.querySelector('main[aria-label="主舞台"] header button[aria-expanded]')
  if (!button) return false
  button.click()
  return true
})()`

/** 只可能由 worker 算出：Monaco 的 link provider 呼叫 worker 端的 $computeLinks。 */
const DETECTED_LINKS = `document.querySelectorAll('.detected-link').length`

/** tokenization 在主執行緒完成，因此這只證明「有高亮」，不證明 worker 存活。 */
const TOKEN_CLASSES = `(() => {
  const spans = [...document.querySelectorAll('.view-line span[class^="mtk"]')]
  return new Set(spans.map((s) => s.className)).size
})()`

const MARKDOWN = `(() => {
  const root = document.querySelector('.markdown')
  if (!root) return null
  return {
    headings: root.querySelectorAll('h1').length,
    tables: root.querySelectorAll('table').length,
    scriptElements: root.querySelectorAll('script').length,
    pwned: Boolean(window.__pwned),
    text: root.innerText,
    anchors: [...root.querySelectorAll('a')].map((a) => a.getAttribute('href')),
  }
})()`

/** 直接試著導航。will-navigate 應阻止它，location 不變。 */
const TRY_NAVIGATE = `(async () => {
  const before = location.href
  location.href = 'https://example.com/'
  await new Promise((r) => setTimeout(r, 400))
  return { before, after: location.href }
})()`

const TRY_WINDOW_OPEN = `(() => {
  const opened = window.open('https://example.com/')
  if (opened) opened.close?.()
  return opened === null
})()`

const OPEN_EXTERNAL = (url) => `(async () => {
  try {
    await window.workspace.shell.openExternal(${JSON.stringify(url)})
    return { rejected: false }
  } catch (error) {
    return { rejected: true, message: String(error) }
  }
})()`

const READ_FILE = (folderId, relPath) => `window.workspace.fs.readFile(${JSON.stringify(folderId)}, ${JSON.stringify(relPath)})`

// ── 建置模式的完整驗收 ──────────────────────────────────────────────────────

async function probeBuild(fixture, profile) {
  const app = await launch({ port: BUILD_PORT, profileDir: profile })
  try {
    if (!check(results, '應用程式啟動（建置模式）', app.mounted === true, app.mounted ? '' : app.stderr().slice(0, 300))) {
      throw new Error('未掛載，後續斷言無意義')
    }

    // ── file-explorer：尚未選擇 folder ──────────────────────────────────────
    console.log('\n尚未選擇 folder')
    const emptyText = await pollUntil(app.client, PANEL_TEXT, (text) => text.length > 0)
    check(results, '未選中任何 folder 時呈現說明此狀態的提示', /尚未選擇 repo/.test(emptyText),
      emptyText.split('\n').filter(Boolean)[0])

    // ── workspace-layout：身分切換 ──────────────────────────────────────────
    console.log('\nside panel 的兩個同層互斥身分')
    check(results, '選中含 openspec 的 folder', (await app.client.evaluate(SELECT_FOLDER('repo-openspec'))) === true)

    const tabs = await app.client.evaluate(TABS)
    check(results, '身分切換入口呈現兩個分頁', tabs.length === 2, tabs.map((t) => t.label).join(', '))
    check(results, '預設身分為 Files', (await app.client.evaluate(IDENTITY)) === 'files')
    check(results, '當前身分於入口上可辨識', tabs.find((t) => t.label.includes('Files'))?.selected === true)
    check(results, '含 openspec 時 OpenSpec 入口可用', tabs.find((t) => t.label.includes('OpenSpec'))?.disabled === false)

    check(results, '可切換至 OpenSpec 身分', (await app.client.evaluate(CLICK_TAB('◈'))) === true)
    check(results, '一次只顯示一個身分', (await app.client.evaluate(IDENTITY)) === 'openspec')
    await app.client.evaluate(CLICK_TAB('▤'))
    check(results, '可切回 Files 身分', (await app.client.evaluate(IDENTITY)) === 'files')

    check(results, '收合 side panel', (await app.client.evaluate(CLICK_COLLAPSE)) === true)
    await pollUntil(app.client, SIDE_PANEL_WIDTH, (width) => width === 0)
    await app.client.evaluate(CLICK_TAB('▤'))
    const reexpanded = await pollUntil(app.client, SIDE_PANEL_WIDTH, (width) => width > 0)
    check(results, '收合狀態下觸發任一身分皆重新展開', reexpanded > 0, `${Math.round(reexpanded)}px`)

    // ── workspace-layout：OpenSpec 為條件式身分 ─────────────────────────────
    await app.client.evaluate(SELECT_FOLDER('repo-plain'))
    const plainTabs = await pollUntil(app.client, TABS, (list) => list.find((t) => t.label.includes('OpenSpec'))?.disabled === true)
    const openSpecTab = plainTabs.find((t) => t.label.includes('OpenSpec'))
    check(results, '不含 openspec 時 OpenSpec 入口停用', openSpecTab?.disabled === true)
    check(results, '停用的入口附說明', /沒有 openspec/.test(openSpecTab?.title ?? ''), openSpecTab?.title)
    await app.client.evaluate(CLICK_TAB('◈'))
    check(results, '停用的身分不可被切換至', (await app.client.evaluate(IDENTITY)) === 'files')
    check(results, 'Files 身分恆可用', plainTabs.find((t) => t.label.includes('Files'))?.disabled === false)

    // ── file-explorer：樹與 lazy load ───────────────────────────────────────
    console.log('\n檔案樹：lazy load、排序、項目數')
    await app.client.evaluate(SELECT_FOLDER('repo-openspec'))
    const rootRows = await pollUntil(app.client, ROWS, (rows) => rows.length >= 6)

    check(results, '呈現根目錄的直接子項目', rootRows.some((r) => r.path === 'README.md') && rootRows.some((r) => r.path === 'sub'))
    check(results, '未展開的目錄不載入其子項目', !rootRows.some((r) => r.path === 'sub/nested.txt'),
      rootRows.map((r) => r.path).join(' '))

    const kinds = rootRows.map((r) => (r.expanded === null ? 'file' : 'dir'))
    const firstFile = kinds.indexOf('file')
    check(results, '目錄排在檔案之前', firstFile === -1 || !kinds.slice(firstFile).includes('dir'),
      rootRows.map((r) => r.path).join(' '))

    const countBefore = await app.client.evaluate(ITEM_COUNT)
    check(results, '面板呈現可見項目數', countBefore === rootRows.length, `${countBefore} vs ${rootRows.length} 列`)

    check(results, '展開子目錄', (await app.client.evaluate(CLICK_ROW('sub'))) === true)
    const expandedRows = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('sub/nested.txt'))
    check(results, '展開時才載入該目錄內容', expandedRows.includes('sub/nested.txt'))
    check(results, '孫目錄仍未載入', !expandedRows.includes('sub/deep/hidden.txt'))

    const countAfter = await app.client.evaluate(ITEM_COUNT)
    check(results, '展開後項目數增加', countAfter > countBefore, `${countBefore} → ${countAfter}`)


    // ── file-explorer：外部變更 ─────────────────────────────────────────────
    console.log('\n外部變更（監看集合 = 展開集合）')
    writeFileSync(join(fixture.repo, 'created.txt'), 'x')
    const withCreated = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('created.txt'))
    check(results, '外部新增的檔案出現在樹上', withCreated.includes('created.txt'))

    unlinkSync(join(fixture.repo, 'created.txt'))
    const withoutCreated = await pollUntil(app.client, ROW_PATHS, (paths) => !paths.includes('created.txt'))
    check(results, '外部刪除的檔案自樹上消失', !withoutCreated.includes('created.txt'))

    writeFileSync(join(fixture.repo, 'sub', 'deep', 'unseen.txt'), 'x')
    await sleep(700)
    const stillUnseen = await app.client.evaluate(ROW_PATHS)
    check(results, '未展開的目錄之變更不觸發更新', !stillUnseen.some((p) => p?.includes('unseen.txt')))

    await app.client.evaluate(CLICK_ROW('sub'))
    await pollUntil(app.client, ROW_PATHS, (paths) => !paths.includes('sub/nested.txt'))
    writeFileSync(join(fixture.repo, 'sub', 'after-collapse.txt'), 'x')
    await sleep(700)
    const afterCollapse = await app.client.evaluate(ROW_PATHS)
    check(results, '收合後停止監看該目錄', !afterCollapse.some((p) => p?.includes('after-collapse.txt')),
      afterCollapse.filter(Boolean).join(' '))
    unlinkSync(join(fixture.repo, 'sub', 'after-collapse.txt'))

    // ── file-explorer：快取、背景校正、載入中收合 ───────────────────────────
    console.log('\n快取與競態')
    // 進入本段時 sub 已收合，且其內容曾被載入過 —— 仍在快取中
    const immediate = await app.client.evaluate(CLICK_ROW_THEN_READ('sub'))
    check(results, '再次展開立即以快取呈現，不等待載入', immediate?.includes('sub/nested.txt') === true,
      immediate ? `microtask 後讀到 ${immediate.filter((p) => p?.startsWith('sub/')).join(' ')}` : '(找不到列)')

    // 收合期間的變更：該目錄未被監看，chokidar 的 ignoreInitial 也不會補報
    await app.client.evaluate(CLICK_ROW('sub'))
    await pollUntil(app.client, ROW_PATHS, (paths) => !paths.includes('sub/nested.txt'))
    writeFileSync(join(fixture.repo, 'sub', 'while-collapsed.txt'), 'x')
    await sleep(400)
    await app.client.evaluate(CLICK_ROW('sub'))
    const corrected = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('sub/while-collapsed.txt'))
    check(results, '收合期間發生的變更於再次展開後被校正', corrected.includes('sub/while-collapsed.txt'))
    unlinkSync(join(fixture.repo, 'sub', 'while-collapsed.txt'))

    // 展開後、在 listDir 回來之前收合。以從未載入過的 sub/deep 驅動。
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('sub/deep'))
    check(results, '展開後立刻收合 sub/deep', (await app.client.evaluate(EXPAND_THEN_COLLAPSE('sub/deep'))) === true)
    await sleep(600)
    const raced = await app.client.evaluate(ROW_PATHS)
    check(results, '載入完成前收合，內容不會突然出現', !raced.includes('sub/deep/hidden.txt'),
      raced.filter((p) => p?.startsWith('sub/deep')).join(' ') || '(無子項顯現)')

    // ── file-explorer：folder 內的 symlink 目錄 ─────────────────────────────
    console.log('\nsymlink 目錄（樹上兩個節點、磁碟同一個目錄）')
    await app.client.evaluate(CLICK_ROW('sub')) // 收合，讓 link-to-sub 單獨受測
    await pollUntil(app.client, ROW_PATHS, (paths) => !paths.includes('sub/nested.txt'))

    check(results, '展開 folder 內指向其他目錄的 symlink', (await app.client.evaluate(CLICK_ROW('link-to-sub'))) === true)
    const viaLink = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('link-to-sub/nested.txt'))
    check(results, 'symlink 節點之下呈現目標目錄的內容', viaLink.includes('link-to-sub/nested.txt'))

    writeFileSync(join(fixture.repo, 'sub', 'via-link.txt'), 'x')
    const linkUpdated = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('link-to-sub/via-link.txt'))
    check(results, '事件以訂閱者的路徑表達（symlink 節點會更新）', linkUpdated.includes('link-to-sub/via-link.txt'),
      linkUpdated.includes('sub/via-link.txt') ? '竟以真實路徑回報' : '')

    // 兩個節點同時訂閱同一個目錄，收合其一不得停掉另一個的監看
    await app.client.evaluate(CLICK_ROW('sub'))
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('sub/nested.txt'))
    await app.client.evaluate(CLICK_ROW('link-to-sub'))
    await pollUntil(app.client, ROW_PATHS, (paths) => !paths.includes('link-to-sub/nested.txt'))

    writeFileSync(join(fixture.repo, 'sub', 'alias-check.txt'), 'x')
    const aliasSafe = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('sub/alias-check.txt'))
    check(results, '收合 symlink 別名不會停掉真實目錄的監看', aliasSafe.includes('sub/alias-check.txt'))

    unlinkSync(join(fixture.repo, 'sub', 'via-link.txt'))
    unlinkSync(join(fixture.repo, 'sub', 'alias-check.txt'))
    await app.client.evaluate(CLICK_ROW('sub'))
    await pollUntil(app.client, ROW_PATHS, (paths) => !paths.includes('sub/nested.txt'))

    // 指向 workspace 之外的 symlink：不得展開，且要說明原因
    check(results, '點擊越界的 symlink 目錄', (await app.client.evaluate(CLICK_ROW_BY_NAME('escape-link'))) === true)
    const escapeRow = await pollUntil(app.client, ROW_BY_NAME('escape-link'), (row) => /邊界/.test(row?.text ?? ''))
    check(results, '展開越界 symlink 失敗並說明超出 workspace 邊界', /超出 workspace 邊界/.test(escapeRow?.text ?? ''),
      escapeRow?.text)
    const noSecret = await app.client.evaluate(ROW_PATHS)
    check(results, '越界 symlink 之下不呈現任何項目', !noSecret.some((p) => p?.includes('secret.txt')))

    // ── filesystem-access：renderer 重新載入後監看集合重建 ──────────────────
    console.log('\nrenderer 重新載入')
    await app.client.evaluate(RELOAD)
    await sleep(500)
    const remounted = await pollUntil(app.client, MOUNTED, (value) => value === true)
    check(results, '重新載入後 renderer 重新掛載', remounted === true)

    await app.client.evaluate(SELECT_FOLDER('repo-openspec'))
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('README.md'))
    writeFileSync(join(fixture.repo, 'after-reload.txt'), 'x')
    const afterReload = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('after-reload.txt'))
    check(results, '重新載入後監看集合重建，樹仍隨磁碟更新', afterReload.includes('after-reload.txt'))
    unlinkSync(join(fixture.repo, 'after-reload.txt'))

    // ── file-viewer：拒絕條件 ───────────────────────────────────────────────
    console.log('\n檔案檢視：拒絕條件')
    const tooLarge = await app.client.evaluate(READ_FILE('f-openspec', 'big.txt'))
    check(results, 'readFile 拒絕過大的檔案並回報大小與上限',
      tooLarge.ok === false && tooLarge.code === 'TOO_LARGE' && tooLarge.detail?.limit === MAX_FILE_BYTES,
      `${tooLarge.code} size=${tooLarge.detail?.size} limit=${tooLarge.detail?.limit}`)

    const binary = await app.client.evaluate(READ_FILE('f-openspec', 'binary.bin'))
    check(results, 'readFile 拒絕二進位檔案', binary.ok === false && binary.code === 'BINARY', binary.code)

    const escaped = await app.client.evaluate(READ_FILE('f-openspec', '../repo-plain'))
    check(results, 'readFile 拒絕逃逸出邊界的路徑', escaped.ok === false, escaped.code)

    await app.client.evaluate(CLICK_ROW('big.txt'))
    const bigText = await pollUntil(app.client, PANEL_TEXT, (text) => /過大/.test(text))
    check(results, 'UI 呈現「檔案過大」與上限', /過大/.test(bigText) && /2\.0 MB/.test(bigText),
      bigText.split('\n').filter(Boolean).slice(-2).join(' · '))
    check(results, '過大的檔案不呈現任何內容片段', !/aaaa/.test(bigText))

    await app.client.evaluate(`document.querySelector('section[aria-label="Files"] header button')?.click()`)
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('binary.bin'))
    await app.client.evaluate(CLICK_ROW('binary.bin'))
    const binaryText = await pollUntil(app.client, PANEL_TEXT, (text) => /二進位/.test(text))
    check(results, 'UI 呈現「二進位檔案」', /二進位/.test(binaryText))

    // ── file-viewer：未知副檔名與唯讀 ───────────────────────────────────────
    console.log('\n檔案檢視：未知副檔名與唯讀')
    await app.client.evaluate(`document.querySelector('section[aria-label="Files"] header button')?.click()`)
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('notes.unknownext'))
    await app.client.evaluate(CLICK_ROW('notes.unknownext'))

    const plainText = await pollUntil(app.client, EDITOR_TEXT, (text) => Boolean(text))
    check(results, '未知副檔名的文字檔以純文字呈現於編輯器中', /plain text/.test(plainText ?? ''),
      (plainText ?? '(未掛載編輯器)').split('\n')[0])
    const plainTokens = await app.client.evaluate(TOKEN_CLASSES)
    check(results, '純文字只有單一 token 樣式（未套用任何語言）', plainTokens === 1, `${plainTokens} 種`)

    check(results, '編輯器的輸入區為唯讀', (await app.client.evaluate(EDITOR_TEXTAREA_READONLY)) === true)
    check(results, '編輯器可取得焦點', (await app.client.evaluate(FOCUS_EDITOR)) === true)
    const beforeTyping = await app.client.evaluate(EDITOR_TEXT)
    await app.client.send('Input.insertText', { text: 'INJECTED' })
    await sleep(300)
    const afterTyping = await app.client.evaluate(EDITOR_TEXT)
    check(results, '嘗試輸入時內容不因此改變', beforeTyping === afterTyping && !/INJECTED/.test(afterTyping ?? ''),
      afterTyping === beforeTyping ? '' : `內容被改成 ${afterTyping}`)

    // ── file-viewer：markdown ───────────────────────────────────────────────
    console.log('\n檔案檢視：markdown 的渲染與安全性')
    await app.client.evaluate(`document.querySelector('section[aria-label="Files"] header button')?.click()`)
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('README.md'))
    await app.client.evaluate(CLICK_ROW('README.md'))
    const md = await pollUntil(app.client, MARKDOWN, (value) => value !== null)

    check(results, 'markdown 以渲染後的樣貌呈現', md?.headings === 1 && md?.tables === 1,
      `h1=${md?.headings} table=${md?.tables}`)
    check(results, '原始 HTML 不被當作 HTML 執行', md?.scriptElements === 0 && md?.pwned === false)
    check(results, 'script 標籤以純文字呈現', /<script>/.test(md?.text ?? ''))
    check(results, 'javascript: 連結不可點（未渲染為 anchor）',
      !(md?.anchors ?? []).some((href) => /^javascript:/i.test(href ?? '')), (md?.anchors ?? []).join(' '))
    check(results, '外部連結保留為 anchor', (md?.anchors ?? []).includes('https://example.com/docs'))

    // ── workspace-app-shell：導航防護 ───────────────────────────────────────
    console.log('\n導航防護（preload 白名單不得落入遠端頁面）')
    const navigation = await app.client.evaluate(TRY_NAVIGATE)
    check(results, 'renderer 無法導航離開應用程式來源', navigation.before === navigation.after,
      `${navigation.after}`)
    check(results, 'renderer 無法開啟新視窗', (await app.client.evaluate(TRY_WINDOW_OPEN)) === true)

    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x']) {
      const attempt = await app.client.evaluate(OPEN_EXTERNAL(url))
      check(results, `主行程拒絕以系統瀏覽器開啟 ${url.split(':')[0]}:`, attempt.rejected === true)
    }

    // ── 迴歸：被阻擋的導航不得摧毀 watcher ───────────────────────────────────
    // `will-navigate` 與 `did-start-navigation` 對同一次導航都會觸發，preventDefault 只是
    // 隨後取消它。曾經以 did-start-navigation 當「重新載入」的訊號 —— 於是一次被擋掉的
    // 導航就讓所有 watcher 靜默消失，檔案樹與檢視器從此不再更新。
    // 導航測試期間面板停在 README.md 的檢視上，先回到樹才看得到列
    await app.client.evaluate(`document.querySelector('section[aria-label="Files"] header button')?.click()`)
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('README.md'))

    writeFileSync(join(fixture.repo, 'watch-after-nav.txt'), 'x')
    const afterNav = await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('watch-after-nav.txt'))
    check(results, '被阻擋的導航不摧毀 watcher', afterNav.includes('watch-after-nav.txt'))
    unlinkSync(join(fixture.repo, 'watch-after-nav.txt'))

    // ── file-viewer：外部變更提示 ───────────────────────────────────────────
    console.log('\n檢視中的檔案於磁碟被改動')
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('sample.ts'))
    await app.client.evaluate(CLICK_ROW('sample.ts'))

    // ── workspace-app-shell：編輯器與 worker（建置模式）─────────────────────
    console.log('\n編輯器：語法高亮與 worker 往返（建置模式）')
    const tokens = await pollUntil(app.client, TOKEN_CLASSES, (count) => count > 1)
    check(results, '編輯器載入且語法元素有多於一種呈現樣式', tokens > 1, `${tokens} 種 token class`)

    const links = await pollUntil(app.client, DETECTED_LINKS, (count) => count > 0)
    check(results, 'worker 完成一次往返（URL 被標為連結）', links > 0, `${links} 個 .detected-link`)

    writeFileSync(join(fixture.repo, 'sample.ts'), '// 已被外部改動 https://example.com/spec\n')
    const staleText = await pollUntil(app.client, PANEL_TEXT, (text) => /已在磁碟上變更/.test(text))
    check(results, '檢視中的檔案被外部修改時提示過期', /已在磁碟上變更/.test(staleText))

    unlinkSync(join(fixture.repo, 'sample.ts'))
    const deletedText = await pollUntil(app.client, PANEL_TEXT, (text) => /已被刪除/.test(text))
    check(results, '檢視中的檔案被外部刪除時明確標示', /已被刪除/.test(deletedText))
  } finally {
    await app.close()
  }
}

// ── 開發模式：只驗 worker 的載入路徑 ────────────────────────────────────────

async function probeDev(fixture, profile) {
  writeFileSync(join(fixture.repo, 'sample.ts'), '// 參考 https://example.com/spec\nexport const answer = 42\n')

  console.log('\n編輯器：語法高亮與 worker 往返（開發模式）')
  const server = await startRendererDevServer()
  let app = null
  try {
    app = await launch({ port: DEV_PORT, profileDir: profile, rendererUrl: server.url })

    if (!check(results, `應用程式啟動（開發模式，renderer 由 ${server.url} 提供）`, app.mounted === true,
      app.mounted ? '' : app.stderr().slice(-300))) {
      return
    }

    const folders = await app.client.evaluate('window.workspace.folders.list()')
    check(results, '開發模式使用探針的暫存 profile', folders.length === 2,
      folders.map((f) => f.name).join(', ') || '(空)')

    await app.client.evaluate(SELECT_FOLDER('repo-openspec'))
    await pollUntil(app.client, ROW_PATHS, (paths) => paths.includes('sample.ts'))
    await app.client.evaluate(CLICK_ROW('sample.ts'))

    const tokens = await pollUntil(app.client, TOKEN_CLASSES, (count) => count > 1)
    check(results, '開發模式下編輯器提供語法高亮', tokens > 1, `${tokens} 種 token class`)

    const links = await pollUntil(app.client, DETECTED_LINKS, (count) => count > 0)
    check(results, '開發模式下 worker 完成一次往返', links > 0, `${links} 個 .detected-link`)
  } finally {
    if (app) await app.close()
    server.child.kill('SIGTERM')
    await sleep(800)
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const fixture = makeFixture()
const profile = seedProfile([
  ['f-openspec', fixture.repo],
  ['f-plain', fixture.plain],
])

let exitCode = 1
try {
  await probeBuild(fixture, profile)
  await probeDev(fixture, profile)
  exitCode = results.every(Boolean) ? 0 : 1
} catch (error) {
  console.error(`\nprobe 失敗：${error.message}`)
} finally {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${results.filter(Boolean).length}/${results.length} 通過`)
process.exit(exitCode)
