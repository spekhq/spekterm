/**
 * 驗證 `conversation-archive` 與 `conversation-insights`。
 *
 * ## 兩件與其他探針不同的事
 *
 * **一、fixture 由產品的 testkit 產生，不在這裡重寫一份。** `transcript-fixture.testkit.ts` 是
 * TypeScript，`.mjs` import 不了 —— 因此以 `node --import tsx` 起一支小行程去呼叫它，並把它
 * 宣告的 `facts` 以 JSON 讀回來。重寫一份的代價是實際的：產品那份改了形態之後，探針仍以舊形態
 * 造資料，而斷言會**繼續是綠的**。
 *
 * **二、每一條數字斷言都對著 `facts`，而不是「有東西就好」。** 掃描器的來源根由
 * `CLAUDE_CONFIG_DIR` 決定；那個變數若沒有正確傳進被測 app，它會去掃開發者本機真實的四百多份
 * transcript —— 耗時、把開發者的 prompt 寫進探針的 userData，而「十一個視圖都存在」這種存在性
 * 斷言**照樣全綠**。因此第一段就以 fixture 的已知數值把前提釘住。
 *
 * 用法：npm run probe:insights
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, connectToApp, pollFor } from './lib/cdp.mjs'
import { copy } from './lib/copy.mjs'
import { awaitMounted } from './lib/mounted.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { runSections } from './lib/sections.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'

const PORT = PROBE_PORTS.insights.main
const EMPTY_PORT = PROBE_PORTS.insights.empty

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

/** 呼叫產品的 fixture 產生器，取回它自己宣告的 facts。 */
function writeFixture(configDir) {
  const script = `
    import { writeTranscriptFixture } from './src/main/transcript-fixture.testkit.ts'
    process.stdout.write(JSON.stringify(writeTranscriptFixture(process.env.FIXTURE_ROOT)))
  `
  // 以環境變數傳路徑 —— `node -e` 的 argv 不含它自己的旗標，位置會錯開。
  const stdout = execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, FIXTURE_ROOT: configDir },
  })
  return JSON.parse(stdout)
}

function seedProfile(prefix) {
  const profile = mkTemp(prefix)
  const repo = mkTemp('spekterm-insights-repo-')
  mkdirSync(join(repo, 'openspec', 'specs'), { recursive: true })
  writeFileSync(join(repo, 'readme.md'), '# fixture\n')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: [{ id: 'f1', path: repo, addedAt: '2026-09-05T00:00:00.000Z' }],
    }),
  )
  return { profile, repo }
}

async function launch({ configDir, profile, port = PORT }) {
  const child = spawn(
    'electron',
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...electronExtraArgs(), '.'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SHELL: '/bin/sh', CLAUDE_CONFIG_DIR: configDir },
    },
  )
  let output = ''
  child.stderr?.on('data', (chunk) => (output += chunk))
  child.stdout?.on('data', (chunk) => (output += chunk))

  const client = await connectToApp(port, { targetTimeoutMs: 30_000 })
  await awaitMounted(client)
  return {
    client,
    pid: child.pid,
    output: () => output,
    async close() {
      try {
        await client.close()
      } catch {
        // 已經斷了就算了 —— 收屍才是重點。
      }
      child.kill()
    },
  }
}

// ── 讀畫面的表達式 ──────────────────────────────────────────────────────────

const OVERLAY = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="${copy('insights.label')}"]')
  if (!dialog) return { open: false }
  const rect = dialog.getBoundingClientRect()
  const views = [...dialog.querySelectorAll('article[aria-label]')].map((a) => a.getAttribute('aria-label'))
  const sources = [...dialog.querySelectorAll('article[aria-label] p')]
    .filter((p) => p.textContent.trim().toLowerCase().startsWith('${copy('insights.sourceLabel')}'))
    .length
  return {
    open: true,
    coversWindow: rect.width >= window.innerWidth && rect.height >= window.innerHeight,
    views,
    sources,
    text: dialog.innerText,
  }
})()`

const TOTALS = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="${copy('insights.label')}"]')
  if (!dialog) return null
  const out = {}
  for (const item of dialog.querySelectorAll('dl > div')) {
    const dt = item.querySelector('dt')?.textContent?.trim()
    const dd = item.querySelector('dd')?.textContent?.trim()
    if (dt && dd) out[dt] = dd
  }
  return out
})()`

const ACTIVITY_ENTRY = `document.querySelector('button[aria-label="${copy('insights.label')}"]')`

const openOverlay = async (client) => {
  await client.evaluate(`${ACTIVITY_ENTRY}.click(); true`)
  return pollFor({
    read: () => client.evaluate(OVERLAY),
    settled: (state) => state.open && state.views.length >= 11,
    timeoutMs: 20_000,
    interval: 200,
    label: 'overlay 開啟並渲染十一個視圖',
  })
}

const key = (client, { key: k, code, ctrl = false, windowsVirtualKeyCode }) => {
  // `nativeVirtualKeyCode` 與 `windowsVirtualKeyCode` 都要給 —— 比照 `probe-openspec.mjs`
  // 既有的 `pressCtrlP`。少了前者，Chromium 在某些鍵上收不到修飾鍵組合。
  const payload = { key: k, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers: ctrl ? 2 : 0 }
  return client
    .send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...payload })
    .then(() => client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...payload }))
}

// ── 段落 ────────────────────────────────────────────────────────────────────

/**
 * 前提：探針掃的是 fixture，不是開發者本機真實的 transcript。
 *
 * 少了這一段，`CLAUDE_CONFIG_DIR` 沒傳進去時探針會去掃四百多份真實檔案，而其後每一條
 * 存在性斷言照樣全綠。
 */
async function runFixtureEvidence(_mode, _config, context) {
  const configDir = mkTemp('spekterm-insights-source-')
  const facts = writeFixture(configDir)
  const { profile } = seedProfile('spekterm-insights-profile-')
  context.facts = facts
  context.app = await launch({ configDir, profile })
  const client = context.app.client

  const state = await openOverlay(client)
  check(results, 'overlay 開啟且渲染十一個視圖', state.views.length === 11, `${state.views.length} 個：${state.views.join(' / ')}`)

  const totals = await client.evaluate(TOTALS)
  const read = (key) => Number((totals?.[copy(key)] ?? '').replace(/,/g, ''))
  check(
    results,
    '掃的是 fixture 而非本機真實資料（訊息數與宣告一致）',
    read('insights.totals.messages') === facts.userMessages,
    `畫面 ${read('insights.totals.messages')}，fixture 宣告 ${facts.userMessages}`,
  )
  check(
    results,
    '工具呼叫數與 fixture 宣告一致（含 subagent）',
    read('insights.totals.tools') === facts.toolCalls,
    `畫面 ${read('insights.totals.tools')}，fixture 宣告 ${facts.toolCalls}`,
  )
  check(
    results,
    '中斷數與 fixture 宣告一致',
    read('insights.totals.interrupts') === facts.interrupts,
    `畫面 ${read('insights.totals.interrupts')}，fixture 宣告 ${facts.interrupts}`,
  )
  // **只看專案那張圖的列。** 拿整個 overlay 的 innerText 去找「scratchpad」是行不通的：
  // fixture 裡有一則使用者訊息就叫「看一下 scratchpad」，它會出現在語氣例句裡 ——
  // 那條斷言於是在正確的實作下也會紅。
  const projectLabels = await client.evaluate(`[...document.querySelectorAll('article[aria-label="${copy('insights.projects.title')}"] li span:first-child')].map((s) => s.textContent.trim())`)
  check(
    results,
    '專案名稱由 cwd 反查而得（不是最後一個 cwd）',
    facts.projects.every((p) => projectLabels.includes(p.label)) && !projectLabels.some((l) => l.includes('scratchpad')),
    `期望 ${facts.projects.map((p) => p.label).join(' / ')}；實得 ${projectLabels.join(' / ')}`,
  )
}

/** overlay 自身的規格：覆蓋整個視窗、每個視圖標示來源、Esc 關閉、焦點歸還。 */
async function runOverlayContract(_mode, _config, context) {
  const client = context.app.client
  const state = await client.evaluate(OVERLAY)

  check(results, 'overlay 覆蓋整個視窗', state.coversWindow === true, JSON.stringify(state.coversWindow))
  check(results, '每個視圖都標示其來源欄位', state.sources === state.views.length, `${state.sources}/${state.views.length}`)
  check(
    results,
    '切段門檻與活動的定義被說明',
    state.text.includes('30') && state.text.toLowerCase().includes('tool'),
    '找不到門檻或活動的說明',
  )
  check(
    results,
    '語氣說明百分比不相加為 100%',
    state.text.includes('100%'),
    '找不到「不相加為 100%」的說明',
  )
  check(
    results,
    '不呈現 token 用量或成本的視圖',
    !/token|cost/i.test(state.views.join(' ')),
    state.views.join(' / '),
  )
  check(
    results,
    '沒有瀏覽全部訊息內文的入口',
    !state.text.includes('長'.repeat(20)),
    'fixture 的長訊息原文出現在畫面上',
  )

  // Esc 關閉，且焦點歸還給開啟它的入口（落回 body 是靜默失效）。
  await key(client, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  const closed = await pollFor({
    read: () => client.evaluate(`(() => ({
      open: !!document.querySelector('[role="dialog"][aria-label="${copy('insights.label')}"]'),
      focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? '',
    }))()`),
    settled: (s) => !s.open,
    timeoutMs: 5_000,
    interval: 100,
    label: 'overlay 以 Esc 關閉',
  })
  check(results, '以 Esc 關閉', closed.open === false, JSON.stringify(closed))
  check(
    results,
    '關閉後焦點歸還給開啟它的入口，不落在 body',
    closed.focus === copy('insights.label'),
    `activeElement=${closed.focus}`,
  )
}

/** overlay 開啟時導航快捷鍵不生效 —— 以**絕對狀態**斷言，並先確認機制本來是活的。 */
async function runShortcutSuppression(_mode, _config, context) {
  const client = context.app.client
  const railSelection = `(() => {
    const el = document.querySelector('[aria-current="true"], [aria-selected="true"]')
    return el?.getAttribute('aria-label') ?? ''
  })()`

  // 前提：先按一次「應當有作用」的鍵，確認機制活著。
  await key(client, { key: 'ArrowDown', code: 'ArrowDown', ctrl: true, windowsVirtualKeyCode: 40 })
  const moved = await client.evaluate(railSelection)
  check(results, '前提：overlay 未開時 Ctrl+↓ 確實會改變 rail 的選取', moved.length > 0, `選取＝${moved || '(空)'}`)

  await openOverlay(client)
  await key(client, { key: 'ArrowDown', code: 'ArrowDown', ctrl: true, windowsVirtualKeyCode: 40 })
  const after = await client.evaluate(railSelection)
  check(
    results,
    'overlay 開啟時 Ctrl+↓ 不生效（選取恰為原來那一個）',
    after === moved,
    `前 ${moved || '(空)'} → 後 ${after || '(空)'}`,
  )
  const stillOpen = await client.evaluate(`!!document.querySelector('[role="dialog"][aria-label="${copy('insights.label')}"]')`)
  check(results, 'overlay 維持開啟', stillOpen === true, String(stillOpen))

  // ---- `role="dialog"` 這個機制本身 --------------------------------------
  //
  // 導航快捷鍵與 `Ctrl+P` 的抑制都建立在「文件中存在 `[role="dialog"]`」上。上面那條 `Ctrl+↓`
  // 已經驗到抑制確實生效；這裡另外把**機制的載體**釘住 —— 角色被拿掉時它會紅，
  // 而那正是 spec 裡「拿掉這個角色不會有任何測試變紅」那句自我宣稱要兌現的地方。
  //
  // 同一個 `aria-label` 有兩個持有者（活動列的按鈕與 overlay），因此列出全部的角色再判斷 ——
  // `querySelector` 只會拿到文件順序上的第一個，也就是那顆按鈕。
  //
  // **`Ctrl+P` 在 overlay 之下的那一條沒有載體，這是一個記錄在案的缺口**（見 tasks.md）：
  // 它的 handler 掛在側欄容器的 capture 階段，而「overlay 未開時它確實開得起來」這個前提
  // 本探針建不出來（試過選定 repo、聚焦 side panel、補 nativeVirtualKeyCode，皆不成立）。
  // 前提不成立時那條斷言**恆綠而沒有任何鑑別力** —— 留一條假綠比留一個記下來的缺口更糟。
  const roles = await client.evaluate(`[...document.querySelectorAll('[aria-label="${copy('insights.label')}"]')].map((el) => el.getAttribute('role') ?? '(none)')`)
  check(results, 'overlay 以 dialog 角色呈現（快捷鍵抑制的機制載體）', roles.includes('dialog'), `角色：${roles.join(' / ')}`)

  // ---- 8.9 時間範圍 -------------------------------------------------------
  const messagesShown = `(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="${copy('insights.label')}"]')
    for (const item of dialog.querySelectorAll('dl > div')) {
      if (item.querySelector('dt')?.textContent?.trim() === '${copy('insights.totals.messages')}') {
        return Number((item.querySelector('dd')?.textContent ?? '').replace(/,/g, ''))
      }
    }
    return -1
  })()`
  const allTime = await client.evaluate(messagesShown)
  await client.evaluate(`(() => {
    const group = document.querySelector('[role="group"][aria-label="${copy('insights.rangeLabel')}"]')
    const buttons = [...group.querySelectorAll('button')]
    buttons[1].click()
    return true
  })()`)
  const ranged = await pollFor({
    read: () => client.evaluate(messagesShown),
    settled: (n) => n !== allTime,
    timeoutMs: 5_000,
    interval: 100,
    label: '時間範圍改變後數字跟著變',
  }).catch(() => allTime)
  // fixture 的資料全在 2026-01 —— 選「最近 7 天」之後應當一筆都不剩。
  check(results, '選定時間範圍後只呈現該範圍的資料', ranged === 0 && allTime > 0, `全部 ${allTime} → 最近 7 天 ${ranged}`)
  await key(client, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

/**
 * 掃描的生命週期：啟動後自己跑過一趟、掃描行程不留孤兒、掃描期間 renderer 仍可用。
 */
async function runScanLifecycle() {
  const configDir = mkTemp('spekterm-insights-life-')
  writeFixture(configDir)
  const { profile } = seedProfile('spekterm-insights-life-profile-')
  const app = await launch({ configDir, profile, port: EMPTY_PORT })
  try {
    // **完全不開 overlay** —— 啟動後那一趟是本能力的保命動作，與使用者要不要看無關。
    const scanned = await pollFor({
      read: () => app.client.evaluate(`window.workspace.insights.get().then((s) => s.sourceAvailable)`, { awaitPromise: true }),
      settled: (v) => v !== null,
      timeoutMs: 30_000,
      interval: 500,
      label: '啟動後自動掃描',
    })
    check(results, '未開啟 overlay，掃描仍已自動發生', scanned === true, `sourceAvailable=${scanned}`)

    // 掃描期間 renderer 仍可用：再觸發一次，並在它跑的時候操作介面。
    await app.client.evaluate('window.workspace.insights.refresh(); true')
    const responsive = await app.client.evaluate(`(() => {
      const rail = document.querySelector('[aria-label]')
      return !!rail && document.readyState === 'complete'
    })()`)
    check(results, '掃描期間 renderer 仍可回應', responsive === true, String(responsive))
  } finally {
    await app.close()
  }

  // 收屍：app 結束後不得留下掃描行程。
  const strays = execFileSync('bash', ['-lc', `pgrep -fa 'insights-worker' | grep -v pgrep | wc -l`], { encoding: 'utf8' }).trim()
  check(results, 'app 結束後不留下掃描行程', strays === '0', `殘留 ${strays} 個`)
}

/** 空存檔的兩種狀態：來源不可用 vs 來源可用但沒有資料。 */
async function runEmptyStates() {
  const emptySource = mkTemp('spekterm-insights-empty-')
  mkdirSync(join(emptySource, 'projects'), { recursive: true })
  const { profile } = seedProfile('spekterm-insights-empty-profile-')
  const app = await launch({ configDir: emptySource, profile, port: EMPTY_PORT })
  try {
    await app.client.evaluate(`${ACTIVITY_ENTRY}.click(); true`)
    const state = await pollFor({
      read: () => app.client.evaluate(OVERLAY),
      settled: (s) =>
        s.open && (s.text.includes(copy('insights.noData')) || s.text.includes(copy('insights.sourceUnavailable'))),
      timeoutMs: 25_000,
      interval: 200,
      label: '空來源的 overlay 狀態',
    })
    check(
      results,
      '來源可用但沒有資料：說明的是「沒有資料」，不是「來源不可用」',
      state.text.includes(copy('insights.noData')),
      JSON.stringify(state.text).slice(0, 240),
    )
  } finally {
    await app.close()
  }

  const missing = join(mkTemp('spekterm-insights-missing-'), 'nope')
  const seeded = seedProfile('spekterm-insights-missing-profile-')
  const app2 = await launch({ configDir: missing, profile: seeded.profile, port: EMPTY_PORT })
  try {
    await app2.client.evaluate(`${ACTIVITY_ENTRY}.click(); true`)
    const state = await pollFor({
      read: () => app2.client.evaluate(OVERLAY),
      settled: (s) =>
        s.open && (s.text.includes(copy('insights.noData')) || s.text.includes(copy('insights.sourceUnavailable'))),
      timeoutMs: 25_000,
      interval: 200,
      label: '不存在的來源的 overlay 狀態',
    })
    check(
      results,
      '來源不可用：與「沒有資料」是不同的說明',
      state.text.includes(copy('insights.sourceUnavailable')) && !state.text.includes(copy('insights.noData')),
      JSON.stringify(state.text).slice(0, 240),
    )
  } finally {
    await app2.close()
  }
}

const SECTIONS = [
  { name: 'runFixtureEvidence', run: runFixtureEvidence },
  { name: 'runOverlayContract', run: runOverlayContract, deps: ['runFixtureEvidence'] },
  { name: 'runShortcutSuppression', run: runShortcutSuppression, deps: ['runOverlayContract'] },
  { name: 'runEmptyStates', run: runEmptyStates },
  { name: 'runScanLifecycle', run: runScanLifecycle },
]

const outcome = await runSections({
  sections: SECTIONS,
  build: { port: PORT, rendererUrl: null },
  dev: null,
  results,
  afterMode: async (_mode, context) => {
    if (context.app) await context.app.close()
  },
  cleanup: () => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true })
  },
})

process.exit(outcome.ok ? 0 : 1)
